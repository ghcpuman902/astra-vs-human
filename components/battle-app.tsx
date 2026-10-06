"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Play, RotateCcw, Undo2 } from "lucide-react"

import { BattleBoard } from "@/components/battle-board"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createBattleGround,
  scoreTransfer,
  type BattleRecord,
  type Side,
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
const clock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
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
  const [source, setSource] = useState("verified starter")
  const [hash, setHash] = useState<string | undefined>()
  const [records, setRecords] = useState<BattleRecord[]>([])
  const [cap, setCap] = useState(600000)
  const [memory, setMemory] = useState(createLearnerMemory)
  const memories = useRef<Record<string, LearnerMemory>>({})
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
  function pick(index: number) {
    if (locked || busy || index === selected) return
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
  return (
    <main className="battle-page">
      <header className="battle-topbar">
        <div className="battle-brand">
          <span className="brand-grid" aria-hidden="true">
            ◩
          </span>
          astra-vs-human
        </div>
        <span className="battle-caption">
          Same board. Same taps. Same clock.
        </span>
      </header>
      <nav className="category-nav" aria-label="Game mechanics">
        <ToggleGroup
          value={[String(selected)]}
          onValueChange={(values) => {
            if (values[0] !== undefined) pick(Number(values[0]))
          }}
          aria-label="Game mechanics"
          className="flex-wrap"
        >
          {fixtures.map((fixture, index) => (
            <ToggleGroupItem
              key={fixture.category}
              value={String(index)}
              disabled={locked || busy}
            >
              {names[fixture.category]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <label className="practice-choice" htmlFor="practice-preview">
          <Switch
            id="practice-preview"
            size="sm"
            checked={practice}
            disabled={locked || busy}
            onCheckedChange={(value) => {
              setPractice(value)
              setRevision((current) => current + 1)
            }}
          />
          Practice preview
        </label>
      </nav>
      <div className="battle-heading">
        <div>
          <p className="eyebrow">
            HUMAN × LEARNER · ROUND{" "}
            {records.filter((r) => r.side === "human" && r.seed !== pack.seed)
              .length + 1}
          </p>
          <h1>
            {names[pack.category]}{" "}
            <span>
              {pack.n} × {pack.n}
            </span>
          </h1>
        </div>
        <Badge variant="outline">{pack.mode}</Badge>
      </div>
      <Round
        key={`${pack.seed}:${revision}:${cap}:${practice}`}
        pack={pack}
        cap={cap}
        practice={practice}
        loading={busy}
        memory={memory}
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
      <section className="respawn-panel" aria-label="Generation controls">
        <div>
          <strong>Carry the pattern forward</strong>
          <p>A fresh board in the same game family.</p>
        </div>
        <div className="respawn-controls">
          <Button
            variant="outline"
            disabled={busy || locked}
            onClick={() => void generate(true)}
          >
            {busy ? "Generating…" : "Respawn same family"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || locked}
            onClick={() => void generate(false)}
          >
            Invent another variation
          </Button>
        </div>
        <label className="cap-choice">
          Shared cap{" "}
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
        {error && (
          <p role="alert" className="battle-error">
            {error}
          </p>
        )}
      </section>
      <section
        className="transfer-summary"
        aria-label="Learning across respawns"
      >
        {(["human", "learner"] as const).map((side) => {
          const score = scoreTransfer(records, side, family)
          const count = records.filter(
            (r) =>
              r.side === side &&
              r.transferGroup === family &&
              r.status === "finished"
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
      </section>
      <footer className="battle-page-footer">
        <span>
          We score the pattern they carried forward, not the puzzle class they
          recognised.
        </span>
        <span>{source}</span>
      </footer>
    </main>
  )
}

function Round({
  pack,
  cap,
  practice,
  loading,
  memory,
  onLock,
  onEnd,
}: {
  pack: GamePack
  cap: number
  practice: boolean
  loading: boolean
  memory: LearnerMemory
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
  const [side, setSide] = useState<Side>("human")
  const [agentStatus, setAgentStatus] = useState("Ready")
  const [claim, setClaim] = useState("")
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
  }, [battle, memory, started])
  useEffect(() => {
    if (!finished || ended.current) return
    ended.current = true
    if (memory.currentClaim && !memory.claims.includes(memory.currentClaim))
      memory.claims.push(memory.currentClaim)
    onLock(false)
    onEnd([...snapshot.records])
  }, [finished, memory, onEnd, onLock, snapshot.records])
  const board = battle.boardProps(side)
  const human = battle.actions("human")
  return (
    <section className="round-layout" aria-label="Shared puzzle round">
      <div className="play-column">
        <div className="dual-clocks">
          {(["human", "learner"] as const).map((player) => {
            const attempt = snapshot.attempts[player]
            return (
              <div key={player} className="player-clock">
                <strong>{player === "human" ? "HUMAN" : "AGENT · L0"}</strong>
                <time aria-label={`${player} elapsed time`}>
                  {clock(attempt.endedAtMs ?? cap - snapshot.remainingMs)}
                </time>
                <span>
                  {attempt.state.actions} actions ·{" "}
                  {started ? attempt.status : "ready"}
                </span>
              </div>
            )
          })}
        </div>
        <Tabs value={side} onValueChange={(value) => setSide(value as Side)}>
          <TabsList variant="line" aria-label="View player">
            <TabsTrigger value="human">Human</TabsTrigger>
            <TabsTrigger value="learner">Agent · read-only</TabsTrigger>
          </TabsList>
          <TabsContent value={side}>
            {practice && (
              <div className="practice-note">
                <span>Practice · excluded from learning scores</span>
                {!started && (
                  <Button
                    disabled={loading}
                    onClick={() => {
                      battle.start()
                      setStarted(true)
                      onLock(true)
                    }}
                  >
                    <Play data-icon="inline-start" />
                    Start both players
                  </Button>
                )}
              </div>
            )}
            <div className="board-stage">
              {started || practice ? (
                <BattleBoard
                  board={started ? board : { ...board, readOnly: true }}
                  onSelectCycle={(cell) => {
                    human.selectCell(cell)
                    human.cycle()
                  }}
                />
              ) : (
                <div className="board-cover">
                  <span className="cover-symbol" aria-hidden="true">
                    ◩
                  </span>
                  <strong>Ready when you are.</strong>
                  <p>Read the postcard, then start both clocks.</p>
                  <Button
                    disabled={loading}
                    onClick={() => {
                      battle.start()
                      setStarted(true)
                      onLock(true)
                    }}
                  >
                    <Play data-icon="inline-start" />
                    Start both players
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <div className="battle-toolbar">
          <Button
            variant="outline"
            disabled={
              !started ||
              side !== "human" ||
              board.status !== "playing" ||
              !snapshot.attempts.human.state.history.length
            }
            onClick={human.undo}
          >
            <Undo2 data-icon="inline-start" />
            Undo
          </Button>
          <Button
            variant="outline"
            disabled={
              !started || side !== "human" || board.status !== "playing"
            }
            onClick={human.clear}
          >
            <RotateCcw data-icon="inline-start" />
            Clear
          </Button>
          <Button
            variant="ghost"
            disabled
            title="Hints are practice-only. This is a scored round."
          >
            Hint · practice only
          </Button>
        </div>
        <div className="round-status">
          <span>SHARED SEED {pack.seed}</span>
          <span>
            {started
              ? `${clock(snapshot.remainingMs)} left`
              : `Typical round ${pack.session.targetSeconds}s`}
          </span>
        </div>
        {finished && (
          <p role="status">
            Both players ended. Respawn to carry the pattern forward.
          </p>
        )}
      </div>
      <aside className="postcard">
        <p className="eyebrow">POSTCARD · {pack.mode}</p>
        <h2>{pack.postcard.goal}</h2>
        <ol>
          {pack.postcard.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
        <div className="agent-activity">
          <p className="eyebrow">LEARNER · SAME FOUR CONTROLS</p>
          <p aria-live="polite">
            {snapshot.attempts.learner.status === "playing"
              ? agentStatus
              : snapshot.attempts.learner.status}
          </p>
          {finished && claim && <blockquote>{claim}</blockquote>}
          <p className="fine-print">
            The agent sees this board’s public clues and postcard. It selects,
            cycles, undoes and clears. No answer or solver is supplied.
          </p>
        </div>
      </aside>
    </section>
  )
}
