import type { z } from "zod"

/**
 * OpenAI strict structured output cannot omit a key. Absence is null or an
 * empty collection. A domain schema that uses `.optional()` is a different
 * contract and is not accepted here.
 */
type OmitsKey<T> = undefined extends T ? true : false

type NestedOmission<T> = T extends null | undefined
  ? false
  : T extends readonly (infer Item)[]
    ? NestedOmission<Item>
    : T extends object
      ? true extends {
          [K in keyof T]-?: OmitsKey<T[K]> extends true
            ? true
            : NestedOmission<T[K]>
        }[keyof T]
        ? true
        : false
      : false

export function providerSchema<T extends z.ZodType>(
  schema: NestedOmission<z.infer<T>> extends true ? never : T
): T {
  return schema
}
