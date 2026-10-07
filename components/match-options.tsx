"use client"

import {
  useId,
  useState,
  type ComponentType,
  type CSSProperties,
  type SVGProps,
} from "react"
import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown, Earth, Moon, Sun } from "lucide-react"

import {
  learnerModeIds,
  type LearnerMixId,
} from "@/lib/battle-ground-ui/learner-mix"
import { MATCH_LENGTHS, type MatchLength } from "@/lib/battle-ground-ui/match-deck"

export type Servers = {
  openai: boolean
  gateway: boolean
  jev: boolean
  laya: boolean
}
export type Arena = "play" | "watch"

export const LENGTH_COPY: Record<MatchLength, { label: string; hint: string }> =
  {
    deep: {
      label: "Deep",
      hint: "One game, five boards in a row. 10 min per board.",
    },
    tour: {
      label: "Tour",
      hint: "One board from every game. 10 min per board.",
    },
    blitz: {
      label: "Blitz",
      hint: "A 3 min clock for each side. Most boards solved wins.",
    },
  }

export const mixCopy: Record<
  (typeof learnerModeIds)[number],
  { label: string; detail: string }
> = {
  astra: {
    label: "LLM",
    detail:
      "Same public board as you. The LLM names one cell or a short burst of taps.",
  },
  code: {
    label: "Code",
    detail:
      "The model writes one program. This browser keeps running it on later boards, and asks for a change only after that program fails.",
  },
  "astra-jev": {
    label: "LLM + Jev",
    detail:
      "The LLM writes the plan and captions. Jev commits wait/one/batch when a Jev credential is set.",
  },
  "jev-bare": {
    label: "Jev",
    detail: "Control only: Jev sees the public board with no LLM plan.",
  },
  "astra-laya": {
    label: "LLM + Laya",
    detail:
      "The LLM writes the plan as context. Laya commits it when a Laya credential is set.",
  },
  "laya-bare": {
    label: "Laya",
    detail: "Laya sees the public board only. No LLM plan is wrapped around it.",
  },
  "openai-decisions": {
    label: "LLM + Decisions",
    detail:
      "The LLM writes a short plan and captions. Decisions picks the single next tap.",
  },
  "openai-bare": {
    label: "Decisions",
    detail:
      "Control only: OpenAI Decisions sees the public board with no LLM plan.",
  },
}

export const modeName = (mix: LearnerMixId) =>
  mixCopy[mix as (typeof learnerModeIds)[number]]?.label ?? "LLM"

export type AgentStack = "llm" | "dm" | "both"
export type DecisionModel = "jev" | "laya" | "openai"

// Examples are what this app can run: OpenAI GPT models, and the DECISIONS below.
const STACKS: readonly { id: AgentStack; label: string; note?: string }[] = [
  { id: "llm", label: "LLMs", note: "GPT" },
  { id: "dm", label: "DMs", note: "Jev, Laya, Decisions" },
  { id: "both", label: "LLM + DM" },
]

/** Bare decision models do not use the language-model picker. */
export const mixUsesLanguageModel = (mix: LearnerMixId) =>
  mix !== "jev-bare" && mix !== "laya-bare" && mix !== "openai-bare"

export function readAgentStack(mix: LearnerMixId): {
  stack: AgentStack
  code: boolean
  decision: DecisionModel
} {
  switch (mix) {
    case "code":
      return { stack: "llm", code: true, decision: "jev" }
    case "jev-bare":
      return { stack: "dm", code: false, decision: "jev" }
    case "laya-bare":
      return { stack: "dm", code: false, decision: "laya" }
    case "openai-bare":
      return { stack: "dm", code: false, decision: "openai" }
    case "astra-jev":
      return { stack: "both", code: false, decision: "jev" }
    case "astra-laya":
      return { stack: "both", code: false, decision: "laya" }
    case "openai-decisions":
      return { stack: "both", code: false, decision: "openai" }
    default:
      return { stack: "llm", code: false, decision: "jev" }
  }
}

