"use client"

import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import {
  AlertTriangle,
  ChevronRight,
  CircleCheck,
  Clock3,
  Code2,
  GitFork,
  ListTree,
  MousePointerClick,
  Play,
  Quote,
  RotateCcw,
  Stamp,
  X,
  type LucideIcon,
} from "lucide-react"

import type {
  AgentMessage,
  AgentPart,
  AgentTraceSnapshot,
} from "@/lib/battle-ground-ui/agent-trace"

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const whole = new Intl.NumberFormat("en")
export const formatTokens = (value: number) =>
  value < 10_000 ? whole.format(value) : compact.format(value)
export const formatThink = (ms: number) => {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 10) return `${seconds.toFixed(1)} s`
  if (seconds < 60) return `${Math.round(seconds)} s`
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

/** Re-renders four times a second while a request is in flight, so time counts live. */
function useNow(active: boolean) {
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

const liveThink = (trace: AgentTraceSnapshot, now: number) =>
  trace.meters.thinkMs +
  (trace.pendingSince ? Math.max(0, now - trace.pendingSince) : 0)

const TOOL: Record<
  Extract<AgentPart, { type: "tool" }>["tool"],
  { label: string; icon: LucideIcon }
> = {
  plan: { label: "Plan", icon: ListTree },
  policy: { label: "Write policy", icon: Code2 },
  decide: { label: "Decide", icon: GitFork },
  commit: { label: "Commit", icon: Stamp },
  "run-policy": { label: "Run policy", icon: Play },
  apply: { label: "Play taps", icon: MousePointerClick },
  check: { label: "Check rules", icon: CircleCheck },
}
const STATUS = {
  wait: { label: "Wait", icon: Clock3 },
  retry: { label: "Retry", icon: RotateCcw },
  error: { label: "Error", icon: AlertTriangle },
} as const

function PartRow({ part }: { part: AgentPart }) {
  if (part.type === "reasoning")
    return (
      <li className="trace-part" data-kind="reasoning">
        <Quote aria-hidden="true" />
        <span className="trace-part-name">Pattern</span>
        <q className="trace-part-text">{part.text}</q>
      </li>
    )
  if (part.type === "status") {
    const { label, icon: Icon } = STATUS[part.tone]
    return (
      <li className="trace-part" data-kind="status" data-tone={part.tone}>
        <Icon aria-hidden="true" />
        <span className="trace-part-name">{label}</span>
        <span className="trace-part-text">{part.text}</span>
      </li>
    )
  }
  const { label, icon: Icon } = TOOL[part.tool]
  const tokens = part.usage
    ? part.usage.inputTokens + part.usage.outputTokens
    : 0
  return (
    <li className="trace-part" data-kind="tool" data-state={part.state}>
      <Icon aria-hidden="true" />
      <span className="trace-part-name">{label}</span>
      <span className="trace-part-text">{part.text}</span>
      {part.model || part.ms != null || tokens ? (
        <span className="trace-part-meta">
          {[
            part.model,
            part.ms != null ? `${whole.format(part.ms)} ms` : null,
            tokens
              ? `${formatTokens(part.usage!.inputTokens)} in · ${formatTokens(part.usage!.outputTokens)} out${part.usage!.reasoningTokens ? ` · ${formatTokens(part.usage!.reasoningTokens)} reasoning` : ""}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
    </li>
  )
}

function MessageItem({
  message,
  origin,
  now,
}: {
  message: AgentMessage
  origin: number
  now: number
}) {
  const offset = Math.max(0, Math.floor((message.at - origin) / 1000))
  const streaming = message.state === "streaming"
  return (
    <li className="trace-message" data-state={message.state}>
      <div className="trace-message-head">
        <span className="trace-time">
          +{Math.floor(offset / 60)}:{String(offset % 60).padStart(2, "0")}
        </span>
        <span className="trace-message-state">
          {streaming
            ? "Waiting on the server"
            : message.state === "error"
              ? "No move"
              : "Decision"}
        </span>
        <span className="trace-message-ms">
          {formatThink(streaming ? now - message.at : (message.ms ?? 0))}
        </span>
      </div>
      {message.parts.length ? (
        <ol className="trace-parts">
          {message.parts.map((part, index) => (
            <PartRow key={index} part={part} />
          ))}
        </ol>
      ) : null}
    </li>
  )
}

/**
 * Compact agent status for the scoreboard. Opens a read-only sheet of every
 * request this match: model calls, tokens, timings, taps, and rule checks.
 */
export function AgentTrace({
  name,
  ability,
  trace,
  live,
  boardLabel,
}: {
  name: string
  ability: string
  trace: AgentTraceSnapshot
  /** Clock is running and this side is on a board. */
  live: boolean
  boardLabel: (board: number) => string
}) {
  const [open, setOpen] = useState(false)
  const pending = trace.pendingSince != null
  const now = useNow(pending)
  const think = liveThink(trace, now)
  const tokens = trace.meters.inputTokens + trace.meters.outputTokens
  const thinking = live && trace.phase === "thinking"
  const label = trace.label
  const origin = trace.messages[0]?.at ?? now
  const boards = [...new Set(trace.messages.map((item) => item.board))].sort(
    (a, b) => b - a
  )
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="agent-status"
        data-phase={trace.phase}
        data-thinking={thinking || undefined}
        aria-label={`${name} work trace. ${label}. ${whole.format(tokens)} tokens, ${formatThink(think)} thinking. Open details.`}
      >
        <span className="agent-status-label">{label}</span>
        <span className="agent-meter" aria-hidden="true">
          <span>{formatTokens(tokens)} tok</span>
          <span>{formatThink(think)}</span>
        </span>
        <ChevronRight className="agent-status-chevron" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="trace-backdrop" />
        <Dialog.Popup className="trace-sheet">
          <header className="trace-head">
            <div>
              <Dialog.Title className="trace-title">
                {name} · {ability}
              </Dialog.Title>
              <Dialog.Description className="trace-description">
                Read-only. Every request this match, newest first. Prompts and
                keys never leave the server.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close trace">
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          <dl className="trace-stats">
            <div>
              <dt>Input tokens</dt>
              <dd>{formatTokens(trace.meters.inputTokens)}</dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd>
                {formatTokens(trace.meters.outputTokens)}
                {trace.meters.reasoningTokens ? (
                  <small>
                    {formatTokens(trace.meters.reasoningTokens)} reasoning
                  </small>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Thinking time</dt>
              <dd>{formatThink(think)}</dd>
            </div>
            <div>
              <dt>Requests</dt>
              <dd>{whole.format(trace.meters.calls + (pending ? 1 : 0))}</dd>
            </div>
          </dl>
          <p className="trace-now" data-phase={trace.phase}>
            <span>Now</span> {label}
            {trace.claim ? <q>{trace.claim}</q> : null}
          </p>
          <div className="trace-scroll">
            {boards.length ? (
              boards.map((board) => {
                const items = trace.messages
                  .filter((item) => item.board === board)
                  .reverse()
                const meter = trace.meters.boards[String(items[0].seed)]
                return (
                  <section key={board} className="trace-board">
                    <h3>
                      <span>{boardLabel(board)}</span>
                      {meter ? (
                        <span className="trace-board-meter">
                          {formatTokens(meter.tokens)} tok ·{" "}
                          {formatThink(meter.thinkMs)} · {meter.calls}{" "}
                          {meter.calls === 1 ? "request" : "requests"}
                        </span>
                      ) : null}
                    </h3>
                    <ol className="trace-messages">
                      {items.map((message) => (
                        <MessageItem
                          key={message.id}
                          message={message}
                          origin={origin}
                          now={now}
                        />
                      ))}
                    </ol>
                  </section>
                )
              })
            ) : (
              <p className="trace-empty">
                Nothing yet. Each request to the model shows up here once the
                match starts.
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
