"use client"

import { useId } from "react"
import { Check } from "lucide-react"

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
    deep: { label: "Deep", hint: "One family, five boards." },
    tour: { label: "Tour", hint: "One board from each family." },
    blitz: { label: "Blitz", hint: "3 min each. Most boards wins." },
  }

export const mixCopy: Record<
  (typeof learnerModeIds)[number],
  { label: string; detail: string }
> = {
  astra: {
    label: "Astra",
    detail:
      "Same public board as you. Astra names one cell or a short burst of taps.",
  },
  code: {
    label: "Code",
    detail:
      "Astra writes a tiny policy. This browser runs it. No JavaScript is eval'd.",
  },
  "astra-jev": {
    label: "Astra + Jev",
    detail:
      "Astra writes the plan and captions. Jev commits wait/one/batch when a Jev credential is set.",
  },
  "jev-bare": {
    label: "Jev bare",
    detail: "Control only: Jev sees the public board with no Astra plan.",
  },
  "astra-laya": {
    label: "Astra + Laya",
    detail:
      "Astra writes the plan as context. Laya commits it when a Laya credential is set.",
  },
  "laya-bare": {
    label: "Laya bare",
    detail: "Laya sees the public board only. No Astra plan is wrapped around it.",
  },
  "openai-decisions": {
    label: "OpenAI Decisions",
    detail:
      "Astra or Sol writes a short plan and captions. Decisions picks the single next tap.",
  },
}

export const modeName = (mix: LearnerMixId) =>
  mixCopy[mix as (typeof learnerModeIds)[number]]?.label ?? "Astra"

function modeNote(mix: LearnerMixId, servers: Servers | null) {
  if (!servers) return ""
  if (mix === "openai-decisions")
    return servers.openai || servers.gateway
      ? ""
      : "Not configured, so this side waits."
  if (mix === "jev-bare" || mix === "astra-jev")
    return servers.jev ? "" : "Jev is not configured, so this side waits."
  if (mix === "laya-bare" || mix === "astra-laya")
    return servers.laya ? "" : "Laya is not configured, so this side waits."
  if (!servers.openai && !servers.gateway)
    return "No Astra credential is set, so this side waits."
  return ""
}

/** One row of radio chips. Quiet until picked. */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string
  value: T
  options: readonly { id: T; label: string }[]
  onChange: (id: T) => void
}) {
  const name = useId()
  return (
    <fieldset className="setup-group">
      <legend>{legend}</legend>
      <div className="chip-row">
        {options.map((option) => (
          <label key={option.id} className="option-chip">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <Check className="chip-check" aria-hidden="true" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function LengthChoice({
  value,
  onChange,
}: {
  value: MatchLength
  onChange: (length: MatchLength) => void
}) {
  return (
    <div className="setup-group">
      <Choice
        legend="Match"
        value={value}
        options={MATCH_LENGTHS.map((id) => ({
          id,
          label: LENGTH_COPY[id].label,
        }))}
        onChange={onChange}
      />
      <p className="setup-note" aria-live="polite">
        {LENGTH_COPY[value].hint}
      </p>
    </div>
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

/** Every model is visible, one tap each. */
export function ModelChoice({
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
  if (status !== "ready")
    return (
      <div className="setup-group">
        <span className="field-label">Agent model</span>
        <p className="setup-note">
          {status === "loading"
            ? "Loading models…"
            : "Models could not load. Try a reload."}
        </p>
      </div>
    )
  return (
    <Choice
      legend="Agent model"
      value={value ?? models[0]?.id ?? ""}
      options={models}
      onChange={onChange}
    />
  )
}

export function MethodSelect({
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
  const id = useId()
  const copy = mixCopy[value as (typeof learnerModeIds)[number]]
  const note = modeNote(value, servers)
  return (
    <div className="setup-group">
      <label htmlFor={id} className="field-label">
        {legend}
      </label>
      <select
        id={id}
        className="paper-select"
        value={learnerModeIds.includes(value as never) ? value : "astra"}
        onChange={(event) => onChange(event.target.value as LearnerMixId)}
      >
        {learnerModeIds.map((mix) => (
          <option key={mix} value={mix}>
            {mixCopy[mix].label}
          </option>
        ))}
      </select>
      <p className="setup-note" aria-live="polite">
        {copy?.detail}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  )
}
