import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"

const root = process.cwd()
const options = {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}

/** The source file an app import points at, or null for a package import. */
function sourceFor(specifier, from) {
  const base = specifier.startsWith("@/")
    ? join(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null
  if (!base) return null
  for (const path of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    base,
  ])
    if (existsSync(path) && /\.tsx?$/.test(path)) return path
  throw new Error(`Cannot resolve ${specifier} from ${relative(root, from)}`)
}

/**
 * Transpile app TypeScript entries and everything they import (`@/` and
 * relative paths) into `out`, mirroring the repo layout so Node can load it.
 * Package imports stay as-is and resolve from the repo's node_modules.
 * Returns a loader for repo-relative paths, e.g. `load("lib/foo.ts")`.
 */
export async function transpileGraph(entries, out) {
  const done = new Set()
  const target = (path) =>
    join(out, relative(root, path)).replace(/\.tsx?$/, ".js")
  const visit = async (path) => {
    if (done.has(path)) return
    done.add(path)
    const js = ts.transpileModule(await readFile(path, "utf8"), options)
      .outputText
    const pending = []
    const rewritten = js.replace(
      /(\bfrom\s*|\bimport\s*\(?\s*)"([^"\n]+)"/g,
      (match, lead, specifier) => {
        const source = sourceFor(specifier, path)
        if (!source) return match
        pending.push(source)
        let next = relative(dirname(target(path)), target(source))
        if (!next.startsWith(".")) next = `./${next}`
        return `${lead}"${next}"`
      }
    )
    await mkdir(dirname(target(path)), { recursive: true })
    await writeFile(target(path), rewritten)
    for (const source of pending) await visit(source)
  }
  for (const entry of entries) await visit(resolve(root, entry))
  return (path) => import(target(resolve(root, path)))
}
