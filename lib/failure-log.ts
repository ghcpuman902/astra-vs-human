import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ModelRefusal } from "./model-refusal"

/**
 * Local failure trail for model calls. One JSON line per failure.
 * The client response stays a short reason. Credentials are scrubbed.
 */
const logFile = join(process.cwd(), "_agent", "learner-errors.jsonl")
const maxBytes = 256_000

const secretValues = () => {
  const values: string[] = []
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 12) continue
    if (!/KEY|TOKEN|SECRET|PASSWORD|OIDC/i.test(key)) continue
    values.push(value)
  }
  return values
}

export const scrubSecrets = (text: string) => {
  let out = text
  for (const value of secretValues()) {
    if (out.includes(value)) out = out.split(value).join("[redacted]")
  }
  return out
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
}

const clip = (text: string, max: number) => scrubSecrets(text).slice(0, max)

const field = (error: object, key: string) =>
  key in error ? (error as Record<string, unknown>)[key] : undefined

const statusOf = (error: unknown, depth = 0): number | undefined => {
  if (!error || typeof error !== "object" || depth > 4) return undefined
  const status = field(error, "statusCode") ?? field(error, "status")
  if (typeof status === "number") return status
  const cause = field(error, "cause")
  if (cause && cause !== error) return statusOf(cause, depth + 1)
  return undefined
}

const detailOf = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined
  const body = field(error, "responseBody") ?? field(error, "data")
  if (typeof body === "string" && body.trim()) return clip(body, 1500)
  if (body && typeof body === "object") {
    try {
      return clip(JSON.stringify(body), 1500)
    } catch {
      return undefined
    }
  }
  const cause = field(error, "cause")
  if (cause && cause !== error) return detailOf(cause)
  return undefined
}

export type ModelFailureNote = {
  kind: string
  model: string
  ms: number
  refusal: ModelRefusal
  error: unknown
}

const lineFor = (note: ModelFailureNote) => {
  const error = note.error
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown failure"
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined
  const stack =
    error instanceof Error && error.stack
      ? clip(error.stack.split("\n").slice(0, 8).join("\n"), 1200)
      : undefined
  const detail = detailOf(error)
  return JSON.stringify({
    at: new Date().toISOString(),
    kind: note.kind,
    model: note.model.slice(0, 120),
    ms: note.ms,
    refusal: note.refusal,
    status: statusOf(error),
    name: error instanceof Error ? error.name : undefined,
    message: clip(message, 1000),
    ...(cause ? { cause: clip(cause, 500) } : {}),
    ...(detail ? { detail } : {}),
    ...(stack ? { stack } : {}),
  })
}

const trim = async () => {
  const info = await stat(logFile).catch(() => undefined)
  if (!info || info.size <= maxBytes) return
  const text = await readFile(logFile, "utf8")
  const kept = text.trimEnd().split("\n").slice(-80)
  await writeFile(logFile, `${kept.join("\n")}\n`, "utf8")
}

/**
 * Local file only. Vercel production filesystems are read-only, so a
 * production or hosted run records nothing here.
 */
const localFailureLog =
  process.env.NODE_ENV === "development" && !process.env.VERCEL

/** Append one failure. A log error must not replace the original failure. */
export const recordModelFailure = async (note: ModelFailureNote) => {
  if (!localFailureLog) return
  try {
    await mkdir(join(process.cwd(), "_agent"), { recursive: true })
    await trim()
    await appendFile(logFile, `${lineFor(note)}\n`, "utf8")
  } catch {
    return
  }
}
