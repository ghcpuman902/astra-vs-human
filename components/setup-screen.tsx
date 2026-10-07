"use client"

import { useState } from "react"
import { Check, ChevronRight, Play, RefreshCw } from "lucide-react"

import { MiniBoard } from "@/components/lovable/mini-board"
import {
  ArenaChoice,
  LengthChoice,
  MethodSelect,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { ModelReel } from "@/components/model-reel"
import { matchFamilies, type FamilyMarks } from "@/lib/battle-ground-ui/family-bias"
import { dealTitle } from "@/lib/battle-ground-ui/labels"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import type { DealtMatch, MatchLength } from "@/lib/battle-ground-ui/match-deck"

type ModelPick = {
  models: readonly { id: string; label: string }[]
  selectedModel: string | undefined
  status: "loading" | "ready" | "unavailable"
  chooseModel: (id: string) => boolean
}

/** Host line, one punchline, one call to action. Everything else is a default. */
function Hero() {
  return (
    <header className="hero">
      <p className="hero-host">astra-vs-human.vercel.app</p>
      <h1>Agents are faster, but are they smarter than humans?</h1>
      <p className="hero-cta">Battle them on mini games!</p>
    </header>
  )
}

function UpNext({
  preview,
  onRespawn,
}: {
  preview: DealtMatch | null
  onRespawn: () => void
}) {
  const [turns, setTurns] = useState(0)
  const first = preview?.packs[0]
  return (
    <section className="up-next" aria-label="Boards for this match" aria-live="polite">
      <div className="up-next-board">
        {first ? (
          <div key={first.seed} className="board-swap">
            <MiniBoard pack={first} />
          </div>
        ) : (
          <div className="mini-board-skeleton" />
        )}
      </div>
      <p className="up-next-copy">
        <strong>{preview ? dealTitle(preview) : "Dealing…"}</strong>
        <span>{first ? `${first.n} × ${first.n} · fresh boards` : ""}</span>
      </p>
      <button
        type="button"
        className="paper-button"
        disabled={!preview}
        onClick={() => {
          setTurns((value) => value + 1)
          onRespawn()
        }}
      >
        <RefreshCw
          className="respawn-icon"
          style={{ rotate: `${turns * 180}deg` }}
          aria-hidden="true"
        />
        Shuffle
      </button>
    </section>
  )
}

export function SetupScreen({
  arena,
  leftMix,
  rightMix,
  length,
  marks,
  preview,
  servers,
  model,
  onArena,
  onLeftMix,
  onRightMix,
  onLength,
  onMarks,
  onRespawn,
  onPlay,
}: {
  arena: Arena
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  marks: FamilyMarks
  preview: DealtMatch | null
  servers: Servers | null
  model: ModelPick
  onArena: (arena: Arena) => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onLength: (length: MatchLength) => void
  onMarks: (marks: FamilyMarks) => void
  onRespawn: () => void
  onPlay: () => void
}) {
  const watching = arena === "watch"
  const played = (id: string) => marks.played.includes(id)
  const toggle = (id: string) =>
    onMarks({
      ...marks,
      played: played(id)
        ? marks.played.filter((item) => item !== id)
        : [...marks.played, id],
    })
  return (
    <main className="battle-ground is-setup">
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay()
        }}
      >
        <Hero />
        <fieldset className="setup-group">
          <legend>Agent model</legend>
          <ModelReel
            models={model.models}
            value={model.selectedModel}
            ready={model.status === "ready"}
            onChange={model.chooseModel}
          />
          {model.status === "unavailable" ? (
            <p className="setup-note">Models could not load. Try a reload.</p>
          ) : null}
        </fieldset>
        <LengthChoice value={length} onChange={onLength} />
        <button
          id="start-match"
          type="submit"
          className="primary-button start-button"
          disabled={!preview || model.status !== "ready"}
        >
          <Play aria-hidden="true" />
          Start match
        </button>
        <UpNext preview={preview} onRespawn={onRespawn} />
        <details className="more">
          <summary>
            <ChevronRight aria-hidden="true" />
            More options
          </summary>
          <div className="more-body">
            <ArenaChoice value={arena} onChange={onArena} />
            {watching ? (
              <>
                <MethodSelect
                  legend="Agent A method"
                  value={leftMix}
                  servers={servers}
                  onChange={onLeftMix}
                />
                <MethodSelect
                  legend="Agent B method"
                  value={rightMix}
                  servers={servers}
                  onChange={onRightMix}
                />
              </>
            ) : (
              <MethodSelect
                legend="Agent method"
                value={rightMix}
                servers={servers}
                onChange={onRightMix}
              />
            )}
            <fieldset className="setup-group">
              <legend>Families you have played</legend>
              <p className="setup-note">Tap to mark. New families come first.</p>
              <div className="chip-row">
                {matchFamilies().map((family) => (
                  <label key={family.id} className="option-chip small">
                    <input
                      type="checkbox"
                      checked={played(family.id)}
                      onChange={() => toggle(family.id)}
                    />
                    <Check className="chip-check" aria-hidden="true" />
                    {family.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </details>
      </form>
    </main>
  )
}
