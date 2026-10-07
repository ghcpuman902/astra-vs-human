import { mkdir, writeFile } from "node:fs/promises"

import { loadGameRuntime } from "./load-game-runtime.mjs"

const categories = [
  "binary_fill",
  "crown",
  "path_cover",
  "tile_rotate_connect",
  "lights_toggle",
  "lamp_rays",
]
const seeds = [0, 7, 41]

/** Presses that return a lights board to all-off. Pivot columns only. */
function lightsPresses(n, cells) {
  const count = n * n
  const width = count + 1
  const matrix = Array.from({ length: count }, (_, row) => {
    const line = Array(width).fill(0)
    line[width - 1] = cells[row] === 1 ? 1 : 0
    return line
  })
  const touch = (cell) => {
    const row = Math.floor(cell / n)
    const col = cell % n
    const ids = [cell]
    if (row > 0) ids.push(cell - n)
    if (col < n - 1) ids.push(cell + 1)
    if (row < n - 1) ids.push(cell + n)
    if (col > 0) ids.push(cell - 1)
    return ids
  }
  for (let col = 0; col < count; col++)
    for (const row of touch(col)) matrix[row][col] = 1
  let rank = 0
  const where = Array(count).fill(-1)
  for (let col = 0; col < count && rank < count; col++) {
    let pivot = -1
    for (let row = rank; row < count; row++) {
      if (matrix[row][col]) {
        pivot = row
        break
      }
    }
    if (pivot < 0) continue
    ;[matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]]
    for (let row = 0; row < count; row++) {
      if (row === rank || !matrix[row][col]) continue
      for (let j = col; j < width; j++) matrix[row][j] ^= matrix[rank][j]
    }
    where[col] = rank
    rank++
  }
  const presses = []
  for (let col = 0; col < count; col++) {
    if (where[col] >= 0 && matrix[where[col]][width - 1]) presses.push(col)
  }
  return presses
}

const runtime = await loadGameRuntime("save-fixtures")
try {
  const games = []
  const add = (id, label, category, seed, n) => {
    const { pack, audit } = runtime.assembleGamePack({ category, seed, n })
    const presses =
      category === "lights_toggle"
        ? lightsPresses(
            n,
            pack.cells.map((cell) => cell.value)
          )
        : undefined
    games.push({
      id,
      label,
      category,
      seed,
      n,
      pack,
      solution: audit.solution,
      ...(presses ? { presses } : {}),
    })
  }
  for (const category of categories)
    for (const seed of seeds) add(`${category}-${seed}`, category, category, seed, 4)
  add("summer-moons", "Summer Moons", "binary_fill", 700, 4)
  await mkdir("fixtures/agent-games", { recursive: true })
  await writeFile(
    "fixtures/agent-games/index.json",
    `${JSON.stringify({ version: 1, games }, null, 2)}\n`
  )
  console.log(`wrote ${games.length} games`)
} finally {
  await runtime.cleanup()
}
