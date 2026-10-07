"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { RefreshCw } from "lucide-react"

import { formatThink, formatTokens } from "@/components/agent-trace"
import {
  scoreBoards,
  type CellRates,
} from "@/lib/battle-ground-ui/cell-f1"
import type { AgentTraceSnapshot } from "@/lib/battle-ground-ui/agent-trace"
import type {
  BattleRecord,
  BlitzTally,
  RoundStatus,
  Side,
} from "@/lib/battle-ground-ui/controller"
import { familyPaint } from "@/lib/battle-ground-ui/family-bias"
import { familyLabel, formatClock } from "@/lib/battle-ground-ui/labels"
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

type RoundPace = {
  status: RoundStatus
  actions: number
  elapsedMs: number
}

const paceClock = (pace: RoundPace | null) =>
  pace ? formatClock(pace.elapsedMs) : "—"

const paceLine = (pace: RoundPace | null) =>
  pace ? `${formatClock(pace.elapsedMs)}, ${pace.actions} taps` : "no time"

const roundFaster = (
  human: RoundPace | null,
  learner: RoundPace | null
): "human" | "learner" | "tie" | "open" => {
  if (!human || !learner) return "open"
  if (human.status === "playing" || learner.status === "playing") return "open"
  const humanCleared = human.status === "finished"
  const learnerCleared = learner.status === "finished"
  if (humanCleared !== learnerCleared) return humanCleared ? "human" : "learner"
  if (!humanCleared) return "tie"
  if (human.elapsedMs !== learner.elapsedMs)
    return human.elapsedMs < learner.elapsedMs ? "human" : "learner"
  if (human.actions !== learner.actions)
    return human.actions < learner.actions ? "human" : "learner"
  return "tie"
}

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
  tallies,
  times,
  traces,
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
  live: Record<
    Side,
    {
      seed: number
      cells: readonly (number | null)[]
      actions: number
      elapsedMs: number
      status: RoundStatus
    }
  >
  tallies: Record<Side, BlitzTally>
  times: Record<Side, string>
  traces: Record<Side, AgentTraceSnapshot>
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
  const pace = useMemo(() => {
    const forSide = (side: Side, seed: number): RoundPace | null => {
      const closed = records.find(
        (record) => record.side === side && record.seed === seed
      )
      if (closed)
        return {
          status: closed.status,
          actions: closed.actions,
          elapsedMs: closed.elapsedMs,
        }
      const current = live[side]
      if (current.seed !== seed) return null
      return {
        status: current.status,
        actions: current.actions,
        elapsedMs: current.elapsedMs,
      }
    }
    return packs.flatMap((pack, index) => {
      const human = forSide("human", pack.seed)
      const learner = forSide("learner", pack.seed)
      if (!human && !learner) return []
      const faster = roundFaster(human, learner)
      const name = familyLabel(pack)
      const paint = familyPaint(pack.transfer.family, pack.category)
      const racing =
        human?.status === "playing" || learner?.status === "playing"
      const verdict =
        faster === "human"
          ? `${leftName} faster`
          : faster === "learner"
            ? `${rightName} faster`
            : faster === "tie" &&
                human?.status !== "finished" &&
                learner?.status !== "finished"
              ? "Neither cleared"
              : faster === "tie"
                ? "Same pace"
                : racing
                  ? "Still going"
                  : "Waiting"
      return [
        {
          seed: pack.seed,
          index,
          name,
          paint,
          human,
          learner,
          faster,
          verdict,
        },
      ]
    })
  }, [leftName, live, packs, records, rightName])
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
  return (
    <section
      className="match-results"
      role="region"
      aria-label="Match results"
      aria-live="polite"
      data-open={open || undefined}
      data-verdict={verdict}
    >
      <div className="results-head">
        <button
          type="button"
          className="results-grip"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="results-headline">
            <strong>{headline}</strong>
            <span>{open || matchOver ? detail : progress}</span>
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
        <button type="button" className="primary-button" onClick={onRematch}>
          <RefreshCw aria-hidden="true" />
          {sameFamilyLabel ? `Rematch ${sameFamilyLabel}` : "Rematch"}
        </button>
      </div>
      <div className="results-body" hidden={!open}>
        <ol className="pace-list" aria-label="Round speed">
          <li className="pace-key" aria-hidden="true">
            <span>{leftName}</span>
            <span>{rightName}</span>
          </li>
          {pace.map((round) => (
            <li
              key={round.seed}
              className="pace-round"
              aria-label={`Round ${round.index + 1}, ${round.name}. ${round.verdict}. ${leftName} ${paceLine(round.human)}. ${rightName} ${paceLine(round.learner)}.`}
            >
              <span
                className="small-round"
                data-split={round.paint[1] ? true : undefined}
                title={round.name}
                style={
                  {
                    "--round-a": round.paint[0],
                    "--round-b": round.paint[1] ?? round.paint[0],
                  } as CSSProperties
                }
              />
              <span className="pace-index">{round.index + 1}</span>
              {SIDES.map((side) => (
                <span
                  key={side}
                  className="pace-time"
                  data-side={side}
                  data-better={round.faster === side || undefined}
                  data-even={round.faster === "tie" || undefined}
                  data-open={round.faster === "open" || undefined}
                >
                  {paceClock(round[side])}
                </span>
              ))}
            </li>
          ))}
        </ol>
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
