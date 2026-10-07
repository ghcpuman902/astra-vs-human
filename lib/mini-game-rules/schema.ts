import { z } from "zod"

export const categorySchema = z.enum([
  "binary_fill",
  "crown",
  "path_cover",
  "tile_rotate_connect",
  "lights_toggle",
])
export const modeSchema = z.enum(["FORCED-CHAIN", "BRANCHY", "MULTI", "RISK"])
export type Mode = z.infer<typeof modeSchema>
const index = z.number().int().nonnegative()
const cellSchema = z.object({
  value: z.number().int().nullable(),
  locked: z.boolean(),
})
const constraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("no-three"),
    cells: z.tuple([index, index, index]),
  }),
  z.object({
    kind: z.literal("quota"),
    cells: z.array(index).min(1),
    ones: index,
  }),
  z.object({
    kind: z.literal("friend"),
    cells: z.tuple([index, index]),
    relation: z.enum(["=", "×"]),
  }),
  z.object({ kind: z.literal("balance"), cells: z.array(index).min(2) }),
  z.object({
    kind: z.literal("no-square"),
    cells: z.tuple([index, index, index, index]),
  }),
])
/** Tango: no-three + balance. Garden: no 2×2 + balance. Tally: no-three + a few line counts. */
export const binaryRuleSchema = z.enum(["tango", "garden", "tally"])
export type BinaryRule = z.infer<typeof binaryRuleSchema>
const common = {
  version: z.literal(1),
  seed: z.number().int().safe(),
  n: z.union([z.literal(4), z.literal(5), z.literal(6)]),
  mode: modeSchema,
  visibility: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("full") }),
    z.object({ kind: z.literal("partial"), visibleCells: z.array(index) }),
  ]),
  postcard: z.object({
    goal: z.string().min(1).max(160),
    rules: z.array(z.string().min(1).max(180)).min(1).max(4),
  }),
  cells: z.array(cellSchema).min(16).max(36),
  actionSurface: z.object({
    actions: z.tuple([
      z.literal("selectCell"),
      z.literal("cycle"),
      z.literal("undo"),
      z.literal("clear"),
    ]),
    cycleValues: z.array(z.number().int().nullable()).min(2),
    effect: z.enum(["set-cell", "rotate-ports", "toggle-cross"]),
  }),
  transfer: z.object({
    family: z.string().min(1),
    variant: z.string(),
    friendPatterns: z.array(z.string()).min(1),
    minimumRounds: z.literal(3),
  }),
  session: z.object({
    targetSeconds: z.number().min(10).max(120),
    stretchSeconds: z.literal(600),
    hints: z.literal("practice-only"),
  }),
}
export const packSchema = z
  .discriminatedUnion("category", [
    z.object({
      ...common,
      category: z.literal("binary_fill"),
      rules: z.object({ constraints: z.array(constraintSchema) }),
      winPredicate: z.literal("satisfy-binary-constraints"),
    }),
    z.object({
      ...common,
      category: z.literal("crown"),
      rules: z.object({
        blocked: z.array(index),
        noDiagonalTouch: z.boolean(),
        /** Queens: region id per cell, one crown per region. */
        regions: z.array(index).optional(),
      }),
      winPredicate: z.literal("one-crown-per-row-column"),
    }),
    z.object({
      ...common,
      category: z.literal("path_cover"),
      rules: z.object({
        active: z.array(index).min(2),
        start: index,
        end: index,
        checkpoints: z.array(z.object({ cell: index, order: index })),
        /** Edge-neighbour pairs the path may not step between. */
        walls: z.array(z.tuple([index, index])).optional(),
      }),
      winPredicate: z.literal("orthogonal-numbered-path-cover"),
    }),
    z.object({
      ...common,
      category: z.literal("tile_rotate_connect"),
      rules: z.object({ ports: z.array(z.number().int().min(0).max(15)) }),
      winPredicate: z.literal("all-ports-match-connected"),
    }),
    z.object({
      ...common,
      category: z.literal("lights_toggle"),
      rules: z.object({ neighborhood: z.literal("orthogonal-cross") }),
      winPredicate: z.literal("all-lights-off"),
    }),
  ])
  .superRefine((pack, ctx) => {
    const count = pack.n ** 2
    if (pack.cells.length !== count)
      ctx.addIssue({
        code: "custom",
        message: "Cell count must equal n squared",
      })
    const ids =
      pack.category === "binary_fill"
        ? pack.rules.constraints.flatMap((rule) => rule.cells)
        : pack.category === "crown"
          ? pack.rules.blocked
          : pack.category === "path_cover"
            ? [
                ...pack.rules.active,
                pack.rules.start,
                pack.rules.end,
                ...pack.rules.checkpoints.map((p) => p.cell),
              ]
            : []
    if (ids.some((id) => id >= count))
      ctx.addIssue({ code: "custom", message: "Clue cell outside board" })
    if (
      pack.category === "tile_rotate_connect" &&
      pack.rules.ports.length !== count
    )
      ctx.addIssue({
        code: "custom",
        message: "Port count must equal cell count",
      })
    if (
      pack.visibility.kind === "partial" &&
      pack.visibility.visibleCells.some((id) => id >= count)
    )
      ctx.addIssue({ code: "custom", message: "Visible cell outside board" })
    const issue = (message: string) => ctx.addIssue({ code: "custom", message })
    if (
      new Set(pack.actionSurface.cycleValues).size !==
      pack.actionSurface.cycleValues.length
    )
      issue("Cycle values must be distinct")
    if (
      pack.cells.some(
        (cell) => !pack.actionSurface.cycleValues.includes(cell.value)
      )
    )
      issue("Initial cell outside action alphabet")
    if (pack.category === "binary_fill" || pack.category === "crown") {
      if (
        pack.actionSurface.effect !== "set-cell" ||
        pack.actionSurface.cycleValues.join(",") !== [null, 0, 1].join(",")
      )
        issue("Binary and crown games require empty, 0, 1 cell cycling")
    }
    if (pack.category === "binary_fill")
      for (const rule of pack.rules.constraints) {
        if (new Set(rule.cells).size !== rule.cells.length)
          issue("Constraint repeats a cell")
        if (rule.kind === "quota" && rule.ones > rule.cells.length)
          issue("Quota exceeds its cells")
      }
    if (pack.category === "crown" && pack.rules.regions) {
      const regions = pack.rules.regions
      if (
        regions.length !== count ||
        regions.some((id) => id >= pack.n) ||
        new Set(regions).size !== pack.n
      )
        issue("Crown regions must label every cell with one of n regions")
    }
    if (
      pack.category === "path_cover" &&
      pack.rules.walls?.some(
        ([a, b]) =>
          a >= count ||
          b >= count ||
          Math.abs(Math.floor(a / pack.n) - Math.floor(b / pack.n)) +
            Math.abs((a % pack.n) - (b % pack.n)) !==
            1
      )
    )
      issue("Path walls must sit between edge neighbours")
    if (
      pack.category === "crown" &&
      pack.rules.blocked.some(
        (id) => !pack.cells[id]?.locked || pack.cells[id]?.value !== 0
      )
    )
      issue("Blocked crown cells must be locked empty marks")
    if (pack.category === "path_cover") {
      if (new Set(pack.rules.active).size !== pack.rules.active.length)
        issue("Path cells must be distinct")
      if (
        !pack.rules.active.includes(pack.rules.start) ||
        !pack.rules.active.includes(pack.rules.end) ||
        pack.rules.start === pack.rules.end
      )
        issue("Path endpoints must be distinct active cells")
      if (
        pack.actionSurface.effect !== "set-cell" ||
        pack.actionSurface.cycleValues.length !==
          pack.rules.active.length + 1 ||
        pack.actionSurface.cycleValues.some(
          (value, id) => value !== (id === 0 ? null : id)
        )
      )
        issue("Path cycle must contain empty and every path order")
      if (
        pack.rules.checkpoints.some(
          (point) =>
            !pack.rules.active.includes(point.cell) ||
            point.order < 1 ||
            point.order > pack.rules.active.length ||
            !pack.cells[point.cell]?.locked ||
            pack.cells[point.cell]?.value !== point.order
        )
      )
        issue("Path checkpoints must be locked and within the path")
      if (
        pack.cells.some(
          (cell, id) =>
            !pack.rules.active.includes(id) &&
            (!cell.locked || cell.value !== null)
        )
      )
        issue("Inactive path cells must be locked blank")
    }
    if (
      pack.category === "tile_rotate_connect" &&
      (pack.actionSurface.effect !== "rotate-ports" ||
        pack.actionSurface.cycleValues.join(",") !== "0,1,2,3")
    )
      issue("Pipe tiles require quarter-turn rotations")
    if (
      pack.category === "lights_toggle" &&
      (pack.actionSurface.effect !== "toggle-cross" ||
        pack.actionSurface.cycleValues.join(",") !== "0,1" ||
        pack.cells.some((cell) => cell.locked))
    )
      issue("Lights require unlocked bits and cross toggles")
  })
