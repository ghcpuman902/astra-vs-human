import cached from "./packs-cache.json"
import type { RulePack } from "./types"
import { packErrors } from "./verifier"

/** Five pre-certified packs. Author search is never needed during a live round. */
export function cachedPacks(): RulePack[] {
  // JSON widens tuple and literal types; validate the copy at this boundary.
  const packs = structuredClone(cached) as unknown as RulePack[]
  if (packs.some((pack) => packErrors(pack).length))
    throw new Error("Invalid startup pack cache")
  return packs
}
