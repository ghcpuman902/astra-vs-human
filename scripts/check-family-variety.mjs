// Variety audit (family-expansion-plan E1). Deals each family over many seeds
// and reports how many different answers players actually meet.
//   node scripts/check-family-variety.mjs [--deals 100] [--root ../other-checkout] [--no-assert]
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at < 0 ? fallback : process.argv[at + 1]
}
const deals = Number(arg("--deals", 100))
const root = resolve(arg("--root", "."))
const check = !process.argv.includes("--no-assert")

const out = await mkdtemp(join(tmpdir(), "astra-variety-"))
const compile = (source) =>
  ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/from "(\.\.?\/[^".]+)"/g, 'from "$1.js"')
try {
  await writeFile(out + "/package.json", '{"type":"module"}')
  await symlink(resolve("node_modules"), out + "/node_modules")
  for (const folder of ["puzzle", "mini-game-rules", "battle-ground-ui"]) {
    await mkdir(out + "/" + folder)
    for (const file of await readdir(join(root, "lib", folder)))
      if (file.endsWith(".ts"))
        await writeFile(
          join(out, folder, file.replace(/\.ts$/, ".js")),
          compile(await readFile(join(root, "lib", folder, file), "utf8"))
        )
  }
  for (const file of ["model-refusal.ts", "provider-schema.ts", "learner-models.ts"])
    await writeFile(
      join(out, file.replace(/\.ts$/, ".js")),
      compile(await readFile(join(root, "lib", file), "utf8"))
    )
  const { assembleGamePack } = await import(out + "/mini-game-rules/assembler.js")
  const { verifyGame } = await import(out + "/mini-game-rules/verifier.js")
  const deck = await import(out + "/battle-ground-ui/match-deck.js")
  const { FAMILY_DEFS } = await import(out + "/battle-ground-ui/family-bias.js")
  // Older checkouts have no knobs: rebuild their request the way they dealt it.
  const requestFor =
    deck.familyRequest ??
    ((def, seed, round) => ({
      category: def.category,
      seed,
      n: def.n,
      variant: `${def.id}-r${round + 1}`,
      preferences: {
        visibility: "full",
        targetSeconds: def.n <= 4 ? 60 : def.n === 5 ? 75 : 90,
      },
    }))

  const shape = (category, n, solution) => {
    const length = Math.max(0, ...solution.map((v) => v ?? 0))
    const variants = [solution]
    if (category === "path_cover")
      variants.push(solution.map((v) => (v === null ? null : length + 1 - v)))
    if (category === "binary_fill")
      variants.push(solution.map((v) => (v === null ? null : 1 - v)))
    let best = ""
    for (const cells of variants)
      for (let turn = 0; turn < 8; turn++) {
        const key = Array.from({ length: n * n }, (_, id) => {
          let row = Math.floor(id / n),
            col = id % n
          if (turn & 4) col = n - 1 - col
          for (let i = 0; i < (turn & 3); i++) [row, col] = [col, n - 1 - row]
          return cells[row * n + col] ?? "."
        }).join(",")
        if (!best || key < best) best = key
      }
    return best
  }
  /** Hairpins: three moves where the first and last point opposite ways. */
  const hairpins = (route) => {
    const moves = route.slice(1).map((id, i) => id - route[i])
    let count = 0
    for (let i = 0; i + 2 < moves.length; i++)
      if (moves[i] === -moves[i + 2] && Math.abs(moves[i + 1]) !== Math.abs(moves[i]))
        count++
    return count
  }
  /** Share of steps on a straight run that spans the whole board. */
  const wallToWall = (route, n) => {
    const moves = route.slice(1).map((id, i) => id - route[i])
    let onLong = 0
    for (let i = 0; i < moves.length; ) {
      let j = i
      while (j < moves.length && moves[j] === moves[i]) j++
      if (j - i >= n - 1) onLong += j - i
      i = j
    }
    return moves.length ? onLong / moves.length : 0
  }

  const mean = (values) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const rows = []
  for (const def of FAMILY_DEFS) {
    const shapes = new Map()
    const stats = {
      fail: 0,
      ms: [],
      givens: [],
      marks: [],
      chips: [],
      forced: 0,
      hairpins: [],
      straights: [],
      thirds: [],
      solutions: [],
    }
    for (let i = 0; i < deals; i++) {
      const seed = (1_000 + i * 7_919) >>> 0
      const started = performance.now()
      let built
      try {
        built = assembleGamePack(requestFor(def, seed, i % 5))
      } catch {
        stats.fail++
        continue
      }
      stats.ms.push(performance.now() - started)
      const { pack, audit } = built
      assert.ok(verifyGame(pack, audit.solution).complete, `${def.id}/${seed}`)
      // Lights always end all-off; their variety is the starting board.
      const key = shape(
        pack.category,
        pack.n,
        pack.category === "lights_toggle"
          ? pack.cells.map((cell) => cell.value)
          : audit.solution
      )
      shapes.set(key, (shapes.get(key) ?? 0) + 1)
      if (pack.mode === "FORCED-CHAIN") stats.forced++
      stats.solutions.push(audit.solutionCount)
      if (pack.category === "binary_fill") {
        const kinds = pack.rules.constraints.map((rule) => rule.kind)
        stats.givens.push(pack.cells.filter((cell) => cell.locked).length)
        stats.marks.push(kinds.filter((kind) => kind === "friend").length)
        stats.chips.push(kinds.filter((kind) => kind === "quota").length)
      } else if (pack.category === "crown") {
        stats.givens.push(pack.cells.filter((c) => c.locked && c.value === 1).length)
        stats.marks.push(pack.rules.blocked.length)
        stats.chips.push(pack.rules.regions ? 1 : 0)
      } else if (pack.category === "path_cover") {
        const route = audit.solution
          .map((order, id) => [order, id])
          .filter(([order]) => order !== null)
          .sort((a, b) => a[0] - b[0])
          .map(([, id]) => id)
        const inner = pack.rules.checkpoints.filter(
          (p) => p.order !== 1 && p.order !== route.length
        )
        stats.givens.push(pack.rules.checkpoints.length)
        stats.marks.push(pack.rules.walls?.length ?? 0)
        stats.chips.push(pack.n ** 2 - pack.rules.active.length)
        stats.hairpins.push(hairpins(route))
        stats.straights.push(wallToWall(route, pack.n))
        stats.thirds.push(
          new Set(inner.map((p) => Math.min(2, Math.floor((3 * (p.order - 1)) / route.length)))).size
        )
      } else if (pack.category === "lights_toggle") {
        stats.givens.push(pack.cells.filter((c) => c.value === 1).length)
      }
    }
    const made = deals - stats.fail
    const top = Math.max(0, ...shapes.values())
    rows.push({
      id: def.id,
      category: def.category,
      n: def.n,
      made,
      distinct: shapes.size,
      top: made ? top / made : 0,
      ms: mean(stats.ms),
      givens: mean(stats.givens),
      marks: mean(stats.marks),
      chips: mean(stats.chips),
      forced: made ? stats.forced / made : 0,
      unique: made ? stats.solutions.filter((c) => c === 1).length / made : 0,
      hairpins: mean(stats.hairpins),
      straights: mean(stats.straights),
      thirds: mean(stats.thirds),
    })
  }
  const fmt = (value, digits = 1) =>
    Number.isFinite(value) ? value.toFixed(digits) : "–"
  console.log(
    `Variety audit · ${deals} deals per family · ${root === resolve(".") ? "this checkout" : root}\n`
  )
  console.log(
    "| Family | Mechanic | n | Made | Distinct answers | Top answer | Givens | Marks | Chips/holes | Forced | Unique | Hairpins | Wall-to-wall | Pin thirds | ms |"
  )
  console.log("|" + " --- |".repeat(15))
  for (const row of rows)
    console.log(
      `| ${row.id} | ${row.category} | ${row.n} | ${row.made} | ${row.distinct} | ${fmt(100 * row.top, 0)}% | ${fmt(row.givens)} | ${fmt(row.marks)} | ${fmt(row.chips)} | ${fmt(100 * row.forced, 0)}% | ${fmt(100 * row.unique, 0)}% | ${row.category === "path_cover" ? fmt(row.hairpins, 2) : "–"} | ${row.category === "path_cover" ? fmt(row.straights, 2) : "–"} | ${row.category === "path_cover" ? fmt(row.thirds, 2) : "–"} | ${fmt(row.ms, 0)} |`
    )
  console.log(
    "\nMarks: binary = and × markers, crown blocked cells, path walls. Chips/holes: binary line counts, crown regions (1 = painted), path holes. Pin thirds: how many thirds of the route hold an inner pin (0–3)."
  )

  if (check) {
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const row of rows) {
      assert.ok(row.made >= deals * 0.8, `${row.id} assembles too rarely (${row.made}/${deals})`)
      if (row.category === "binary_fill" || row.category === "path_cover")
        assert.ok(row.distinct >= row.made * 0.85, `${row.id} repeats its answers (${row.distinct}/${row.made})`)
    }
    // Siblings must differ on something a player can see, not only the label.
    const signature = (row) =>
      [row.n, fmt(row.chips > 0 ? 1 : 0, 0), fmt(row.marks > 0.5 ? 1 : 0, 0)].join("/")
    for (const [a, b] of [
      ["summer-moons", "quota-islands"],
      ["crown-seats", "sparse-crowns"],
      ["number-trail", "checkpoint-snake"],
      ["number-trail", "odd-shapes"],
    ])
      if (byId.has(a) && byId.has(b))
        assert.notEqual(signature(byId.get(a)), signature(byId.get(b)), `${a} and ${b} deal the same boards`)
    const summer = byId.get("summer-moons")
    if (summer?.n === 6) assert.equal(summer.chips, 0, "Summer Moons draws per-line numbers")
  }
} finally {
  await rm(out, { recursive: true, force: true })
}
