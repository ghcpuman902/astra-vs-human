"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"

import { formatThink, formatTokens } from "@/components/agent-trace"
import {
  scoreBoards,
  type CellRates,
} from "@/lib/battle-ground-ui/cell-f1"
import type {
  BattleRecord,
  BlitzTally,
  Side,
} from "@/lib/battle-ground-ui/controller"
import type { AgentTraceSnapshot } from "@/lib/battle-ground-ui/agent-trace"
import type { DealtMatch, MatchLength } from "@/lib/battle-ground-ui/match-deck"
import type { GamePack } from "@/lib/mini-game-rules/schema"

const SIDES = ["human", "learner"] as const

const formatRate = (value: number | null) =>
  value == null ? "—" : value.toFixed(2)

const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const thinkMs = (trace: AgentTraceSnapshot, now: number) =>
  trace.meters.thinkMs +
  (trace.pendingSince ? Math.max(0, now - trace.pendingSince) : 0)

const verdictReason = (
  winner: "human" | "learner" | "tie",
  human: BlitzTally,
  learner: BlitzTally
) => {
  if (winner === "tie") return "Same boards, taps, and time"
  const ahead = winner === "human" ? human : learner
  const behind = winner === "human" ? learner : human
  if (ahead.rounds !== behind.rounds) return "Cleared more boards"
  if (ahead.actions !== behind.actions) return "Fewer taps on the same boards"
  return "More time left"
}

const MODEL_ROWS = [
  {
    key: "input",
    label: "Input tokens",
    title: "Prompt tokens sent to the model",
  },
  {
    key: "output",
    label: "Output tokens",
    title: "Tokens the model wrote back",
  },
  {
    key: "reasoning",
    label: "Reasoning",
    title: "Reasoning tokens, when the model reports them",
  },
  {
    key: "think",
    label: "Thinking",
    title: "Wall time waiting on the model, summed across requests",
  },
  {
    key: "calls",
    label: "Requests",
    title: "Model calls this match, including one still in flight",
  },
  {
    key: "per",
    label: "Tokens / solved",
    title: "Input plus output tokens, divided by solved boards",
  },
] as const

