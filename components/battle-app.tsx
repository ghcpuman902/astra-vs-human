"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Lock, LockOpen, Play } from "lucide-react"

import { BattleField } from "@/components/lovable/battle-field"
import { useLearnerModel } from "@/hooks/use-learner-model"
import { useSideLearner } from "@/hooks/use-side-learner"
import {
  createBattleGround,
  scoreTransfer,
  transferGroup,
  type SideCursor,
} from "@/lib/battle-ground-ui/controller"
import {
  matchFamilies,
  orderByFamily,
  type FamilyMarks,
} from "@/lib/battle-ground-ui/family-bias"
import {
  learnerModeIds,
  type LearnerMixId,
} from "@/lib/battle-ground-ui/learner-mix"
import type { MatchDeck } from "@/lib/battle-ground-ui/match-deck"
import { packSchema, type GamePack } from "@/lib/mini-game-rules/schema"
import { verifyGame } from "@/lib/mini-game-rules/verifier"

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
  const [arena, setArena] = useState<"play" | "watch">("play")
  const [leftMix, setLeftMix] = useState<LearnerMixId>("astra")
  const [rightMix, setRightMix] = useState<LearnerMixId>("astra")
  const [cap, setCap] = useState(600000)
  const [practice, setPractice] = useState(false)
  const [session, setSession] = useState(0)
  const [source, setSource] = useState("verified starter")
  const [hash, setHash] = useState<string | undefined>()
  if (!packs) {
    return (
      <FamilyGate
        arena={arena}
        leftMix={leftMix}
        rightMix={rightMix}
        onArena={setArena}
        onLeftMix={setLeftMix}
        onRightMix={setRightMix}
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
      arena={arena}
      leftMix={leftMix}
      rightMix={rightMix}
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

const mixCopy: Record<
  (typeof learnerModeIds)[number],
  { label: string; detail: string }
> = {
  astra: {
    label: "Astra",
    detail: "Same public board as you. Astra names one cell or a short burst of taps.",
  },
  code: {
    label: "Code",
    detail: "Astra writes a tiny policy. This browser runs it. No JavaScript is eval'd.",
  },
  "astra-jev": {
    label: "Astra + Jev",
    detail: "Astra writes the plan as context. Jev commits it when a Jev credential is set.",
  },
  "jev-bare": {
    label: "Jev bare",
    detail: "Jev sees the public board only. No Astra plan is wrapped around it.",
  },
  "astra-laya": {
    label: "Astra + Laya",
    detail: "Astra writes the plan as context. Laya commits it when a Laya credential is set.",
  },
  "laya-bare": {
    label: "Laya bare",
    detail: "Laya sees the public board only. No Astra plan is wrapped around it.",
  },
  "openai-decisions": {
    label: "Decisions",
    detail: "OpenAI Decisions stays on this machine. Nothing is sent.",
  },
}

function modeNote(
  mix: LearnerMixId,
  servers: { openai: boolean; gateway: boolean; jev: boolean; laya: boolean } | null
) {
  if (!servers) return ""
  if (mix === "openai-decisions") return ""
  if (mix === "jev-bare" || mix === "astra-jev") {
    return servers.jev
      ? "Jev can run on this server."
      : "Jev is not configured, so this side waits."
  }
  if (mix === "laya-bare" || mix === "astra-laya") {
    return servers.laya
      ? "Laya can run on this server."
      : "Laya is not configured, so this side waits."
  }
  if (!servers.openai && !servers.gateway)
    return "No Astra credential is set, so this side waits."
  return ""
}

function ModePicker({
  legend,
  mix,
  servers,
  onMix,
}: {
  legend: string
  mix: LearnerMixId
  servers: { openai: boolean; gateway: boolean; jev: boolean; laya: boolean } | null
  onMix: (mix: LearnerMixId) => void
}) {
  const note = modeNote(mix, servers)
  const copy = mixCopy[mix as (typeof learnerModeIds)[number]] ?? mixCopy.astra
  return (
    <fieldset className="choice-row">
      <legend>{legend}</legend>
      {learnerModeIds.map((id) => (
        <button
          key={id}
          type="button"
          className="paper-button"
          aria-pressed={mix === id}
          onClick={() => onMix(id)}
        >
          {mixCopy[id].label}
        </button>
      ))}
      <p>
        {copy.detail}
        {note ? ` ${note}` : ""}
      </p>
    </fieldset>
  )
}

function FamilyGate({
  arena,
  leftMix,
  rightMix,
  onArena,
  onLeftMix,
  onRightMix,
  onPlay,
}: {
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  onArena: (arena: "play" | "watch") => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onPlay: (marks: FamilyMarks) => void
}) {
  const families = matchFamilies()
  const [played, setPlayed] = useState<readonly string[]>([])
  const [disliked, setDisliked] = useState<readonly string[]>([])
  const [servers, setServers] = useState<{
    openai: boolean
    gateway: boolean
    jev: boolean
    laya: boolean
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/learner-mix")
      .then((response) => response.json())
      .then(
        (body: {
          openai?: unknown
          gateway?: unknown
          jev?: unknown
          laya?: unknown
        }) => {
          if (cancelled) return
          setServers({
            openai: body.openai === true,
            gateway: body.gateway === true,
            jev: body.jev === true,
            laya: body.laya === true,
          })
        }
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
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
  const watching = arena === "watch"
  return (
    <main className="battle-ground is-setup">
      <a className="skip-link" href="#start-match">
        Skip to start
      </a>
      <form
        className="family-gate"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay({ played, disliked })
        }}
      >
        <header className="setup-intro">
          <p className="wordmark">astra-vs-human</p>
          <h1>Same rules. Two clocks.</h1>
          <p>
            Pick who plays. Mark families you have played or want less of.
            Then start. New families come first. All five stay.
          </p>
        </header>
        <fieldset className="variant-grid">
          <legend>1 · Who plays</legend>
          <button
            type="button"
            className="variant-card"
            aria-pressed={arena === "play"}
            onClick={() => onArena("play")}
          >
            <span className="variant-boards" aria-hidden="true">
              <span>You</span>
              <span>Agent</span>
            </span>
            <strong>You vs Agent</strong>
            <span>You tap the left board.</span>
          </button>
          <button
            type="button"
            className="variant-card"
            aria-pressed={arena === "watch"}
            onClick={() => onArena("watch")}
          >
            <span className="variant-boards" aria-hidden="true">
              <span>A</span>
              <span>B</span>
            </span>
            <strong>Agent vs Agent</strong>
            <span>You watch both clocks.</span>
          </button>
        </fieldset>
        <fieldset className="family-block">
          <legend>2 · Families you already know</legend>
          <ul className="family-list">
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
        </fieldset>
        {watching ? (
          <>
            <ModePicker
              legend="3 · Agent A"
              mix={leftMix}
              servers={servers}
              onMix={onLeftMix}
            />
            <ModePicker
              legend="4 · Agent B"
              mix={rightMix}
              servers={servers}
              onMix={onRightMix}
            />
          </>
        ) : (
          <ModePicker
            legend="3 · Agent ability"
            mix={rightMix}
            servers={servers}
            onMix={onRightMix}
          />
        )}
        <button id="start-match" type="submit" className="primary-button">
          Start
        </button>
      </form>
    </main>
  )
}

function BattleSession({
  packs,
  arena,
  leftMix,
  rightMix,
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
  arena: "play" | "watch"
  leftMix: LearnerMixId
  rightMix: LearnerMixId
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
  const watching = arena === "watch"
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
  const leftLearner = useSideLearner({
    enabled: watching,
    side: "human",
    battle,
    packs,
    started,
    mix: leftMix,
    getModel,
  })
  const rightLearner = useSideLearner({
    enabled: true,
    side: "learner",
    battle,
    packs,
    started,
    mix: rightMix,
    getModel,
  })
  const agentStatus = rightLearner.status
  const claim = rightLearner.claim
  const modeName = (mix: LearnerMixId) =>
    mixCopy[mix as (typeof learnerModeIds)[number]]?.label ?? "Astra"
  const leftName = watching ? "Agent A" : "Human"
  const rightName = watching ? "Agent B" : "Agent"
  const leftAbility = watching ? modeName(leftMix) : "Your taps"
  const rightAbility = modeName(rightMix)

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
    const onKey = (event: KeyboardEvent) => {
      if (watching) return
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
  }, [battle, watching])

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
    if (watching) return
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
      <a className="skip-link" href="#boards">
        Skip to boards
      </a>
      <header className="battle-top">
        <div className="match-progress" aria-label="Human and Agent match progress">
          {(["human", "learner"] as const).map((side) => {
            const cursor = snapshot.cursors[side]
            const label = side === "human" ? leftName : rightName
            return (
              <section key={side} className="match-side" aria-label={`${label} progress`}>
                <header>
                  <strong>{label}</strong>
                  <span className="match-clock">
                    {clock(snapshot.remainingMs[side])}
                  </span>
                </header>
                <span className="match-ability">
                  {side === "human" ? leftAbility : rightAbility}
                </span>
                <span className="match-round">
                  {roundText(cursor, gameCount, roundsPerGame)}
                </span>
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
            {watching
              ? "Two agents, two clocks. You watch. Next does not move either of them."
              : "You play the left board. The agent plays the right, on its own clock."}
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
              (watching && started) ||
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
            {!rulesShown
              ? "Show rules"
              : !started
                ? "Start both"
                : watching
                  ? "Watching"
                  : nextLabel}
          </button>
          <p className="match-hint">
            {watching && started
              ? "You are watching. Each agent keeps its own clock."
              : !rulesShown
                ? "Rules are the same for both players."
                : !started
                  ? models.status === "ready"
                    ? watching
                      ? "Start begins both agent clocks."
                      : "Start begins both clocks together."
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
        humanTitle={leftName}
        learnerTitle={rightName}
        humanInteractive={!watching}
        humanStatus={
          watching && started ? leftLearner.status : humanAttempt.status
        }
        learnerStatus={learnerAttempt.status}
        canUndo={humanAttempt.state.history.length > 0}
        agentStatus={agentStatus}
        claim={claim}
        invalidIndex={showInvalid ? lastCell : null}
        rulesShown={rulesShown}
        humanDone={humanDone}
        agentWorking={!watching && humanDone && learnerPlaying}
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
                  <strong>{side === "human" ? leftName : rightName}</strong> ·{" "}
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
