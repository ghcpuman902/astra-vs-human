"use client"

import { useState } from "react"
import { ChevronRight, Play, RefreshCw } from "lucide-react"

import { MiniBoard } from "@/components/lovable/mini-board"
import {
  ArenaChoice,
  LENGTH_COPY,
  LengthChoice,
  MethodSelect,
  ModelChoice,
  modeName,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { dealTitle } from "@/lib/battle-ground-ui/labels"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import type { DealtMatch, MatchLength } from "@/lib/battle-ground-ui/match-deck"

type ModelPick = {
  models: readonly { id: string; label: string }[]
  selectedModel: string | undefined
  status: "loading" | "ready" | "unavailable"
  chooseModel: (id: string) => boolean
}

/** What the match is about to be, in one glance, with one way to change it. */
function UpFirst({
  preview,
  length,
  onRespawn,
}: {
  preview: DealtMatch | null
  length: MatchLength
  onRespawn: () => void
}) {
  const [turns, setTurns] = useState(0)
  const first = preview?.packs[0]
  return (
    <section
      className="up-next"
      aria-label="Boards for this match"
      aria-live="polite"
    >
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
        <span>Up first</span>
        <strong>{preview ? dealTitle(preview) : "Dealing…"}</strong>
        <span>{LENGTH_COPY[length].hint}</span>
      </p>
      <button
        type="button"
        className="text-button"
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
        {length === "deep" ? "Different game" : "Reshuffle"}
      </button>
    </section>
  )
}

/**
 * Default path: pick a model, press Start. The app name sits in the page
 * corner so it never reads as an eyebrow over the punchline. Everything else
 * is a default, spelled out in the summary of More options.
 */
export function SetupScreen({
  arena,
  leftMix,
  rightMix,
  length,
  preview,
  servers,
  model,
  onArena,
  onLeftMix,
  onRightMix,
  onLength,
  onRespawn,
  onPlay,
}: {
  arena: Arena
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  preview: DealtMatch | null
  servers: Servers | null
  model: ModelPick
  onArena: (arena: Arena) => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onLength: (length: MatchLength) => void
  onRespawn: () => void
  onPlay: () => void
}) {
  const watching = arena === "watch"
  return (
    <main className="battle-ground is-setup">
      <p className="site-name">astra-vs-human.vercel.app</p>
      <form
        className="setup"
        onSubmit={(event) => {
          event.preventDefault()
          onPlay()
        }}
      >
        <header className="hero">
          <h1>Agents are faster, but are they smarter than humans?</h1>
          <p className="hero-cta">Battle them on mini games!</p>
        </header>
        <ModelChoice
          models={model.models}
          value={model.selectedModel}
          status={model.status}
          onChange={model.chooseModel}
        />
        <UpFirst preview={preview} length={length} onRespawn={onRespawn} />
        <button
          id="start-match"
          type="submit"
          className="primary-button start-button"
          disabled={!preview || model.status !== "ready"}
        >
          <Play aria-hidden="true" />
          Start match
        </button>
        <details className="more">
          <summary>
            <ChevronRight aria-hidden="true" />
            More options
            <span>
              {LENGTH_COPY[length].label} ·{" "}
              {watching ? "Agent vs Agent" : "You vs Agent"} ·{" "}
              {modeName(rightMix)}
            </span>
          </summary>
          <div className="more-body">
            <LengthChoice value={length} onChange={onLength} />
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
          </div>
        </details>
      </form>
    </main>
  )
}
