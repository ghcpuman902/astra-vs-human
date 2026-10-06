import type { Metadata } from "next"

import { BattleApp } from "@/components/battle-app"
import { buildMatchDeck } from "@/lib/battle-ground-ui/match-deck"

export const metadata: Metadata = {
  title: "astra-vs-human · Same board, same taps",
  description:
    "Human and Learner carry local puzzle patterns across fresh boards.",
}

export default function Page() {
  const deck = buildMatchDeck()
  return <BattleApp deck={deck} />
}