export function MatchResults({
  open,
  onToggle,
  matchOver,
  watching,
  length,
  winner,
  leftName,
  rightName,
  progress,
  packs,
  solutions,
  records,
  live,
  playing,
  tallies,
  times,
  traces,
  rounds,
  sameFamilyLabel,
  onRematch,
  onNextFamily,
  onSetup,
}: {
  open: boolean
  onToggle: () => void
  matchOver: boolean
  watching: boolean
  length: MatchLength
  winner: "human" | "learner" | "tie"
  leftName: string
  rightName: string
  progress: string
  packs: readonly GamePack[]
  solutions: DealtMatch["solutions"]
  records: readonly BattleRecord[]
  live: Record<Side, { seed: number; cells: readonly (number | null)[] }>
  playing: Record<Side, boolean>
  tallies: Record<Side, BlitzTally>
  times: Record<Side, string>
  traces: Record<Side, AgentTraceSnapshot>
  rounds: Record<Side, ReactNode>
  sameFamilyLabel: string | null
  onRematch: () => void
  onNextFamily: () => void
  onSetup: () => void
}) {
  const pending =
    traces.human.pendingSince != null || traces.learner.pendingSince != null
  const now = useNow(open && pending)
  const scores = useMemo(() => {
    const packBySeed = new Map(packs.map((pack) => [pack.seed, pack]))
    const score = (side: Side): CellRates => {
      const closed = new Set(
        records.filter((record) => record.side === side).map((record) => record.seed)
      )
      const boards = records.flatMap((record) => {
        if (record.side !== side || !record.cells) return []
        const pack = packBySeed.get(record.seed)
        if (!pack) return []
        return [
          {
            gold: solutions?.[String(record.seed)],
            pred: record.cells,
            locked: pack.cells.map((cell) => cell.locked),
          },
        ]
      })
      const current = live[side]
      if (!closed.has(current.seed)) {
        const pack = packBySeed.get(current.seed)
        if (pack)
          boards.push({
            gold: solutions?.[String(current.seed)],
            pred: current.cells,
            locked: pack.cells.map((cell) => cell.locked),
          })
      }
      return scoreBoards(boards)
    }
    return { human: score("human"), learner: score("learner") }
  }, [live, packs, records, solutions])
  const names = { human: leftName, learner: rightName }
  const you = watching ? leftName : "You"
  const headline = !matchOver
    ? `${you} finished`
    : winner === "tie"
      ? "Tie"
      : winner === "human"
        ? watching
          ? `${leftName} wins`
          : "You win"
        : `${rightName} wins`
  const detail = matchOver
    ? verdictReason(winner, tallies.human, tallies.learner)
    : progress
  const verdict = !matchOver
    ? "wait"
    : winner === "tie"
      ? "tie"
      : !watching && winner === "learner"
        ? "loss"
        : "win"
  const solved = (side: Side) =>
    records.filter(
      (record) => record.side === side && record.status === "finished"
    ).length
  const markCount =
    matchOver && winner !== "tie"
      ? Math.min(8, solved(winner))
      : 0
  const f1Known = scores.human.f1 != null || scores.learner.f1 != null
  const peek =
    matchOver && !open
      ? f1Known
        ? `F1 ${formatRate(scores.human.f1)} · ${formatRate(scores.learner.f1)}`
        : "Show results"
      : open
        ? "Hide to see the boards"
        : progress
  const modelFor = (side: Side) => side === "learner" || watching
  const modelValue = (side: Side, key: (typeof MODEL_ROWS)[number]["key"]) => {
    if (!modelFor(side)) return "—"
    const trace = traces[side]
    const meters = trace.meters
    if (key === "input") return formatTokens(meters.inputTokens)
    if (key === "output") return formatTokens(meters.outputTokens)
    if (key === "reasoning") return formatTokens(meters.reasoningTokens)
    if (key === "think") return formatThink(thinkMs(trace, now))
    if (key === "calls")
      return formatTokens(meters.calls + (trace.pendingSince ? 1 : 0))
    const done = solved(side)
    if (!done) return "—"
    return formatTokens(
      Math.round((meters.inputTokens + meters.outputTokens) / done)
    )
  }
  const trail = (side: Side) =>
    matchOver && winner !== "tie" && winner !== side
  return (
    <section
      className="match-results"
      role="region"
      aria-label="Match results"
      aria-live="polite"
      data-open={open || undefined}
      data-verdict={verdict}
    >
      <button
        type="button"
        className="results-grip"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="results-headline">
          <strong>{headline}</strong>
          <span>{open ? detail : peek}</span>
          {markCount > 0 ? (
            <span className="verdict-marks" aria-hidden="true">
              {Array.from({ length: markCount }, (_, index) => (
                <span
                  key={index}
                  style={{ animationDelay: `${index * 36}ms` }}
                />
              ))}
            </span>
          ) : null}
        </span>
      </button>
      <div className="results-body" hidden={!open}>
        <div
          className="f1-hero"
          aria-label={`F1. ${leftName} ${formatRate(scores.human.f1)}. ${rightName} ${formatRate(scores.learner.f1)}. Open cells against the authored board.`}
        >
          <span className="f1-label">F1</span>
          {SIDES.map((side) => (
            <div key={side} data-side={side} data-trail={trail(side) || undefined}>
              <strong data-empty={scores[side].f1 == null || undefined}>
                {formatRate(scores[side].f1)}
              </strong>
              <span className="f1-name">
                {names[side]}
                {playing[side] ? (
                  <span className="results-live"> · playing</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div className="f1-track" aria-hidden="true">
          {SIDES.map((side) => (
            <span key={side} className="f1-lane" data-side={side}>
              <span
                className="f1-fill"
                data-trail={trail(side) || undefined}
                style={{ transform: `scaleX(${scores[side].f1 ?? 0})` }}
              />
            </span>
          ))}
        </div>
        <p className="f1-note">
          {f1Known
            ? "Open cells against the authored board. A blank cell misses recall. A wrong fill misses both."
            : "F1 needs the authored board from this deal. It shows after the next start."}
        </p>
        <div className="results-rounds">
          {SIDES.map((side) => (
            <div key={side} className="results-round">
              <span>{names[side]}</span>
              {rounds[side]}
            </div>
          ))}
        </div>
        <table className="results-table">
          <caption className="sr-only">
            Boards, taps, time, cell precision and recall, then model cost
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Stat</span>
              </th>
              {SIDES.map((side) => (
                <th key={side} scope="col" data-winner={(matchOver && winner === side) || undefined}>
                  {names[side]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Boards</th>
              {SIDES.map((side) => (
                <td key={side}>
                  {tallies[side].rounds}/{packs.length}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Taps</th>
              {SIDES.map((side) => (
                <td key={side}>{tallies[side].actions}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">{length === "blitz" ? "Left" : "Time"}</th>
              {SIDES.map((side) => (
                <td key={side}>{times[side]}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" title="Correct fills divided by cells that were filled">
                Precision
              </th>
              {SIDES.map((side) => (
                <td key={side}>{formatRate(scores[side].precision)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" title="Correct fills divided by open cells">
                Recall
              </th>
              {SIDES.map((side) => (
                <td key={side}>{formatRate(scores[side].recall)}</td>
              ))}
            </tr>
          </tbody>
          <tbody className="results-model">
            <tr>
              <th scope="colgroup" colSpan={3}>
                Model
              </th>
            </tr>
            {MODEL_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row" title={row.title}>
                  {row.label}
                </th>
                {SIDES.map((side) => (
                  <td key={side}>{modelValue(side, row.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="results-actions">
          <button type="button" className="primary-button" onClick={onRematch}>
            <RefreshCw aria-hidden="true" />
            {sameFamilyLabel ? `Rematch ${sameFamilyLabel}` : "Rematch"}
          </button>
          {length === "deep" ? (
            <button type="button" className="paper-button" onClick={onNextFamily}>
              Next family
            </button>
          ) : null}
          <button type="button" className="paper-button" onClick={onSetup}>
            Back to setup
          </button>
        </div>
      </div>
    </section>
  )
}