/** Code without a language model is not a mode: nothing would write the policy. */
export function writeAgentStack(
  stack: AgentStack,
  code: boolean,
  decision: DecisionModel
): LearnerMixId {
  if (stack === "dm") {
    if (decision === "laya") return "laya-bare"
    return decision === "openai" ? "openai-bare" : "jev-bare"
  }
  if (stack === "llm") return code ? "code" : "astra"
  if (decision === "laya") return "astra-laya"
  if (decision === "openai") return "openai-decisions"
  return "astra-jev"
}

type ChipIcon = ComponentType<{ className?: string }>

/** Two arms and a core. Lucide has no galaxy glyph; same 24px stroke. */
function Galaxy({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M12 12c2.2-4 6.4-4.2 8.2-1.6" />
      <path d="M12 12c-2.2 4-6.4 4.2-8.2 1.6" />
      <path d="M12 12c3.6 1.2 4.6 4.8 2.4 7" />
      <path d="M12 12c-3.6-1.2-4.6-4.8-2.4-7" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function modelMark(id: string, label: string): ChipIcon | null {
  const name = `${id} ${label}`.toLowerCase()
  if (name.includes("astra")) return Galaxy
  if (name.includes("terra") || name.includes("earth")) return Earth
  if (name.includes("luna") || name.includes("moon")) return Moon
  if (/(^|[^a-z])sol([^a-z]|$)/.test(name) || name.includes("sun")) return Sun
  return null
}

const shortModelLabel = (label: string) => label.replace(/^GPT-[\d.]+\s+/i, "")

function modeNote(mix: LearnerMixId, servers: Servers | null) {
  if (!servers) return ""
  if (mix === "openai-decisions" || mix === "openai-bare")
    return servers.openai || servers.gateway
      ? ""
      : "Not configured, so this side waits."
  if (mix === "jev-bare" || mix === "astra-jev")
    return servers.jev ? "" : "Jev is not configured, so this side waits."
  if (mix === "laya-bare" || mix === "astra-laya")
    return servers.laya ? "" : "Laya is not configured, so this side waits."
  if (!servers.openai && !servers.gateway)
    return "No LLM credential is set, so this side waits."
  return ""
}

/** One row of radio chips. Quiet until picked. */
export function Choice<T extends string>({
  legend,
  legendNote,
  value,
  options,
  onChange,
  busyId = null,
  disabled = false,
}: {
  legend: string
  /** Muted words after the legend. */
  legendNote?: string
  value: T
  options: readonly {
    id: T
    label: string
    /** Muted examples after the label, in parentheses. */
    note?: string
    title?: string
    icon?: ChipIcon | null
    /** Category color tokens. Rendered as a saturated chip mark. */
    swatch?: readonly string[]
  }[]
  onChange: (id: T) => void
  /** The chip whose board is still being built. */
  busyId?: T | null
  /** Shown but not in play; keeps its height so nothing below moves. */
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset className="setup-group" disabled={disabled}>
      <legend>
        {legend}
        {legendNote ? (
          <span className="legend-note"> · {legendNote}</span>
        ) : null}
      </legend>
      <div className="chip-row">
        {options.map((option) => {
          const Icon = option.icon
          const swatch = option.swatch
          const pending = busyId === option.id
          const className = [
            "option-chip",
            Icon ? "has-icon" : "",
            swatch ? "has-mark" : "",
          ]
            .filter(Boolean)
            .join(" ")
          return (
            <label
              key={option.id}
              className={className}
              title={option.title}
              data-pending={pending ? "true" : undefined}
              aria-busy={pending ? true : undefined}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={value === option.id}
                aria-label={option.title}
                onChange={() => onChange(option.id)}
              />
              {Icon ? <Icon className="chip-icon" aria-hidden="true" /> : null}
              {swatch ? (
                <span
                  className="family-swatch"
                  style={
                    {
                      "--swatch-a": swatch[0],
                      "--swatch-b": swatch[1] ?? swatch[0],
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
              ) : null}
              <Check className="chip-check" aria-hidden="true" />
              {option.label}
              {option.note ? (
                <span className="chip-note">({option.note})</span>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const MARKS = [1, 2, 3, 4, 5, 6].map((n) => `var(--cat-${n}-mark)`)

/** Deep is one color, Tour is five, Blitz keeps going past the card edge. */
function lengthMotif(id: MatchLength, deepColor: string) {
  if (id === "deep") return Array.from({ length: 5 }, () => deepColor)
  if (id === "tour") return [MARKS[1], MARKS[4], MARKS[2], MARKS[5], MARKS[3]]
  return Array.from({ length: 16 }, (_, index) => MARKS[index % MARKS.length]!)
}

export function LengthChoice({
  value,
  busyId = null,
  deepColor = "var(--cat-2-mark)",
  onChange,
}: {
  value: MatchLength
  busyId?: MatchLength | null
  /** First mark color of the current Deep family. */
  deepColor?: string
  onChange: (length: MatchLength) => void
}) {
  const name = useId()
  return (
    <fieldset className="setup-group">
      <legend>Match</legend>
      <div className="length-row">
        {MATCH_LENGTHS.map((id) => {
          const pending = busyId === id
          return (
            <label
              key={id}
              className="length-card"
              data-pending={pending ? "true" : undefined}
              aria-busy={pending ? true : undefined}
            >
              <input
                type="radio"
                name={name}
                value={id}
                checked={value === id}
                onChange={() => onChange(id)}
              />
              <span
                className="length-motif"
                data-clip={id === "blitz" ? "true" : undefined}
                aria-hidden="true"
              >
                {lengthMotif(id, deepColor).map((color, index) => (
                  <span
                    key={`${id}-${index}`}
                    className="length-dot"
                    style={{ background: color }}
                  />
                ))}
              </span>
              <span className="length-label">{LENGTH_COPY[id].label}</span>
            </label>
          )
        })}
      </div>
      <p className="setup-note" aria-live="polite">
        {LENGTH_COPY[value].hint}
      </p>
    </fieldset>
  )
}

export function ArenaChoice({
  value,
  onChange,
}: {
  value: Arena
  onChange: (arena: Arena) => void
}) {
  return (
    <Choice
      legend="Who plays"
      value={value}
      options={[
        { id: "play", label: "You vs Agent" },
        { id: "watch", label: "Agent vs Agent" },
      ]}
      onChange={onChange}
    />
  )
}

/** Mid-game model swap. Lives on the agent card header. */
export function AgentModelMenu({
  models,
  value,
  status,
  onChange,
}: {
  models: readonly { id: string; label: string }[]
  value: string | undefined
  status: "loading" | "ready" | "unavailable"
  onChange: (id: string) => void
}) {
  const current = models.find((model) => model.id === value)
  const Mark = current ? modelMark(current.id, current.label) : null
  const label =
    status === "loading"
      ? "Loading"
      : status === "unavailable"
        ? "Unavailable"
        : current
          ? shortModelLabel(current.label)
          : "Model"
  return (
    <Menu.Root>
      <Menu.Trigger
        className="model-swap"
        disabled={status !== "ready" || !current}
        aria-label={`Agent model, ${current?.label ?? label}. Swap without restarting.`}
      >
        {Mark ? <Mark className="model-swap-mark" /> : null}
        <span className="model-swap-label">{label}</span>
        <ChevronDown aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="model-menu-positioner"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="model-menu">
            <Menu.RadioGroup
              value={value}
              onValueChange={(id: string) => onChange(id)}
            >
              {models.map((model) => {
                const Icon = modelMark(model.id, model.label)
                return (
                  <Menu.RadioItem
                    key={model.id}
                    className="model-menu-item"
                    value={model.id}
                    label={model.label}
                    closeOnClick
                  >
                    <span className="model-menu-check">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" />
                      </Menu.RadioItemIndicator>
                    </span>
                    {Icon ? <Icon className="model-menu-icon" /> : null}
                    {model.label}
                  </Menu.RadioItem>
                )
              })}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/**
 * Every model is visible, one tap each. A DM-only side keeps the row,
 * dimmed, so switching to it does not pull the page up.
 */
export function ModelChoice({
  legend = "Agent model",
  models,
  value,
  status,
  active = true,
  onChange,
}: {
  legend?: string
  models: readonly { id: string; label: string }[]
  value: string | undefined
  status: "loading" | "ready" | "unavailable"
  active?: boolean
  onChange: (id: string) => void
}) {
  if (status !== "ready")
    return (
      <div className="setup-group">
        <span className="field-label">{legend}</span>
        <p className="setup-note">
          {status === "loading"
            ? "Loading models…"
            : "Models could not load. Try a reload."}
        </p>
      </div>
    )
  return (
    <div className="setup-group">
      <Choice
        legend={legend}
        legendNote={active ? undefined : "not used by DMs"}
        disabled={!active}
        value={value ?? models[0]?.id ?? ""}
        options={models.map((model) => ({
          id: model.id,
          label: shortModelLabel(model.label),
          title: model.label,
          icon: modelMark(model.id, model.label),
        }))}
        onChange={onChange}
      />
    </div>
  )
}

const DECISIONS: readonly { id: DecisionModel; label: string }[] = [
  { id: "jev", label: "Jev" },
  { id: "laya", label: "Laya" },
  { id: "openai", label: "Decisions" },
]

/**
 * Stack, then the pieces that stack allows.
 * The browser runs a code program, so Writes code is an LLM control.
 * A decision model commits a plan or one tap. Combining the two needs a runner.
 * A bare decision model does not use the language-model picker.
 */
export function AgentStack({
  legend,
  value,
  servers,
  onChange,
}: {
  legend: string
  value: LearnerMixId
  servers: Servers | null
  onChange: (mix: LearnerMixId) => void
}) {
  const parts = readAgentStack(value)
  const [held, setHeld] = useState({
    code: parts.code,
    decision: parts.decision,
  })
  const [tracked, setTracked] = useState(value)
  if (tracked !== value) {
    setTracked(value)
    const next = readAgentStack(value)
    setHeld((current) => {
      const code = next.stack === "llm" ? next.code : current.code
      const decision = next.stack === "llm" ? current.decision : next.decision
      if (code === current.code && decision === current.decision) return current
      return { code, decision }
    })
  }
  const noteId = useId()
  const commit = (
    stack: AgentStack,
    code: boolean,
    decision: DecisionModel
  ) => {
    setHeld({ code, decision })
    onChange(writeAgentStack(stack, code, decision))
  }
  const handleStack = (stack: AgentStack) =>
    commit(stack, held.code, held.decision)
  const handleCode = (code: boolean) =>
    commit(parts.stack, code, held.decision)
  const handleDecision = (decision: DecisionModel) =>
    commit(parts.stack, held.code, decision)
  const copy = mixCopy[value as (typeof learnerModeIds)[number]]
  const warning = modeNote(value, servers)
  const note = [copy?.detail, warning].filter(Boolean).join(" ")
  return (
    <div className="agent-stack">
      <Choice
        legend={legend}
        value={parts.stack}
        options={STACKS}
        onChange={handleStack}
      />
      {parts.stack === "llm" ? (
        <label className="code-switch">
          <span className="field-label">Writes code</span>
          <input
            type="checkbox"
            role="switch"
            checked={parts.code}
            aria-describedby={noteId}
            onChange={(event) => handleCode(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      ) : null}
      {parts.stack === "llm" ? null : (
        <Choice
          legend="Decision model"
          value={parts.decision}
          options={DECISIONS}
          onChange={handleDecision}
        />
      )}
      <p id={noteId} className="setup-note" aria-live="polite">
        {note}
      </p>
    </div>
  )
}
