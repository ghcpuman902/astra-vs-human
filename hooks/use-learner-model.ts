"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { z } from "zod"

import type { LearnerModelConfig } from "@/lib/learner-models"

const configSchema = z
  .strictObject({
    models: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(120),
          label: z.string().min(1).max(160),
        })
      )
      .min(1)
      .max(16),
    defaultModel: z.string().min(1).max(120),
  })
  .refine((config) =>
    config.models.some((model) => model.id === config.defaultModel)
  )

/** Select before start; retain that model throughout one scored round. */
export function useLearnerModel() {
  const [config, setConfig] = useState<LearnerModelConfig | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | undefined>()
  const [round, setRound] = useState<{
    id: string | number
    model: string
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const available = useRef<LearnerModelConfig | null>(null)
  const selected = useRef<string | undefined>(undefined)
  const frozen = useRef<{ id: string | number; model: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/learner-models", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Models unavailable")
        const next = configSchema.parse(await response.json())
        if (controller.signal.aborted) return
        available.current = next
        selected.current = next.defaultModel
        setConfig(next)
        setSelectedModel(next.defaultModel)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])
  const selectModel = useCallback((id: string): boolean => {
    if (
      frozen.current ||
      !available.current?.models.some((model) => model.id === id)
    )
      return false
    selected.current = id
    setSelectedModel(id)
    return true
  }, [])
  const startRound = useCallback((id: string | number): string | undefined => {
    if (frozen.current)
      return frozen.current.id === id ? frozen.current.model : undefined
    if (!selected.current || !available.current) return undefined
    const next = { id, model: selected.current }
    frozen.current = next
    setRound(next)
    return next.model
  }, [])
  const endRound = useCallback((id: string | number): boolean => {
    if (frozen.current?.id !== id) return false
    frozen.current = null
    setRound(null)
    return true
  }, [])
  const getModel = useCallback(
    () => frozen.current?.model ?? selected.current,
    []
  )
  return {
    models: config?.models ?? [],
    defaultModel: config?.defaultModel,
    selectedModel,
    roundModel: round?.model,
    isFrozen: round !== null,
    status: failed
      ? ("unavailable" as const)
      : config
        ? ("ready" as const)
        : ("loading" as const),
    selectModel,
    startRound,
    endRound,
    getModel,
  }
}
