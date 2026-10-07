import type { Metadata } from "next"

import { BattleApp } from "@/components/battle-app"
import { buildFamilyLibrary } from "@/lib/battle-ground-ui/match-deck"

export const metadata: Metadata = {
  title: "astra-vs-human · Same board, same taps",
  description:
    "Human and Learner carry local puzzle patterns across fresh boards.",
}

export default function Page() {
  const library = buildFamilyLibrary()
  return <BattleApp library={library} />
}
