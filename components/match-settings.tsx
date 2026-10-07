"use client"

import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Popover } from "@base-ui/react/popover"
import { Info, Play, RotateCcw, X } from "lucide-react"

import {
  ArenaChoice,
  LengthChoice,
  MethodSelect,
  type Arena,
  type Servers,
} from "@/components/match-options"
import { ModelReel } from "@/components/model-reel"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import type { MatchLength } from "@/lib/battle-ground-ui/match-deck"

type ModelPick = {
  models: readonly { id: string; label: string }[]
  selectedModel: string | undefined
  status: "loading" | "ready" | "unavailable"
  chooseModel: (id: string) => boolean
}

/** Seed, source, and scoring meta. Kept off the play surface. */
export function MatchInfo({
  rows,
}: {
  rows: readonly { label: string; value: string }[]
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-button" aria-label="Match info">
        <Info aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup className="info-pop">
            <Popover.Title className="info-title">Match info</Popover.Title>
            <dl>
              {rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function SettingsBody({
  arena,
  length,
  leftMix,
  rightMix,
  servers,
  model,
  paused,
  onLeftMix,
  onRightMix,
  onRestart,
  onSetup,
  onResume,
}: {
  arena: Arena
  length: MatchLength
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  servers: Servers | null
  model: ModelPick
  paused: boolean
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onRestart: (next: { arena: Arena; length: MatchLength }) => void
  onSetup: () => void
  onResume: () => void
}) {
  const [draftArena, setDraftArena] = useState(arena)
  const [draftLength, setDraftLength] = useState(length)
  return (
    <>
      <header className="settings-head">
        <div>
          <Dialog.Title className="trace-title">Settings</Dialog.Title>
          <Dialog.Description className="trace-description">
            {paused ? "Clocks are paused." : "Nothing is running."} Agent changes
            apply right away.
          </Dialog.Description>
        </div>
        <Dialog.Close className="icon-button" aria-label="Close settings">
          <X aria-hidden="true" />
        </Dialog.Close>
      </header>
      <div className="settings-body">
        <fieldset className="setup-group">
          <legend>Agent model</legend>
          <ModelReel
            models={model.models}
            value={model.selectedModel}
            ready={model.status === "ready"}
            onChange={model.chooseModel}
          />
        </fieldset>
        {arena === "watch" ? (
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
        <section className="settings-restart" aria-label="Restart with changes">
          <h3>Restart with changes</h3>
          <ArenaChoice value={draftArena} onChange={setDraftArena} />
          <LengthChoice value={draftLength} onChange={setDraftLength} />
          <button
            type="button"
            className="paper-button"
            onClick={() => onRestart({ arena: draftArena, length: draftLength })}
          >
            <RotateCcw aria-hidden="true" />
            Restart match
          </button>
        </section>
      </div>
      <footer className="settings-foot">
        <button type="button" className="text-button" onClick={onSetup}>
          Leave to setup
        </button>
        <button type="button" className="primary-button" onClick={onResume}>
          <Play aria-hidden="true" />
          {paused ? "Resume" : "Done"}
        </button>
      </footer>
    </>
  )
}

/** Full config in play. Opening pauses the clocks; closing resumes them. */
export function MatchSettings({
  open,
  onOpenChange,
  ...body
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
} & Omit<Parameters<typeof SettingsBody>[0], "onResume">) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="trace-backdrop" />
        <Dialog.Popup className="settings-sheet">
          <SettingsBody {...body} onResume={() => onOpenChange(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
