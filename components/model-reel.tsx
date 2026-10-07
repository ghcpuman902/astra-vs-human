"use client"

import { ChevronDown, ChevronUp } from "lucide-react"

type Model = { id: string; label: string }

/**
 * Slot-style model pick: a one-row window over a vertical reel.
 * Tap the window or the arrows to roll to the next model.
 */
export function ModelReel({
  models,
  value,
  ready,
  onChange,
}: {
  models: readonly Model[]
  value: string | undefined
  ready: boolean
  onChange: (id: string) => void
}) {
  const found = models.findIndex((model) => model.id === value)
  const index = found < 0 ? 0 : found
  const roll = (step: number) => {
    if (!models.length) return
    onChange(models[(index + step + models.length) % models.length].id)
  }
  const disabled = !ready || models.length < 2
  return (
    <div className="reel" role="group" aria-label="Agent model">
      <button
        type="button"
        className="reel-window"
        disabled={disabled}
        aria-label={`Model: ${models[index]?.label ?? "loading"}. Roll to the next.`}
        onClick={() => roll(1)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault()
            roll(event.key === "ArrowUp" ? -1 : 1)
          }
        }}
      >
        <span
          className="reel-strip"
          style={{ transform: `translateY(calc(${-index} * var(--reel-h)))` }}
        >
          {models.length ? (
            models.map((model) => (
              <span
                key={model.id}
                className="reel-item"
                aria-hidden={model.id !== models[index].id}
              >
                <strong>{model.label}</strong>
                <small>{model.id}</small>
              </span>
            ))
          ) : (
            <span className="reel-item">
              <strong>{ready ? "No models" : "Loading models…"}</strong>
            </span>
          )}
        </span>
      </button>
      <span className="reel-steps">
        <button
          type="button"
          className="reel-step"
          disabled={disabled}
          aria-label="Previous model"
          onClick={() => roll(-1)}
        >
          <ChevronUp aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reel-step"
          disabled={disabled}
          aria-label="Next model"
          onClick={() => roll(1)}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}
