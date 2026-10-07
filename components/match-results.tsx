"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react"

import { formatThink, formatTokens } from "@/components/agent-trace"
import { scoreBoards, type CellRates } from "@/lib/battle-ground-ui/cell-f1"
import type { AgentTraceSnapshot } from "@/lib/battle-ground-ui/agent-trace"
import type {
  BattleRecord,
  BlitzTally,
  RoundStatus,
  Side,
} from "@/lib/battle-ground-ui/controller"
import { familyMarkPaint } from "@/lib/battle-ground-ui/family-bias"
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
  if (winner === "tie")
    return human.rounds === 0
      ? "Neither side solved a board"
      : "Same boards solved, same taps, same time left"
  const ahead = winner === "human" ? human : learner
  const behind = winner === "human" ? learner : human
  if (ahead.rounds !== behind.rounds) return "Cleared more boards"
  if (ahead.actions !== behind.actions) return "Fewer taps on the solved boards"
  return "More time left"
}

/** Fun scale: OpenAI’s published average ChatGPT query ≈ 1k tokens. */
const AVG_QUERY_TOKENS = 1_000
/** Sam Altman, “The Gentle Singularity”, Jun 2025 — ~0.34 Wh per average query. */
const WH_PER_AVG_QUERY = 0.34
/** Same note — 0.000085 gal ≈ 0.32 mL per average query. */
const ML_PER_AVG_QUERY = 0.32
const ENERGY_WATER_SOURCE =
  "https://blog.samaltman.com/the-gentle-singularity"

const formatEnergy = (wh: number) => {
  if (wh <= 0) return "0 Wh"
  if (wh < 0.01) return `${(wh * 1000).toFixed(1)} mWh`
  if (wh < 10) return `${wh.toFixed(2)} Wh`
  return `${wh.toFixed(1)} Wh`
}

