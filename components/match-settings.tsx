"use client"

import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { Popover } from "@base-ui/react/popover"
import { Info, X } from "lucide-react"

import {
  AgentStack,
  ArenaChoice,
  LengthChoice,
  type Arena,
  type Servers,
} from "@/components/match-options"
import type { LearnerMixId } from "@/lib/battle-ground-ui/learner-mix"
import type { MatchLength } from "@/lib/battle-ground-ui/match-deck"

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
        <Popover.Positioner
          className="info-pop-positioner"
          side="bottom"
          align="end"
          sideOffset={8}
        >
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
  paused,
  live = false,
  onLeftMix,
  onRightMix,
  onRestart,
}: {
  arena: Arena
  length: MatchLength
  leftMix: LearnerMixId
  rightMix: LearnerMixId
  servers: Servers | null
  paused: boolean
  /** A match is running, so restarting throws its progress away. */
  live?: boolean
  onLeftMix: (mix: LearnerMixId) => void
  onRightMix: (mix: LearnerMixId) => void
  onRestart: (next: { arena: Arena; length: MatchLength }) => void
}) {
  const [draftArena, setDraftArena] = useState(arena)
  const [draftLength, setDraftLength] = useState(length)
  const changed = draftArena !== arena || draftLength !== length
  return (
    <>
      <header className="settings-head">
        <div>
          <Dialog.Title className="trace-title">Settings</Dialog.Title>
          <Dialog.Description className="trace-description">
            {paused ? "Clocks are paused. Closing resumes. " : null}
            Agent changes apply right away.
          </Dialog.Description>
        </div>
        <Dialog.Close className="icon-button" aria-label="Close settings">
          <X aria-hidden="true" />
        </Dialog.Close>
      </header>
      <div className="settings-body">
        {arena === "watch" ? (
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
        <section className="settings-restart" aria-label="Restart with changes">
          <h3>Restart with changes</h3>
          <ArenaChoice value={draftArena} onChange={setDraftArena} />
          <LengthChoice value={draftLength} onChange={setDraftLength} />
        </section>
      </div>
      <footer className="settings-foot">
        {changed && live ? (
          <p className="settings-warn">
            Restarting ends this match. Progress on both sides is lost.
          </p>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={!changed}
          onClick={() => onRestart({ arena: draftArena, length: draftLength })}
        >
          Apply settings and restart
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
} & Parameters<typeof SettingsBody>[0]) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="trace-backdrop" />
        <Dialog.Popup className="settings-sheet">
          <SettingsBody {...body} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
