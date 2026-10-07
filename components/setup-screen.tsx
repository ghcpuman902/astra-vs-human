"use client"

import { useState } from "react"
import { ChevronRight, Play, RefreshCw } from "lucide-react"

import { postcardFor } from "@/components/lovable/marks"
import { MiniBoard } from "@/components/lovable/mini-board"
import { RoundStrip } from "@/components/lovable/round-strip"
import {
  AgentStack,
  ArenaChoice,
  Choice,
  LENGTH_COPY,
  LengthChoice,
  mixUsesLanguageModel,
  ModelChoice,
  modeName,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { matchFamilies } from "@/lib/battle-ground-ui/family-bias"
import { dealTitle } from "@/lib/battle-ground-ui/labels"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import type { DealtMatch, MatchLength } from "@/lib/battle-ground-ui/match-deck"

const NONE = new Set<number>()

type ModelPick = {
  models: readonly { id: string; label: string }[]
  selectedModel: string | undefined
  status: "loading" | "ready" | "unavailable"
  chooseModel: (id: string) => boolean
  /** Agent A's model in Agent vs Agent. */
  rivalModel: string | undefined
  chooseRival: (id: string) => boolean
}

/** What the match is about to be, in one glance, with one way to change it. */
function UpFirst({
  preview,
  length,
  dealing,
  onRespawn,
}: {
  preview: DealtMatch | null
  length: MatchLength
  dealing: boolean
  onRespawn: () => void
}) {
  const [turns, setTurns] = useState(0)
  const first = preview?.packs[0]
  return (
    <section
      className="up-next"
      aria-label="Boards for this match"
      data-pending={dealing ? "true" : undefined}
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
      <p className="up-next-copy" aria-live="polite">
        <span>Up first</span>
        <strong>{preview ? dealTitle(preview) : "Dealing…"}</strong>
        <span>
          {length === "deep" && first && !dealing
            ? postcardFor(first).goal
            : LENGTH_COPY[length].hint}
        </span>
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
        <span className="respawn-icon" style={{ rotate: `${turns * 180}deg` }}>
          <RefreshCw aria-hidden="true" />
        </span>
        {length === "deep" ? "Different game" : "Reshuffle"}
      </button>
      {preview ? (
        <RoundStrip
          label="Boards in this match"
          packs={preview.packs}
          index={0}
          done={NONE}
          windowed={length === "blitz"}
        />
      ) : null}
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
  dealing,
  pendingFamilyId,
  servers,
  model,
  onArena,
  onLeftMix,
  onRightMix,
  onLength,
  onFamily,
  onRespawn,
  onPlay,
}: {
  arena: Arena
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  length: MatchLength
  preview: DealtMatch | null
  dealing: boolean
  pendingFamilyId: string | null
  servers: Servers | null
  model: ModelPick
  onArena: (arena: Arena) => void
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onLength: (length: MatchLength) => void
  onFamily: (familyId: string) => void
  onRespawn: () => void
  onPlay: () => void
}) {
  const watching = arena === "watch"
  const families =
    length === "deep" ? matchFamilies().filter((family) => !family.demote) : []
  const familyValue = pendingFamilyId ?? preview?.familyId ?? ""
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
          <h1>
            Agents are good.
            <br />
            But are they faster AND smarter than humans?
          </h1>
          <p className="hero-cta">Battle them on mini games!</p>
        </header>
        {watching ? (
          <ModelChoice
            legend="Agent A model"
            models={model.models}
            value={model.rivalModel}
            status={model.status}
            active={mixUsesLanguageModel(leftMix)}
            onChange={model.chooseRival}
          />
        ) : null}
        <ModelChoice
          legend={watching ? "Agent B model" : "Agent model"}
          models={model.models}
          value={model.selectedModel}
          status={model.status}
          active={mixUsesLanguageModel(rightMix)}
          onChange={model.chooseModel}
        />
        <UpFirst
          preview={preview}
          length={length}
          dealing={dealing}
          onRespawn={onRespawn}
        />
        <button
          id="start-match"
          type="submit"
          className="primary-button start-button"
          disabled={!preview || dealing || model.status !== "ready"}
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
            <LengthChoice
              value={length}
              busyId={dealing ? length : null}
              onChange={onLength}
            />
            {length === "deep" ? (
              <div className="deep-families">
                <Choice
                  legend="Family"
                  value={familyValue}
                  busyId={dealing ? familyValue : null}
                  options={families.map((family) => ({
                    id: family.id,
                    label: family.label,
                    title: family.label,
                    swatch: family.paint,
                  }))}
                  onChange={onFamily}
                />
              </div>
            ) : null}
            <ArenaChoice value={arena} onChange={onArena} />
            {watching ? (
              <>
                <AgentStack
                  legend="Agent A"
                  value={leftMix}
                  servers={servers}
                  onChange={onLeftMix}
                />
                <AgentStack
                  legend="Agent B"
                  value={rightMix}
                  servers={servers}
                  onChange={onRightMix}
                />
              </>
            ) : (
              <AgentStack
                legend="Agent"
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
