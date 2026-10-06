"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Lock, LockOpen, Play } from "lucide-react"

import { BattleField } from "@/components/lovable/battle-field"
import { useLearnerModel } from "@/hooks/use-learner-model"
import {
  createBattleGround,
  scoreTransfer,
  transferGroup,
  type SideCursor,
} from "@/lib/battle-ground-ui/controller"
import {
  createGameLearnerRunner,
  fetchGameLearnerDecision,
} from "@/lib/battle-ground-ui/model-learner"
import {
  matchFamilies,
  orderByFamily,
  type FamilyMarks,
} from "@/lib/battle-ground-ui/family-bias"
import type { MatchDeck } from "@/lib/battle-ground-ui/match-deck"
import { packSchema, type GamePack } from "@/lib/mini-game-rules/schema"
import { verifyGame } from "@/lib/mini-game-rules/verifier"
import { createLearnerMemory, type LearnerMemory } from "@/lib/puzzle/learner"

const MATCH_ID = "match"
const names: Record<GamePack["category"], string> = {
  binary_fill: "Sun & moon",
  crown: "Crown seats",
  path_cover: "Number trail",
  tile_rotate_connect: "Pipe turn",
  lights_toggle: "Cross lights",
}
type Generated = {
  pack: GamePack
  meta: { source: string; contentHash: string; elapsedMs: number }
}

const roundText = (cursor: SideCursor, gameCount: number, roundsPerGame: number) =>
  `Game ${cursor.game + 1} of ${gameCount} · Round ${cursor.round + 1} of ${roundsPerGame}`

const clock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export function BattleApp({ deck }: { deck: MatchDeck }) {
  const [packs, setPacks] = useState<readonly GamePack[] | null>(null)
  const [cap, setCap] = useState(600000)
  const [practice, setPractice] = useState(false)
  const [session, setSession] = useState(0)
  const [source, setSource] = useState("verified starter")
  const [hash, setHash] = useState<string | undefined>()
  if (!packs) {
    return (
      <FamilyGate
        onPlay={(marks) => {
          const games = orderByFamily(deck.games, marks)
          setPacks(games.flatMap((game) => [...game.packs]))
        }}
      />
    )
  }
  return (
    <BattleSession
      key={`${session}:${cap}:${practice}:${packs.map((pack) => pack.seed).join("-")}`}
      packs={packs}
      gameCount={deck.gameCount}
      roundsPerGame={deck.roundsPerGame}
      cap={cap}
      practice={practice}
      source={source}
      hash={hash}
      onCap={setCap}
      onPractice={() => setPractice((value) => !value)}
      onSource={setSource}
      onHash={setHash}
      onReplaceFirst={(pack) => {
        setPacks((current) =>
          current ? [pack, ...current.slice(1)] : current
        )
        setSession((value) => value + 1)
      }}
    />
  )
}

