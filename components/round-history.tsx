"use client"

import { useEffect, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import {
  ChevronFirst,
  ChevronLast,
  Lock,
  Pause,
  Play,
  StepBack,
  StepForward,
  X,
} from "lucide-react"

import { PaperBoard } from "@/components/lovable/paper-board"
import type {
  BoardProps,
  RoundStatus,
  Side,
} from "@/lib/battle-ground-ui/controller"
import {
  cellsAt,
  diffCells,
  type TapeStep,
} from "@/lib/battle-ground-ui/round-tape"

/** One side's view of the round. */
export type HistorySide = {
  name: string
  /** Why this side's history stays closed for now. Null when it can be shown. */
  locked: string | null
  steps: readonly TapeStep[]
  /** The board where this side's round ended (or stands now, in overtime). */
  end: readonly (number | null)[] | null
  status: RoundStatus
  /** One line: how the round ended for this side. */
  outcome: string
}

/** A step the tape did not keep: jumps straight to where the board ended. */
type Frame = TapeStep | { kind: "rest"; changes: TapeStep["changes"] }

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function stepText(frame: Frame | undefined, n: number) {
  if (!frame) return "Start"
  if (frame.kind === "rest") return "Where the board ended"
  if (frame.kind === "undo") return "Undo"
  if (frame.kind === "clear") return "Clear"
  if (frame.cell === null) return "Tap"
  return `Tap row ${Math.floor(frame.cell / n) + 1}, column ${(frame.cell % n) + 1}`
}

/** Playback walks a short round slowly and a long one briskly, about 8 s end to end. */
const playMs = (frames: number) =>
  Math.min(600, Math.max(120, Math.round(8000 / Math.max(1, frames))))

function Replay({
  start,
  side,
  n,
  boardFor,
}: {
  start: readonly (number | null)[]
  side: HistorySide
  n: number
  boardFor: (
    cells: readonly (number | null)[],
    selected: number | null,
    status: RoundStatus
  ) => BoardProps | null
}) {
  const kept = cellsAt(start, side.steps, side.steps.length)
  const rest = side.end ? diffCells(kept, side.end) : []
  const frames: Frame[] = rest.length
    ? [...side.steps, { kind: "rest", changes: rest }]
    : [...side.steps]
  // Opens where the round ended; Play from there starts again at the top.
  const [at, setAt] = useState(frames.length)
  const [playing, setPlaying] = useState(false)
  const position = Math.min(at, frames.length)
  const last = position === frames.length

  // Playback stops by itself on the last step.
  const running = playing && !last

  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () => setAt((value) => Math.min(value + 1, frames.length)),
      playMs(frames.length)
    )
    return () => clearInterval(timer)
  }, [frames.length, running])

  const frame = position > 0 ? frames[position - 1] : undefined
  const cells = [...start]
  for (const item of frames.slice(0, position))
    for (const [cell, value] of item.changes) cells[cell] = value
  const selected = frame && frame.kind === "tap" ? frame.cell : null
  const board = boardFor(cells, selected, last ? side.status : "playing")
  const go = (next: number) => {
    setPlaying(false)
    setAt(Math.max(0, Math.min(frames.length, next)))
  }
  const toggle = () => {
    if (running) return setPlaying(false)
    if (last) setAt(0)
    setPlaying(true)
  }
  const overtime = frame && frame.kind !== "rest" && frame.overtime
  const meta =
    frame && frame.kind !== "rest"
      ? `${clock(frame.at)} · ${frame.taps} ${frame.taps === 1 ? "tap" : "taps"}`
      : null

  return (
    <div className="history-replay">
      <div className="arena-stage history-stage">
        {board ? (
          <PaperBoard
            board={board}
            interactive={false}
            invalidIndex={null}
            label={`${side.name} board, step ${position} of ${frames.length}`}
            onTap={() => {}}
          />
        ) : null}
      </div>
      <p className="history-step" aria-live={running ? "off" : "polite"}>
        <strong>
          {position === 0 ? "Start" : `Step ${position} of ${frames.length}`}
        </strong>
        <span>{stepText(frame, n)}</span>
        {meta ? <span className="history-meta">{meta}</span> : null}
        {overtime ? <span className="history-tag">Overtime</span> : null}
      </p>
      {frames.length === 0 ? (
        <p className="history-empty">
          {side.name} made no moves on this board.
        </p>
      ) : (
        <div className="history-controls">
          <input
            type="range"
            className="history-scrub"
            min={0}
            max={frames.length}
            step={1}
            value={position}
            aria-label="Step"
            aria-valuetext={
              position === 0
                ? "Start"
                : `Step ${position} of ${frames.length}, ${stepText(frame, n)}`
            }
            onChange={(event) => go(Number(event.target.value))}
          />
          <div className="history-buttons">
            <button
              type="button"
              className="icon-button"
              aria-label="First step"
              disabled={position === 0}
              onClick={() => go(0)}
            >
              <ChevronFirst aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Previous step"
              disabled={position === 0}
              onClick={() => go(position - 1)}
            >
              <StepBack aria-hidden="true" />
            </button>
            <button
              type="button"
              className="paper-button icon-text history-play"
              onClick={toggle}
            >
              {running ? (
                <Pause aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {running ? "Pause" : last ? "Replay" : "Play"}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next step"
              disabled={last}
              onClick={() => go(position + 1)}
            >
              <StepForward aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Last step"
              disabled={last}
              onClick={() => go(frames.length)}
            >
              <ChevronLast aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {rest.length ? (
        <p className="history-note">
          {side.steps.length
            ? "Later moves on this board were not kept. The last step jumps to where it ended."
            : "Moves on this board were not kept. The step shows where it ended."}
        </p>
      ) : null}
    </div>
  )
}

/**
 * How one round was played, for either side. Opens from a round square.
 * Read-only: the board steps from its starting cells to where it ended.
 */
export function RoundHistory({
  open,
  onOpenChange,
  title,
  paused,
  seed,
  n,
  start,
  sides,
  side,
  onSide,
  boardFor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The match clocks are held while this is open. */
  paused: boolean
  seed: number
  n: number
  start: readonly (number | null)[]
  sides: Record<Side, HistorySide>
  side: Side
  onSide: (side: Side) => void
  boardFor: (
    cells: readonly (number | null)[],
    selected: number | null,
    status: RoundStatus
  ) => BoardProps | null
}) {
  const shown = sides[side]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="trace-backdrop" />
        <Dialog.Popup className="trace-sheet history-sheet">
          <header className="trace-head">
            <div>
              <Dialog.Title className="trace-title">{title}</Dialog.Title>
              <Dialog.Description className="trace-description">
                How each side got to its final board.
                {paused ? " Clocks are paused." : ""}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close history">
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="history-sides" role="group" aria-label="Whose round">
            {(["human", "learner"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className="history-side"
                aria-pressed={key === side}
                onClick={() => onSide(key)}
              >
                <strong>
                  {sides[key].locked ? <Lock aria-hidden="true" /> : null}
                  {sides[key].name}
                </strong>
                <span>{sides[key].outcome}</span>
              </button>
            ))}
          </div>
          <div className="history-body">
            {shown.locked ? (
              <p className="history-locked">
                <Lock aria-hidden="true" />
                {shown.locked}
              </p>
            ) : (
              <Replay
                key={`${seed}:${side}`}
                start={start}
                side={shown}
                n={n}
                boardFor={boardFor}
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
