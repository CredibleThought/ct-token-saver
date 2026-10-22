// Headroom-style compression of tool output. Pure functions: no `$`.
//
// safe:       lossless or near-lossless (ANSI codes, progress-bar redraws,
//             trailing spaces, blank-line runs, repeated lines, JSON minify)
// aggressive: also drops the middle of very long output and the bulk of big
//             JSON arrays, always keeping error/warning lines and items. The
//             caller stashes the original so the model can retrieve it.

import type { HeadroomMode } from '../types'

export type Compressed = { text: string; isLossy: boolean }

// Rough tokens: ~4 chars per token for English and code.
export const tokens = (text: string): number => Math.ceil(text.length / 4)

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const SIGNAL =
  /error|fail|warn|exception|traceback|panic|fatal|denied|refused|not found|cannot|undefined|assert/i

const HEAD = 40
const TAIL = 30
const LONG = HEAD + TAIL + 50
const MAX_SIGNAL = 40
const ARRAY_KEEP_HEAD = 5
const ARRAY_KEEP_TAIL = 2
const ARRAY_LONG = 20

function cleanLines(text: string): string[] {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      // A progress bar redraws with \r: only the last frame matters.
      const cut = line.lastIndexOf('\r')
      return (cut >= 0 ? line.slice(cut + 1) : line).replace(/[ \t]+$/, '')
    })
}

function collapseBlanks(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (line === '' && out.length > 0 && out[out.length - 1] === '') continue
    out.push(line)
  }
  return out
}

function collapseRepeats(lines: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    const line = lines[i] ?? ''
    while (j < lines.length && lines[j] === line) j++
    const run = j - i
    if (run >= 3 && line !== '') {
      out.push(line, `[previous line repeated ${run - 1} more times]`)
    } else {
      for (let k = i; k < j; k++) out.push(line)
    }
    i = j
  }
  return out
}

function trimMiddle(lines: string[]): { lines: string[]; isLossy: boolean } {
  if (lines.length <= LONG) return { lines, isLossy: false }
  const middle = lines.slice(HEAD, lines.length - TAIL)
  const kept: string[] = []
  let skipped = 0
  const flush = () => {
    if (skipped > 0) kept.push(`[... ${skipped} lines omitted ...]`)
    skipped = 0
  }
  let signals = 0
  for (const line of middle) {
    if (signals < MAX_SIGNAL && SIGNAL.test(line)) {
      flush()
      kept.push(line)
      signals++
    } else {
      skipped++
    }
  }
  flush()
  return {
    lines: [...lines.slice(0, HEAD), ...kept, ...lines.slice(lines.length - TAIL)],
    isLossy: true,
  }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function crushJson(value: Json): { value: Json; isLossy: boolean } {
  if (Array.isArray(value)) {
    let isLossy = false
    const items = value.map(item => {
      const crushed = crushJson(item)
      isLossy ||= crushed.isLossy
      return crushed.value
    })
    if (items.length <= ARRAY_LONG) return { value: items, isLossy }
    const keep = new Set<number>()
    for (let i = 0; i < ARRAY_KEEP_HEAD; i++) keep.add(i)
    for (let i = items.length - ARRAY_KEEP_TAIL; i < items.length; i++) keep.add(i)
    items.forEach((item, i) => {
      if (keep.size < ARRAY_KEEP_HEAD + ARRAY_KEEP_TAIL + MAX_SIGNAL && SIGNAL.test(JSON.stringify(item))) {
        keep.add(i)
      }
    })
    const out: Json[] = []
    let skipped = 0
    items.forEach((item, i) => {
      if (keep.has(i)) {
        if (skipped > 0) out.push(`[headroom: ${skipped} similar items omitted]`)
        skipped = 0
        out.push(item)
      } else {
        skipped++
      }
    })
    if (skipped > 0) out.push(`[headroom: ${skipped} similar items omitted]`)
    return { value: out, isLossy: true }
  }
  if (value !== null && typeof value === 'object') {
    let isLossy = false
    const out: { [k: string]: Json } = {}
    for (const [k, v] of Object.entries(value)) {
      const crushed = crushJson(v)
      isLossy ||= crushed.isLossy
      out[k] = crushed.value
    }
    return { value: out, isLossy }
  }
  return { value, isLossy: false }
}

function tryJson(text: string, mode: HeadroomMode): Compressed | undefined {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined
  let parsed: Json
  try {
    parsed = JSON.parse(t) as Json
  } catch {
    return undefined
  }
  if (mode === 'aggressive') {
    const crushed = crushJson(parsed)
    return { text: JSON.stringify(crushed.value), isLossy: crushed.isLossy }
  }
  return { text: JSON.stringify(parsed), isLossy: false }
}

export function compress(text: string, mode: HeadroomMode): Compressed {
  if (mode === 'off' || text.length < 400) return { text, isLossy: false }

  const json = tryJson(text, mode)
  if (json !== undefined) return json

  let lines = collapseRepeats(collapseBlanks(cleanLines(text)))
  let isLossy = false
  if (mode === 'aggressive') {
    const trimmed = trimMiddle(lines)
    lines = trimmed.lines
    isLossy = trimmed.isLossy
  }
  return { text: lines.join('\n'), isLossy }
}

// What the retrieve tool answers: the whole original, a line range, or the
// lines matching a pattern (with line numbers).
export function slice(
  original: string,
  args: { from?: number; to?: number; grep?: string },
): string {
  const lines = original.split('\n')
  if (args.grep) {
    let re: RegExp
    try {
      re = new RegExp(args.grep, 'i')
    } catch {
      return `Invalid pattern: ${args.grep}`
    }
    const hits = lines
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => re.test(line))
      .map(([n, line]) => `${n}: ${line}`)
    return hits.length > 0 ? hits.join('\n') : 'No lines match.'
  }
  if (args.from !== undefined || args.to !== undefined) {
    const from = Math.max(1, args.from ?? 1)
    const to = Math.min(lines.length, args.to ?? lines.length)
    return lines.slice(from - 1, to).join('\n')
  }
  return original
}