function FamilyGate({ onPlay }: { onPlay: (marks: FamilyMarks) => void }) {
  const families = matchFamilies()
  const [played, setPlayed] = useState<readonly string[]>([])
  const [disliked, setDisliked] = useState<readonly string[]>([])
  const toggle = (
    id: string,
    selected: readonly string[],
    setSelected: (next: readonly string[]) => void
  ) => {
    setSelected(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id]
    )
  }
  return (
    <main className="battle-ground">
      <form
        className="family-gate"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay({ played, disliked })
        }}
      >
        <p className="wordmark">astra-vs-human</p>
        <h1>What have you played?</h1>
        <p>
          New families come first. Ones you want less of move later. All five
          still appear.
        </p>
        <ul className="family-list" aria-label="Puzzle families">
          {families.map((family) => (
            <li key={family.id} className="family-row">
              <div>
                <strong>{family.label}</strong>
                <p>{family.pattern}</p>
              </div>
              <div className="family-marks">
                <button
                  type="button"
                  className="paper-button"
                  aria-pressed={played.includes(family.id)}
                  aria-label={`Played ${family.label}`}
                  onClick={() => toggle(family.id, played, setPlayed)}
                >
                  Played
                </button>
                <button
                  type="button"
                  className="paper-button"
                  aria-pressed={disliked.includes(family.id)}
                  aria-label={`Less of ${family.label}`}
                  onClick={() => toggle(family.id, disliked, setDisliked)}
                >
                  Less
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button type="submit" className="primary-button">
          Start with this lineup
        </button>
      </form>
    </main>
  )
}

function BattleSession({
  packs,
  gameCount,
  roundsPerGame,
  cap,
  practice,
  source,
  hash,
  onCap,
  onPractice,
  onSource,
  onHash,
  onReplaceFirst,
}: {
  packs: readonly GamePack[]
  gameCount: number
  roundsPerGame: number
  cap: number
  practice: boolean
  source: string
  hash?: string
  onCap: (cap: number) => void
  onPractice: () => void
  onSource: (source: string) => void
  onHash: (hash: string) => void
  onReplaceFirst: (pack: GamePack) => void
}) {
  const [battle] = useState(() =>
    createBattleGround(packs, {
      timeCapMs: cap,
      actionCap: 300,
      startPaused: true,
      roundsPerGame,
      practice,
    })
  )
  const snapshot = useSyncExternalStore(
    battle.subscribe,
    battle.getSnapshot,
    battle.getSnapshot
  )
  const models = useLearnerModel()
  const { getModel, endRound, startRound } = models
  const [started, setStarted] = useState(false)
  const [rulesShown, setRulesShown] = useState(false)
  const [agentStatus, setAgentStatus] = useState("Ready")
  const [claim, setClaim] = useState("")
  const [lastCell, setLastCell] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const humanPack = packs[snapshot.cursors.human.index]
  const learnerPack = packs[snapshot.cursors.learner.index]
  const humanCursor = snapshot.cursors.human
  const humanDone = started && snapshot.attempts.human.status !== "playing"
  const learnerPlaying =
    started && snapshot.attempts.learner.status === "playing"
  const armed = started && !snapshot.matchComplete

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!started) return
    const timer = setInterval(battle.tick, 250)
    return () => clearInterval(timer)
  }, [battle, started])
  useEffect(() => {
    if (!snapshot.matchComplete) return
    endRound(MATCH_ID)
  }, [endRound, snapshot.matchComplete])
  useEffect(() => {
    if (!started) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const memory = createLearnerMemory()
    const memories: Record<string, LearnerMemory> = {}
    const closed = new Set<number>()
    let family: string | null = null
    const syncMemory = () => {
      const pack = packs[battle.getSnapshot().cursors.learner.index]
      const nextFamily = transferGroup(pack)
      if (family === nextFamily) return
      if (family === null) {
        family = nextFamily
        memories[nextFamily] = {
          claims: [...memory.claims],
          currentClaim: null,
        }
        memory.currentClaim = null
        return
      }
      memories[family] = {
        claims: [...memory.claims],
        currentClaim: memory.currentClaim,
      }
      family = nextFamily
      const stored = memories[nextFamily] ?? createLearnerMemory()
      memories[nextFamily] = stored
      memory.claims = [...stored.claims]
      memory.currentClaim = null
    }
    const runner = createGameLearnerRunner({
      observe: () => battle.boardProps("learner"),
      api: battle.actions("learner"),
      memory,
      model: getModel,
      decide: async (request, signal) => {
        if (!disposed) setAgentStatus("Thinking")
        const result = await fetchGameLearnerDecision(request, signal)
        if (!disposed) {
          setAgentStatus(
            result.state === "decision"
              ? `Playing · ${result.action?.type ?? "wait"}`
              : result.reason === "deadline"
                ? "Thinking took too long; retrying"
                : result.reason === "unavailable"
                  ? "Connection unavailable; retrying"
                  : "Considering next move"
          )
          if (result.patternClaim) setClaim(result.patternClaim)
        }
        return result
      },
    })
    const unsubscribe = battle.subscribe(runner.sync)
    const closeRound = () => {
      const snap = battle.getSnapshot()
      const seed = snap.seeds.learner
      if (snap.attempts.learner.status === "playing" || closed.has(seed)) return
      closed.add(seed)
      const line = memory.currentClaim
      if (line && !memory.claims.includes(line)) memory.claims.push(line)
      if (line) battle.claim("learner", line)
      memory.currentClaim = null
    }
    async function loop() {
      if (disposed) return
      const snap = battle.getSnapshot()
      if (snap.attempts.learner.status !== "playing") {
        closeRound()
        if (!battle.advance("learner")) {
          if (!disposed) setAgentStatus(snap.attempts.learner.status)
          return
        }
        if (!disposed) setClaim("")
        syncMemory()
      }
      try {
        await runner.step()
      } catch {
        if (!disposed) setAgentStatus("Connection interrupted; retrying")
      }
      if (!disposed) timer = setTimeout(() => void loop(), 500)
    }
    void loop()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      runner.dispose()
    }
  }, [battle, getModel, packs, started])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "z" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return
      const attempt = battle.getSnapshot().attempts.human
      if (attempt.status !== "playing" || !attempt.state.history.length) return
      battle.actions("human").undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [battle])

  async function generate(transfer: boolean) {
    if (busy || armed) {
      setNotice({ x: 24, y: 24, text: "Finish your attempt first" })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/game-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: crypto.getRandomValues(new Uint32Array(1))[0],
          n: humanPack.n,
          preferences: {
            categories: [humanPack.category],
            visibility: "full",
            targetSeconds: humanPack.session.targetSeconds,
          },
          ...(transfer && hash ? { transferFrom: hash } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      })
      const result = (await response.json()) as Generated & { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? "Generation did not finish. Try again.")
      const next = packSchema.parse(result.pack)
      if (next.category !== humanPack.category)
        throw new Error("The generator returned another game category.")
      if (packs.some((pack, index) => index > 0 && pack.seed === next.seed))
        throw new Error("That seed is already in this match.")
      onSource(
        `${result.meta.source} · ${(result.meta.elapsedMs / 1000).toFixed(1)}s`
      )
      onHash(result.meta.contentHash)
      onReplaceFirst(next)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not generate a pack."
      )
    } finally {
      setBusy(false)
    }
  }

  const humanBoard = battle.boardProps("human")
  const learnerBoard = battle.boardProps("learner")
  const humanAttempt = snapshot.attempts.human
  const learnerAttempt = snapshot.attempts.learner
  const report = verifyGame(
    humanPack,
    humanBoard.cells.map((cell) => (cell.visible ? cell.value : null))
  )
  const showInvalid =
    !report.valid &&
    humanPack.category !== "tile_rotate_connect" &&
    humanPack.category !== "lights_toggle"
  const handleStart = () => {
    if (models.status !== "ready" || !startRound(MATCH_ID)) return
    if (!battle.start()) return
    setStarted(true)
  }
  const handleTap = (cell: number) => {
    setLastCell(cell)
    const actions = battle.actions("human")
    actions.selectCell(cell)
    actions.cycle()
  }
  const handleNext = () => {
    if (!battle.advance("human")) return
  }
  const nextLabel = !snapshot.hasNext.human
    ? "Match complete"
    : humanCursor.round + 1 >= roundsPerGame
      ? "Next game"
      : "Next round"
  return (
    <main className="battle-ground">
      <header className="battle-top">
        <div className="match-progress" aria-label="Human and Agent match progress">
          {(["human", "learner"] as const).map((side) => {
            const cursor = snapshot.cursors[side]
            const label = side === "human" ? "Human" : "Agent"
            return (
              <section key={side} className="match-side" aria-label={`${label} progress`}>
                <header>
                  <strong>{label}</strong>
                  <span>
                    {roundText(cursor, gameCount, roundsPerGame)} ·{" "}
                    {clock(snapshot.remainingMs[side])} left
                  </span>
                </header>
                <ol className="match-games">
                  {Array.from({ length: gameCount }, (_, game) => (
                    <li key={game} className="match-game">
                      <span className="match-game-name">
                        {names[packs[game * roundsPerGame].category]}
                      </span>
                      <span className="small-rounds">
                        {Array.from({ length: roundsPerGame }, (_, round) => {
                          const index = game * roundsPerGame + round
                          const done = snapshot.records.some(
                            (record) =>
                              record.side === side &&
                              record.seed === packs[index].seed
                          )
                          const current = cursor.index === index
                          return (
                            <span
                              key={packs[index].seed}
                              className="small-round"
                              data-current={current || undefined}
                              data-done={done || undefined}
                              aria-label={
                                done
                                  ? `${label} game ${game + 1} round ${round + 1}, done`
                                  : current
                                    ? `${label} game ${game + 1} round ${round + 1}, current`
                                    : `${label} game ${game + 1} round ${round + 1}`
                              }
                            >
                              {round + 1}
                            </span>
                          )
                        })}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </div>
        <div className="brand-block">
          <div className="wordmark">astra-vs-human</div>
          <p className="match-lede">
            You play the left board. The agent plays the right, on its own clock.
          </p>
        </div>
        <div className="battle-settings">
          <label>
            Learner{" "}
            <select
              aria-label="Learner model"
              value={models.selectedModel ?? ""}
              disabled={armed || busy || models.isFrozen || models.status !== "ready"}
              onChange={(event) => models.selectModel(event.target.value)}
            >
              {models.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cap{" "}
            <select
              aria-label="Per-attempt time cap"
              value={cap}
              disabled={armed || busy}
              onChange={(event) => onCap(Number(event.target.value))}
            >
              <option value={120000}>2 minutes</option>
              <option value={600000}>10 minutes, if stuck</option>
            </select>
          </label>
          <button
            type="button"
            className="paper-button"
            aria-pressed={practice}
            disabled={armed || busy}
            aria-label={
              practice
                ? "Test mode: scores excluded. Switch to a scored round"
                : "Scored round. Switch to test mode"
            }
            onClick={onPractice}
          >
            {practice ? <LockOpen /> : <Lock />}
            {practice ? "Test" : "Real"}
          </button>
        </div>
        <div className="match-actions">
          <button
            type="button"
            className="primary-button"
            data-slot="match-next"
            disabled={
              busy ||
              (!rulesShown
                ? false
                : !started
                  ? models.status !== "ready"
                  : !humanDone || !snapshot.canAdvance.human)
            }
            onClick={() => {
              if (!rulesShown) {
                setRulesShown(true)
                return
              }
              if (!started) {
                handleStart()
                return
              }
              handleNext()
            }}
          >
            <Play />
            {!rulesShown ? "Show rules" : !started ? "Start both" : nextLabel}
          </button>
          <p className="match-hint">
            {!rulesShown
              ? "Rules are the same for both players."
              : !started
                ? models.status === "ready"
                  ? "Start begins both clocks together."
                  : "Learner model is loading."
                : !humanDone
                  ? "Next stays yours. The agent is not moved."
                  : learnerPlaying
                    ? "The agent is still on its round."
                    : snapshot.canAdvance.human
                      ? "Your next board. The agent keeps going."
                      : "Both sides finished this match."}
          </p>
        </div>
      </header>
      <div className="battle-title">
        <h1>{names[humanPack.category]}</h1>
        <span className="mode-badge">{humanPack.mode}</span>
        <span className="battle-size">
          {humanPack.n} × {humanPack.n}
        </span>
      </div>
      <BattleField
        pack={humanPack}
        practice={practice}
        started={started}
        finished={started && learnerAttempt.status !== "playing"}
        humanBoard={humanBoard}
        learnerBoard={learnerBoard}
        humanActions={humanAttempt.state.actions}
        learnerActions={learnerAttempt.state.actions}
        humanStatus={humanAttempt.status}
        learnerStatus={learnerAttempt.status}
        canUndo={humanAttempt.state.history.length > 0}
        agentStatus={agentStatus}
        claim={claim}
        invalidIndex={showInvalid ? lastCell : null}
        rulesShown={rulesShown}
        humanDone={humanDone}
        agentWorking={humanDone && learnerPlaying}
        splitBoards={snapshot.seeds.human !== snapshot.seeds.learner}
        onTap={handleTap}
        onUndo={() => battle.actions("human").undo()}
        onClear={() => battle.actions("human").clear()}
      />
      <footer className="battle-footer">
        <div className="footer-tools">
          <button
            type="button"
            className="paper-button"
            disabled={busy || armed}
            onClick={() => void generate(true)}
          >
            {busy ? "Generating…" : "Respawn same family"}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={busy || armed}
            onClick={() => void generate(false)}
          >
            Invent another variation
          </button>
        </div>
        <span className="seed">
          HUMAN SEED {humanPack.seed}
          {snapshot.seeds.human !== snapshot.seeds.learner
            ? ` · AGENT SEED ${learnerPack.seed}`
            : ""}
          {source ? ` · ${source}` : ""}
        </span>
        <div className="transfer-line" aria-label="Learning across rounds">
          {practice ? (
            <span>Practice · excluded from scores</span>
          ) : (
            (["human", "learner"] as const).map((side) => {
              const cursor = snapshot.cursors[side]
              const group = transferGroup(packs[cursor.index])
              const score = scoreTransfer(snapshot.records, side, group)
              const count = snapshot.records.filter(
                (record) =>
                  record.side === side &&
                  record.transferGroup === group &&
                  record.status === "finished"
              ).length
              return (
                <span key={side}>
                  <strong>{side === "human" ? "Human" : "Agent"}</strong> ·{" "}
                  {names[packs[cursor.index].category]} ·{" "}
                  {score.eligible
                    ? `action slope ${score.actionSlope?.toFixed(1)} per round${score.actionsFalling ? " · actions falling" : ""}`
                    : `${count}/3 completed transfer rounds`}
                </span>
              )
            })
          )}
        </div>
        {error ? (
          <p role="alert" className="battle-error">
            {error}
          </p>
        ) : null}
      </footer>
      {notice ? (
        <div role="status" className="cursor-notice" style={{ left: notice.x + 12, top: notice.y + 12 }}>
          {notice.text}
        </div>
      ) : null}
    </main>
  )
}
