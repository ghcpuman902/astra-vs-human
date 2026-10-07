import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Eye, Pause } from "lucide-react"

import { postcardFor } from "@/components/lovable/marks"
import { PaperBoard } from "@/components/lovable/paper-board"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"
import type { GamePack } from "@/lib/mini-game-rules/schema"

const coverStyle = (board: BoardProps): CSSProperties => {
  const quotas =
    "constraints" in board.clues &&
    board.clues.constraints.some((rule) => rule.kind === "quota")
  return {
    "--n": board.n,
    "--cover-extra": quotas ? "24px" : "0px",
  } as CSSProperties
}

const STATUS: Record<string, string> = {
  playing: "playing",
  finished: "solved",
  "time-cap": "out of time",
}
export const statusWord = (status: string) => STATUS[status] ?? status

function Cover({
  board,
  text,
  label,
  locked = false,
}: {
  board: BoardProps
  text: string
  label: string
  /** No peeking while a restored match is paused: the clock is not running. */
  locked?: boolean
}) {
  const [peek, setPeek] = useState(false)
  const coverRef = useRef<HTMLButtonElement>(null)
  const dismissRef = useRef<HTMLButtonElement>(null)
  const wasPeeking = useRef(false)

  useEffect(() => {
    if (peek) dismissRef.current?.focus()
    else if (wasPeeking.current) coverRef.current?.focus()
    wasPeeking.current = peek
  }, [peek])

  if (peek) {
    return (
      <div className="puzzle-cover" style={coverStyle(board)} data-peek="true">
        <PaperBoard
          key={`peek-${board.seed}`}
          board={board}
          interactive={false}
          invalidIndex={null}
          label={label}
          onTap={() => {}}
        />
        <button
          ref={dismissRef}
          type="button"
          className="peek-dismiss"
          aria-pressed="true"
          aria-label="Hide preview"
          onClick={() => setPeek(false)}
        />
      </div>
    )
  }

  return (
    <button
      ref={coverRef}
      type="button"
      className="puzzle-cover"
      style={coverStyle(board)}
      aria-pressed={locked ? undefined : false}
      disabled={locked}
      onClick={() => setPeek(true)}
    >
      <span className="cover-copy">
        {locked ? <Pause aria-hidden="true" /> : <Eye aria-hidden="true" />}
        {text}
      </span>
    </button>
  )
}

/** A mini phone screen. Header, board, then whatever the side needs underneath. */
export function Phone({
  side,
  name,
  titleExtra,
  sub,
  clock,
  rounds,
  done = false,
  behind = false,
  children,
  footer,
}: {
  side: "human" | "learner"
  name: string
  titleExtra?: ReactNode
  sub: ReactNode
  clock: string
  rounds?: ReactNode
  done?: boolean
  behind?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section
      className="phone"
      data-side={side}
      data-done={done || undefined}
      data-behind={behind || undefined}
      aria-label={`${name} game`}
    >
      <header className="phone-bar">
        <div className="phone-name">
          <div className="phone-title">
            <strong>{name}</strong>
            {titleExtra}
          </div>
          <div className="phone-sub">{sub}</div>
        </div>
        <div className="phone-clock">
          <strong>{clock}</strong>
        </div>
      </header>
      {rounds}
      <div className="arena-stage">{children}</div>
      {footer ? <footer className="phone-foot">{footer}</footer> : null}
    </section>
  )
}

export function BoardStage({
  board,
  started,
  interactive,
  invalidIndex,
  name,
  coverText,
  locked,
  onTap,
  onPathStep,
}: {
  board: BoardProps
  started: boolean
  interactive: boolean
  invalidIndex: number | null
  name: string
  coverText: string
  locked: boolean
  onTap: (cell: number) => void
  onPathStep?: (cell: number, cycles: number) => void
}) {
  return started ? (
    <PaperBoard
      key={board.seed}
      board={board}
      interactive={interactive}
      invalidIndex={invalidIndex}
      label={`${name} ${board.n} by ${board.n} board`}
      onTap={onTap}
      onPathStep={interactive ? onPathStep : undefined}
    />
  ) : (
    <Cover
      board={board}
      label={`Peek at ${name} board`}
      locked={locked}
      text={locked ? "Paused. Resume to continue." : coverText}
    />
  )
}

/** Rules for this board, under the phone. */
export function Rules({ pack }: { pack: GamePack }) {
  const card = postcardFor(pack)
  return (
    <div className="postcard-rules">
      <p className="postcard-goal">{card.goal}</p>
      <ul>
        {card.rules.map((rule, index) => (
          <li key={index}>{rule}</li>
        ))}
      </ul>
    </div>
  )
}
