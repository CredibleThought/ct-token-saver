// Which tool results Headroom compresses, and how, per tool. Pure: no `$`.
//
// Bash      stdout/stderr through compress()
// Grep      content mode: lines grouped under their file (path written once),
//           then compress(); file lists grouped by folder
// Glob      file lists grouped by folder
// WebFetch  the fetched text through compress()
// mcp__*    every text block through compress() (connector and browser output)
//
// Read, Edit and Write are never touched: editing needs the exact text.
// Neither are connectors whose text is edited by exact match (docs, sheets).

import type { HeadroomMode } from '../types'
import { compress, tokens } from './compress'

export type Squeezed = {
  result: unknown
  before: number
  after: number
  isLossy: boolean
  original: string
}

const OWN = /^mcp__ct-token-saver__/
// Connectors whose read output is later matched exactly by an edit call.
const EXACT = /Claude_Docs|Google_?(Docs|Sheets|Drive)|Notion|Confluence|Excel|Word/i
const MIN_FILES = 10

export const isCompressible = (tool: string): boolean =>
  tool === 'Bash' ||
  tool === 'Grep' ||
  tool === 'Glob' ||
  tool === 'WebFetch' ||
  (tool.startsWith('mcp__') && !OWN.test(tool) && !EXACT.test(tool))

// "/a/b/x.ts", "/a/b/y.ts", "/a/c.ts" -> "/a/b/: x.ts, y.ts", "/a/c.ts"
export function groupPaths(paths: readonly string[]): string[] {
  if (paths.length < MIN_FILES) return [...paths]
  const byDir = new Map<string, string[]>()
  for (const p of paths) {
    const cut = p.lastIndexOf('/')
    const dir = cut >= 0 ? p.slice(0, cut + 1) : ''
    const list = byDir.get(dir) ?? []
    list.push(p.slice(cut + 1))
    byDir.set(dir, list)
  }
  const out: string[] = []
  for (const [dir, names] of byDir) {
    if (names.length === 1 || dir === '') out.push(...names.map(n => dir + n))
    else out.push(`${dir}: ${names.join(', ')}`)
  }
  return out
}

// "/long/path/f.ts:12:text" lines -> "/long/path/f.ts" then "  12: text",
// for runs of two or more lines from one file (a lone line stays as it was).
export function groupGrep(content: string, files: readonly string[]): string {
  if (files.length === 0) return content
  const sorted = [...files].sort((a, b) => b.length - a.length)
  const runs: { file: string | undefined; lines: string[] }[] = []
  for (const line of content.split('\n')) {
    const file = sorted.find(f => line.startsWith(`${f}:`) || line.startsWith(`${f}-`))
    const last = runs[runs.length - 1]
    if (last !== undefined && file !== undefined && last.file === file) last.lines.push(line)
    else runs.push({ file, lines: [line] })
  }
  const out: string[] = []
  for (const run of runs) {
    if (run.file === undefined || run.lines.length < 2) {
      out.push(...run.lines)
      continue
    }
    const file = run.file
    out.push(file, ...run.lines.map(l => `  ${l.slice(file.length + 1).replace(/^(\d+)[:-]/, '$1: ')}`))
  }
  return out.join('\n')
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v)

function squeezeBlocks(blocks: readonly unknown[], mode: HeadroomMode, note: string) {
  let before = 0
  let after = 0
  let isLossy = false
  const originals: string[] = []
  const lastText = blocks.reduce<number>((at, b, i) => (isRec(b) && b.type === 'text' ? i : at), -1)
  const next = blocks.map((b, i) => {
    if (!isRec(b) || b.type !== 'text' || typeof b.text !== 'string') return b
    const c = compress(b.text, mode)
    before += tokens(b.text)
    originals.push(b.text)
    isLossy ||= c.isLossy
    let text = c.text
    if (i === lastText && isLossy) text += note
    after += tokens(text)
    return { ...b, text }
  })
  return { blocks: next, before, after, isLossy, original: originals.join('\n') }
}

// `note` is appended where the model reads it when anything was dropped.
export function squeeze(
  tool: string,
  result: unknown,
  mode: HeadroomMode,
  note: string,
): Squeezed | undefined {
  if (mode === 'off' || !isCompressible(tool) || result === undefined) return undefined

  if (tool === 'Bash' && isRec(result)) {
    if (result.isImage === true || result.backgroundTaskId !== undefined) return undefined
    const stdout = String(result.stdout ?? '')
    const stderr = String(result.stderr ?? '')
    const out = compress(stdout, mode)
    const err = compress(stderr, mode)
    const isLossy = out.isLossy || err.isLossy
    const next = {
      ...result,
      stdout: out.text + (out.isLossy ? note : ''),
      stderr: err.text + (!out.isLossy && err.isLossy ? note : ''),
    }
    return {
      result: next,
      before: tokens(stdout) + tokens(stderr),
      after: tokens(next.stdout) + tokens(next.stderr),
      isLossy,
      original: [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n'),
    }
  }

  if (tool === 'Grep' && isRec(result)) {
    const files = Array.isArray(result.filenames) ? (result.filenames as string[]) : []
    if (typeof result.content === 'string' && result.content !== '') {
      const content = result.content
      const c = compress(groupGrep(content, files), mode)
      const text = c.text + (c.isLossy ? note : '')
      return {
        result: { ...result, content: text },
        before: tokens(content),
        after: tokens(text),
        isLossy: c.isLossy,
        original: content,
      }
    }
    const grouped = groupPaths(files)
    return {
      result: { ...result, filenames: grouped },
      before: tokens(files.join('\n')),
      after: tokens(grouped.join('\n')),
      isLossy: false,
      original: files.join('\n'),
    }
  }

  if (tool === 'Glob' && isRec(result) && Array.isArray(result.filenames)) {
    const files = result.filenames as string[]
    const grouped = groupPaths(files)
    return {
      result: { ...result, filenames: grouped },
      before: tokens(files.join('\n')),
      after: tokens(grouped.join('\n')),
      isLossy: false,
      original: files.join('\n'),
    }
  }

  if (tool === 'WebFetch' && isRec(result) && typeof result.result === 'string') {
    const text = result.result
    const c = compress(text, mode)
    const next = c.text + (c.isLossy ? note : '')
    return {
      result: { ...result, result: next },
      before: tokens(text),
      after: tokens(next),
      isLossy: c.isLossy,
      original: text,
    }
  }

  if (tool.startsWith('mcp__')) {
    if (typeof result === 'string') {
      const c = compress(result, mode)
      const next = c.text + (c.isLossy ? note : '')
      return { result: next, before: tokens(result), after: tokens(next), isLossy: c.isLossy, original: result }
    }
    if (Array.isArray(result)) {
      const s = squeezeBlocks(result, mode, note)
      return { result: s.blocks, before: s.before, after: s.after, isLossy: s.isLossy, original: s.original }
    }
    if (isRec(result) && Array.isArray(result.content)) {
      const s = squeezeBlocks(result.content, mode, note)
      return {
        result: { ...result, content: s.blocks },
        before: s.before,
        after: s.after,
        isLossy: s.isLossy,
        original: s.original,
      }
    }
  }
  return undefined
}

export function labelOf(tool: string, e: Record<string, unknown>): string {
  const pick = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : undefined)
  const what =
    tool === 'Bash'
      ? (pick('description') ?? pick('command'))
      : (pick('pattern') ?? pick('url') ?? pick('query') ?? '')
  const short = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' ') : tool
  return `${short}${what ? `: ${what}` : ''}`.slice(0, 60)
}
