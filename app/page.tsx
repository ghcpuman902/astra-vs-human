import type { Metadata } from "next"

import { BattleApp } from "@/components/battle-app"

export const metadata: Metadata = {
  title: "astra-vs-human · Same board, same taps",
  description:
    "Human and Learner carry local puzzle patterns across fresh boards.",
}

// Boards are dealt in the browser on every Start, so a static page never repeats them.
export default function Page() {
  return <BattleApp />
}
