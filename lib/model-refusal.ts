export type ModelRefusal = "deadline" | "unavailable" | "rejected"

const statusCode = (error: unknown, depth = 0): number | undefined => {
  if (!error || typeof error !== "object" || depth > 4) return undefined
  if ("statusCode" in error && typeof error.statusCode === "number")
    return error.statusCode
  if ("status" in error && typeof error.status === "number") return error.status
  if ("cause" in error && error.cause !== error)
    return statusCode(error.cause, depth + 1)
  return undefined
}

/**
 * A 4xx rejects the request we built. Retrying it will fail the same way.
 * 408, 429, 5xx, and errors with no status are reachability and may be asked again.
 * An abort is the round clock, not a provider failure.
 */
export const modelRefusal = (
  error: unknown,
  aborted = false
): ModelRefusal => {
  if (aborted) return "deadline"
  if (error instanceof Error && error.name === "AbortError") return "deadline"
  const status = statusCode(error)
  if (status === undefined) return "unavailable"
  if (status === 408 || status === 429 || status >= 500) return "unavailable"
  if (status >= 400) return "rejected"
  return "unavailable"
}
