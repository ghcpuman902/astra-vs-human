"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { PaperBoard } from "@/components/lovable/paper-board"
import type { BoardProps } from "@/lib/battle-ground-ui/controller"

// Phones stack below this width (see `.phones` in lovable-shell.css).
const STACKED = "(max-width: 799px)"
const PIP_BOARD = 132

const subscribeStacked = (onChange: () => void) => {
  const query = window.matchMedia(STACKED)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
const useStacked = () =>
  useSyncExternalStore(
    subscribeStacked,
    () => window.matchMedia(STACKED).matches,
    () => false
  )

/** True while less than a third of the agent's phone is on screen. */
const useAgentOffscreen = (enabled: boolean) => {
  const [offscreen, setOffscreen] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const phone = document.querySelector('.phone[data-side="learner"]')
    if (!phone) return
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen(entry.intersectionRatio < 0.34),
      { threshold: [0, 0.34, 1] }
    )
    observer.observe(phone)
    return () => observer.disconnect()
  }, [enabled])
  return enabled && offscreen
}

/**
 * Stacked layout only: the agent's board floats over yours so the race stays
 * in view. Drag it anywhere; drag it down (or tap the chevron) to fold it into
 * a bar at the bottom, and tap the bar to bring it back.
 */
export function AgentPip({
  active,
  name,
  clock,
  line,
  board,
}: {
  /** Match running and nothing else is docked at the bottom. */
  active: boolean
  name: string
  clock: string
  line: string
  board: BoardProps
}) {
  const stacked = useStacked()
  const offscreen = useAgentOffscreen(active && stacked)
  const [folded, setFolded] = useState(false)
  const bounds = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const show = active && stacked && offscreen
  const quotas =
    "constraints" in board.clues &&
    board.clues.constraints.some((rule) => rule.kind === "quota")
  const zoom = PIP_BOARD / (board.n * 36 + (quotas ? 24 : 0))
  const enter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 24, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 32, scale: 0.96 },
      }

  return (
    <>
      <div ref={bounds} className="pip-bounds" aria-hidden="true" />
      <AnimatePresence initial={false}>
        {show && !folded ? (
          <motion.aside
            key="pip"
            className="agent-pip"
            aria-label={`${name} board, live`}
            drag
            dragConstraints={bounds}
            dragElastic={0.2}
            dragMomentum={!reduce}
            // It folds downward, so a downward drag or flick folds it.
            onDragEnd={(_, info) => {
              if (info.offset.y > 96 || info.velocity.y > 700) setFolded(true)
            }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            {...enter}
          >
            <header className="pip-bar">
              <span className="pip-name">
                <strong>{name}</strong>
                <span>{line}</span>
              </span>
              <strong className="pip-clock">{clock}</strong>
              <button
                type="button"
                className="pip-fold"
                aria-label={`Fold ${name} board to the bottom`}
                onPointerDownCapture={(event) => event.stopPropagation()}
                onClick={() => setFolded(true)}
              >
                <ChevronDown aria-hidden="true" />
              </button>
            </header>
            <div className="pip-board" inert>
              <div style={{ zoom }}>
                <PaperBoard
                  board={board}
                  interactive={false}
                  invalidIndex={null}
                  label={`${name} board`}
                  onTap={() => {}}
                />
              </div>
            </div>
          </motion.aside>
        ) : null}
        {show && folded ? (
          <motion.button
            key="tab"
            type="button"
            className="pip-tab"
            aria-label={`Show ${name} board`}
            onClick={() => setFolded(false)}
            transition={{ type: "spring", duration: 0.25, bounce: 0 }}
            {...enter}
          >
            <strong>{name}</strong>
            <span>{line}</span>
            <strong className="pip-clock">{clock}</strong>
            <ChevronUp aria-hidden="true" />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </>
  )
}