const formatWater = (ml: number) => {
  if (ml <= 0) return "0 mL"
  if (ml < 1) return `${ml.toFixed(2)} mL`
  if (ml < 1000) return `${ml.toFixed(1)} mL`
  return `${(ml / 1000).toFixed(2)} L`
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
    label: "Reasoning tokens",
    title: "Reasoning tokens, when the model reports them",
  },
  {
    key: "think",
    label: "Thinking",
    title: "Wall time waiting on the model, summed across requests",
  },
  {
    key: "calls",
    label: "Model calls",
    title: "Model calls this match, including one still in flight",
  },
  {
    key: "per",
    label: "Tokens per solved board",
    title: "Input plus output tokens, divided by solved boards",
  },
  {
    key: "energy",
    label: "Est. energy*",
    title:
      "Rough estimate from OpenAI’s ~0.34 Wh per average ChatGPT query, scaled by tokens",
  },
  {
    key: "water",
    label: "Est. water†",
    title:
      "Rough estimate from OpenAI’s ~0.32 mL per average ChatGPT query, scaled by tokens",
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
  onKeepPlaying,
  onNextFamily,
  onSetup,
  historyFor,
  onHistory,
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
  /** Out of time: reopen the board for unscored play. */
  onKeepPlaying?: () => void
  onNextFamily: () => void
  onSetup: () => void
  /** Whether a round's history opens for a side, as on the round squares. */
  historyFor?: (index: number, side: Side) => "open" | "locked" | undefined
  onHistory?: (index: number, side: Side) => void
}) {
  const pending =
    traces.human.pendingSince != null || traces.learner.pendingSince != null
  const now = useNow(open && pending)
  // Escape folds the sheet down to its headline so the final boards show.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return
      onToggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onToggle, open])
  const scores = useMemo(() => {
    const packBySeed = new Map(packs.map((pack) => [pack.seed, pack]))
    const score = (side: Side): CellRates => {
      const closed = new Set(
        records
          .filter((record) => record.side === side)
          .map((record) => record.seed)
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
  // Every tap, solved board or not. The verdict only counts solved boards.
  const taps = (side: Side) =>
    records
      .filter((record) => record.side === side)
      .reduce((sum, record) => sum + record.actions, 0) +
    (records.some(
      (record) => record.side === side && record.seed === live[side].seed
    )
      ? 0
      : live[side].actions)
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
      const paint = familyMarkPaint(pack.transfer.family, pack.category)
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
  const tieCloser =
    matchOver &&
    winner === "tie" &&
    tallies.human.rounds === 0 &&
    (scores.human.recall ?? 0) !== (scores.learner.recall ?? 0)
      ? `. ${(scores.human.recall ?? 0) > (scores.learner.recall ?? 0) ? names.human : names.learner} got more cells right`
      : ""
  const detail = matchOver
    ? verdictReason(winner, tallies.human, tallies.learner) + tieCloser
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
    if (key === "energy" || key === "water") {
      const tokens =
        meters.inputTokens + meters.outputTokens + meters.reasoningTokens
      if (!tokens) return "—"
      const scale = tokens / AVG_QUERY_TOKENS
      if (key === "energy") return formatEnergy(scale * WH_PER_AVG_QUERY)
      return formatWater(scale * ML_PER_AVG_QUERY)
    }
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
          </span>
        </button>
        <button type="button" className="primary-button" onClick={onRematch}>
          <RefreshCw aria-hidden="true" />
          {sameFamilyLabel ? `Rematch ${sameFamilyLabel}` : "Rematch"}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={open ? "Hide results" : "Show results"}
          title={open ? "Hide results (Esc)" : "Show results"}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronUp aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="results-body" hidden={!open}>
        <div className="pace-block">
          <div className="results-section" id="match-time">
            Time
          </div>
          <ol className="pace-list" aria-labelledby="match-time">
            <li className="pace-key" aria-hidden="true">
              <span />
              <span>{leftName}</span>
              <span>{rightName}</span>
            </li>
            {pace.map((round) => (
              <li
                key={round.seed}
                className="pace-round"
                aria-label={`Round ${round.index + 1}, ${round.name}. ${round.verdict}. ${leftName} ${paceLine(round.human)}. ${rightName} ${paceLine(round.learner)}.`}
              >
                <span className="pace-mark">
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
                  <span className="pace-name">{round.name}</span>
                </span>
                {SIDES.map((side) => {
                  const marks = {
                    className: "pace-time",
                    "data-side": side,
                    "data-better": round.faster === side || undefined,
                    "data-even": round.faster === "tie" || undefined,
                    "data-open": round.faster === "open" || undefined,
                  }
                  return onHistory && historyFor?.(round.index, side) ? (
                    <button
                      key={side}
                      type="button"
                      {...marks}
                      data-history
                      aria-label={`${names[side]}, round ${round.index + 1}: ${paceClock(round[side])}. Show how it was played.`}
                      onClick={() => onHistory(round.index, side)}
                    >
                      {paceClock(round[side])}
                    </button>
                  ) : (
                    <span key={side} {...marks}>
                      {paceClock(round[side])}
                    </span>
                  )
                })}
              </li>
            ))}
            <li
              className="pace-total"
              aria-label={
                length === "blitz"
                  ? `Time left. ${leftName} ${times.human}. ${rightName} ${times.learner}.`
                  : `Total time. ${leftName} ${times.human}. ${rightName} ${times.learner}.`
              }
            >
              <span className="pace-total-label">
                {length === "blitz" ? "Left" : null}
              </span>
              {SIDES.map((side) => (
                <span key={side} className="pace-time" data-side={side}>
                  {times[side]}
                </span>
              ))}
            </li>
          </ol>
        </div>
        <div
          className="results-table"
          role="table"
          aria-label="Boards, taps, cells right, then model cost"
        >
          <div className="pace-key" role="row">
            <span role="columnheader">
              <span className="sr-only">Stat</span>
            </span>
            {SIDES.map((side) => (
              <span key={side} role="columnheader">
                {names[side]}
              </span>
            ))}
          </div>
          <div className="score-row" role="row">
            <span role="rowheader">Boards</span>
            {SIDES.map((side) => (
              <span key={side} role="cell">
                {tallies[side].rounds}/{packs.length}
              </span>
            ))}
          </div>
          <div className="score-row" role="row">
            <span
              role="rowheader"
              title="Every tap, solved or not. Ties are broken by taps on solved boards only."
            >
              Taps
            </span>
            {SIDES.map((side) => (
              <span key={side} role="cell">
                {taps(side)}
              </span>
            ))}
          </div>
          <div className="score-row" role="row">
            <span
              role="rowheader"
              title="Of the cells filled in, the share that were right (precision)"
            >
              Filled cells right
            </span>
            {SIDES.map((side) => (
              <span key={side} role="cell">
                {formatRate(scores[side].precision)}
              </span>
            ))}
          </div>
          <div className="score-row" role="row">
            <span
              role="rowheader"
              title="Of all open cells, the share filled in right (recall)"
            >
              Board done right
            </span>
            {SIDES.map((side) => (
              <span key={side} role="cell">
                {formatRate(scores[side].recall)}
              </span>
            ))}
          </div>
          <div className="results-section" role="row">
            <span role="columnheader">Model</span>
          </div>
          {MODEL_ROWS.map((row) => (
            <div key={row.key} className="score-row" role="row">
              <span role="rowheader" title={row.title}>
                {row.label}
              </span>
              {SIDES.map((side) => (
                <span key={side} role="cell">
                  {modelValue(side, row.key)}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="results-notes">
          <span>
            * Rough energy estimate: OpenAI’s ~{WH_PER_AVG_QUERY} Wh per average
            ChatGPT query, scaled by this match’s tokens vs an assumed{" "}
            {AVG_QUERY_TOKENS.toLocaleString("en")} tokens/query. Not measured.{" "}
            <a
              href={ENERGY_WATER_SOURCE}
              target="_blank"
              rel="noopener noreferrer"
            >
              Altman, Jun 2025
            </a>
            .
          </span>
          <span>
            † Rough water estimate: same note’s ~{ML_PER_AVG_QUERY} mL (0.000085
            gal) per average query, scaled the same way. Fun ballpark only —
            varies by model, hardware, and datacenter.
          </span>
        </p>
      </div>
      <div className="results-actions" hidden={!open}>
        {onKeepPlaying ? (
          <button
            type="button"
            className="paper-button"
            onClick={onKeepPlaying}
            title="Your board reopens. The result above stays as it is."
          >
            Keep solving my board
          </button>
        ) : null}
        {length === "deep" ? (
          <button type="button" className="paper-button" onClick={onNextFamily}>
            Next family
          </button>
        ) : null}
        <button type="button" className="paper-button" onClick={onSetup}>
          Back to setup
        </button>
      </div>
    </section>
  )
}