export type GamePack = z.infer<typeof packSchema>
export type GameCategory = z.infer<typeof categorySchema>
export const assemblyRequestSchema = z.object({
  category: categorySchema,
  seed: z.number().int().safe(),
  n: z.union([z.literal(4), z.literal(5), z.literal(6)]),
  variant: z.string().max(80).optional(),
  preferences: z
    .object({
      mode: modeSchema.optional(),
      visibility: z.enum(["full", "partial"]).optional(),
      clueDensity: z.number().min(0.2).max(0.8).optional(),
      noDiagonalTouch: z.boolean().optional(),
      pathLength: z.number().int().min(4).max(12).optional(),
      binaryRule: binaryRuleSchema.optional(),
      /** Crown: paint n regions, one crown each (Queens). */
      regions: z.boolean().optional(),
      /** Full-cover path: inactive holes punched into the square. */
      holes: z.number().int().min(0).max(8).optional(),
      /** Full-cover path: walls along the route that break the stripes. */
      walls: z.number().int().min(0).max(14).optional(),
      /** Lights: scramble presses. */
      presses: z.number().int().min(1).max(12).optional(),
      targetSeconds: z.number().min(10).max(120).optional(),
    })
    .optional(),
})
export type AssemblyRequest = z.infer<typeof assemblyRequestSchema>
export type GameAction =
  | { type: "selectCell"; cell: number }
  | { type: "cycle" }
  | { type: "undo" }
  | { type: "clear" }
export type PackAudit = {
  certified: true
  solutionCount: number
  solutionMeaning: string
  unique: boolean
  nodes: number
  foothold: { cell: number; value: number; reason: string } | null
  solution: (number | null)[]
}
