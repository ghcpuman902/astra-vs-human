"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Lock, LockOpen } from "lucide-react"

import { BattleField } from "@/components/lovable/battle-field"
import { useLearnerModel } from "@/hooks/use-learner-model"
import { verifyGame } from "@/lib/mini-game-rules/verifier"
import {
  createBattleGround,
  scoreTransfer,
  type BattleRecord,
} from "@/lib/battle-ground-ui/controller"
import {
  createGameLearnerRunner,
  fetchGameLearnerDecision,
} from "@/lib/battle-ground-ui/model-learner"
import { packSchema, type GamePack } from "@/lib/mini-game-rules/schema"
import { createLearnerMemory, type LearnerMemory } from "@/lib/puzzle/learner"

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

export function BattleApp({ fixtures }: { fixtures: GamePack[] }) {
  const [selected, setSelected] = useState(0)
  const [pack, setPack] = useState(fixtures[0])
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [practice, setPractice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [source, setSource] = useState("verified starter")
  const [hash, setHash] = useState<string | undefined>()
  const [records, setRecords] = useState<BattleRecord[]>([])
  const [cap, setCap] = useState(600000)
  const [memory, setMemory] = useState(createLearnerMemory)
  const memories = useRef<Record<string, LearnerMemory>>({})
  const models = useLearnerModel()
  const roundId = `${pack.seed}:${revision}`
  const family = `${pack.category}:${pack.n}:${pack.mode}:${pack.visibility.kind}:${pack.transfer.family}`

  async function generate(transfer: boolean) {
    if (busy || locked) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/game-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: crypto.getRandomValues(new Uint32Array(1))[0],
          n: pack.n,
          preferences: {
            categories: [pack.category],
            visibility: "full",
            targetSeconds: pack.session.targetSeconds,
          },
          ...(transfer && hash ? { transferFrom: hash } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      })
      const result = (await response.json()) as Generated & { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? "Generation did not finish. Try again.")
      const next = packSchema.parse(result.pack)
      if (next.category !== pack.category)
        throw new Error("The generator returned another game category.")
      memories.current[family] = memory
      const nextFamily = `${next.category}:${next.n}:${next.mode}:${next.visibility.kind}:${next.transfer.family}`
      setMemory(memories.current[nextFamily] ?? createLearnerMemory())
      setPack(next)
      setHash(result.meta.contentHash)
      setSource(
        `${result.meta.source} · ${(result.meta.elapsedMs / 1000).toFixed(1)}s`
      )
      setRevision((v) => v + 1)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not generate a pack."
      )
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])
  function pick(index: number, event?: { clientX: number; clientY: number }) {
    if (index === selected) return
    if (locked || busy) {
      setNotice({
        x: event?.clientX ?? 24,
        y: event?.clientY ?? 24,
        text: "Finish this round first",
      })
      return
    }
    memories.current[family] = memory
    const next = fixtures[index]
    const nextFamily = `${next.category}:${next.n}:${next.mode}:${next.visibility.kind}:${next.transfer.family}`
    setMemory(memories.current[nextFamily] ?? createLearnerMemory())
    setSelected(index)
    setPack(fixtures[index])
    setHash(undefined)
    setSource("verified starter")
    setRevision((v) => v + 1)
    setError(null)
  }
  const roundNumber =
    records.filter((record) => record.side === "human" && record.seed !== pack.seed)
      .length + 1
  return (
    <main className="battle-ground">
      <header className="battle-top">
        <div className="wordmark">astra-vs-human · Round {roundNumber}</div>
        <div className="battle-settings">
          <label>
            Learner{" "}
            <select
              aria-label="Learner model"
              value={models.selectedModel ?? ""}
              disabled={
                locked || busy || models.isFrozen || models.status !== "ready"
              }
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
              aria-label="Shared round time cap"
              value={cap}
              disabled={locked || busy}
              onChange={(event) => setCap(Number(event.target.value))}
            >
              <option value={120000}>2 minutes</option>
              <option value={600000}>10 minutes, if stuck</option>
            </select>
          </label>
          <button
            type="button"
            className="paper-button"
            aria-pressed={practice}
            disabled={locked || busy}
            aria-label={
              practice
                ? "Test mode: scores excluded. Switch to a scored round"
                : "Scored round. Switch to test mode"
            }
            onClick={() => {
              setPractice((value) => !value)
              setRevision((current) => current + 1)
            }}
          >
            {practice ? <LockOpen /> : <Lock />}
            {practice ? "Test" : "Real"}
          </button>
        </div>
        <nav className="game-tabs" aria-label="Round games">
          {fixtures.map((fixture, index) => {
            const done = records.some(
              (record) =>
                record.side === "human" &&
                record.seed === fixture.seed &&
                record.status === "finished"
            )
            return (
              <button
                key={fixture.category}
                type="button"
                className="paper-button"
                aria-current={selected === index ? "step" : undefined}
                aria-disabled={locked || busy ? true : undefined}
                onClick={(event) => pick(index, event)}
              >
                {index + 1}. {names[fixture.category]}
                {done ? " ✓" : ""}
              </button>
            )
          })}
        </nav>
      </header>
      <div className="battle-title">
        <h1>{names[pack.category]}</h1>
        <span className="mode-badge">{pack.mode}</span>
        <span className="battle-size">
          {pack.n} × {pack.n}
        </span>
      </div>
      <Round
        key={`${pack.seed}:${revision}:${cap}:${practice}`}
        pack={pack}
        cap={cap}
        practice={practice}
        loading={busy}
        memory={memory}
        modelsReady={models.status === "ready"}
        getModel={models.getModel}
        onBegin={() => models.startRound(roundId)}
        onFinish={() => {
          models.endRound(roundId)
        }}
        onLock={(value) => setLocked(value && !practice)}
        onEnd={(roundRecords) =>
          !practice &&
          setRecords((previous) => [
            ...previous.filter(
              (record) =>
                !roundRecords.some(
                  (next) =>
                    next.seed === record.seed && next.side === record.side
                )
            ),
            ...roundRecords,
          ])
        }
      />
      <footer className="battle-footer">
        <div className="footer-tools">
          <button
            type="button"
            className="paper-button"
            disabled={busy || locked}
            onClick={() => void generate(true)}
          >
            {busy ? "Generating…" : "Respawn same family"}
          </button>
          <button
            type="button"
            className="paper-button"
            disabled={busy || locked}
            onClick={() => void generate(false)}
          >
            Invent another variation
          </button>
        </div>
        <span className="seed">
          SEED {pack.seed}
          {source ? ` · ${source}` : ""}
        </span>
        <div className="transfer-line" aria-label="Learning across respawns">
          {(["human", "learner"] as const).map((side) => {
            const score = scoreTransfer(records, side, family)
            const count = records.filter(
              (record) =>
                record.side === side &&
                record.transferGroup === family &&
                record.status === "finished"
            ).length
            return (
              <span key={side}>
                <strong>{side === "human" ? "Human" : "Learner"}</strong> ·{" "}
                {score.eligible
                  ? `action slope ${score.actionSlope?.toFixed(1)} per round${score.actionsFalling ? " · actions falling" : ""}`
                  : `${count}/3 completed transfer rounds`}
              </span>
            )
          })}
        </div>
        {error ? (
          <p role="alert" className="battle-error">
            {error}
          </p>
        ) : null}
      </footer>
      {notice ? (
        <div
          role="status"
          className="cursor-notice"
          style={{ left: notice.x + 12, top: notice.y + 12 }}
        >
          {notice.text}
        </div>
      ) : null}
    </main>
  )
}

function Round({
  pack,
  cap,
  practice,
  loading,
  memory,
  modelsReady,
  getModel,
  onBegin,
  onFinish,
  onLock,
  onEnd,
}: {
  pack: GamePack
  cap: number
  practice: boolean
  loading: boolean
  memory: LearnerMemory
  modelsReady: boolean
  getModel: () => string | undefined
  onBegin: () => string | undefined
  onFinish: () => void
  onLock: (locked: boolean) => void
  onEnd: (records: BattleRecord[]) => void
}) {
  const [battle] = useState(() =>
    createBattleGround([pack], {
      timeCapMs: cap,
      actionCap: 300,
      startPaused: true,
    })
  )
  const snapshot = useSyncExternalStore(
    battle.subscribe,
    battle.getSnapshot,
    battle.getSnapshot
  )
  const [started, setStarted] = useState(false)
  const [rulesShown, setRulesShown] = useState(false)
  const [agentStatus, setAgentStatus] = useState("Ready")
  const [claim, setClaim] = useState("")
  const [lastCell, setLastCell] = useState<number | null>(null)
  const finished =
    snapshot.attempts.human.status !== "playing" &&
    snapshot.attempts.learner.status !== "playing"
  const ended = useRef(false)
  useEffect(() => {
    if (!started) return
    const timer = setInterval(battle.tick, 250)
    return () => clearInterval(timer)
  }, [battle, started])
  useEffect(() => {
    if (!started) return
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined
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
    async function next() {
      if (
        disposed ||
        battle.getSnapshot().attempts.learner.status !== "playing"
      )
        return
      try {
        await runner.step()
      } catch {
        if (!disposed) setAgentStatus("Connection interrupted; retrying")
      }
      if (!disposed) {
        if (memory.currentClaim) battle.claim("learner", memory.currentClaim)
        timer = setTimeout(() => void next(), 500)
      }
    }
    void next()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      runner.dispose()
    }
  }, [battle, getModel, memory, started])
  useEffect(() => {
    if (!finished || ended.current) return
    ended.current = true
    if (memory.currentClaim && !memory.claims.includes(memory.currentClaim))
      memory.claims.push(memory.currentClaim)
    onLock(false)
    onFinish()
    onEnd([...snapshot.records])
  }, [finished, memory, onEnd, onFinish, onLock, snapshot.records])
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
  const humanBoard = battle.boardProps("human")
  const learnerBoard = battle.boardProps("learner")
  const humanAttempt = snapshot.attempts.human
  const learnerAttempt = snapshot.attempts.learner
  const report = verifyGame(
    pack,
    humanBoard.cells.map((cell) => (cell.visible ? cell.value : null))
  )
  const showInvalid =
    !report.valid &&
    pack.category !== "tile_rotate_connect" &&
    pack.category !== "lights_toggle"
  const handleStart = () => {
    if (!modelsReady || !onBegin()) return
    battle.start()
    setStarted(true)
    onLock(true)
  }
  const handleTap = (cell: number) => {
    setLastCell(cell)
    const actions = battle.actions("human")
    actions.selectCell(cell)
    actions.cycle()
  }
  return (
    <BattleField
      pack={pack}
      practice={practice}
      loading={loading || !modelsReady}
      started={started}
      finished={finished}
      remainingMs={snapshot.remainingMs}
      humanBoard={humanBoard}
      learnerBoard={learnerBoard}
      humanActions={humanAttempt.state.actions}
      learnerActions={learnerAttempt.state.actions}
      humanStatus={humanAttempt.status}
      learnerStatus={learnerAttempt.status}
      humanElapsedMs={humanAttempt.endedAtMs ?? (started ? cap - snapshot.remainingMs : 0)}
      learnerElapsedMs={learnerAttempt.endedAtMs ?? (started ? cap - snapshot.remainingMs : 0)}
      canUndo={humanAttempt.state.history.length > 0}
      agentStatus={agentStatus}
      claim={claim}
      invalidIndex={showInvalid ? lastCell : null}
      rulesShown={rulesShown}
      onReveal={() => setRulesShown(true)}
      onStart={handleStart}
      onTap={handleTap}
      onUndo={() => battle.actions("human").undo()}
      onClear={() => battle.actions("human").clear()}
    />
  )
}
