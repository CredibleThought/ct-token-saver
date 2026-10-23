import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CavemanLevel, Compression, HeadroomMode, Savings } from '../types'
import { slice, tokens } from './compress'
import { isCompressible, labelOf, squeeze } from './tools'

const PLUGIN = 'ct-token-saver'
const PANE = 'ct-token-saver'
const PANE_TITLE = 'Token saver'
const RETRIEVE = 'headroom_retrieve'
const RETRIEVE_TOOL = `mcp__${PLUGIN}__${RETRIEVE}`

const LEVELS: readonly CavemanLevel[] = [
  'off',
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan-full',
  'wenyan-ultra',
]
const MODES: readonly HeadroomMode[] = ['off', 'safe', 'aggressive']

// Share of output tokens each level is assumed to cut, against a normal
// reply. `full` is caveman's measured 65%; the others are estimates.
const CUT: Record<CavemanLevel, number> = {
  off: 0,
  lite: 0.3,
  full: 0.65,
  ultra: 0.75,
  'wenyan-lite': 0.5,
  'wenyan-full': 0.7,
  'wenyan-ultra': 0.8,
}

const ZERO: Savings = {
  cavemanTurns: 0,
  cavemanOutputTokens: 0,
  cavemanSaved: 0,
  headroomCalls: 0,
  headroomBefore: 0,
  headroomAfter: 0,
  headroomRetrieved: 0,
}

const level = atom({ plugin: 'ct-token-saver', key: 'level' } as const, 'full' as CavemanLevel)
const headroom = atom({ plugin: 'ct-token-saver', key: 'headroom' } as const, 'safe' as HeadroomMode)
const session = atom({ plugin: 'ct-token-saver', key: 'session' } as const, ZERO)
const lifetime = atom({ plugin: 'ct-token-saver', key: 'lifetime' } as const, ZERO)
const recent = atom({ plugin: 'ct-token-saver', key: 'recent' } as const, [] as Compression[])

const LEVEL_RULES: Record<Exclude<CavemanLevel, 'off'>, string> = {
  lite: 'Level LITE: no filler or hedging. Keep articles and full sentences. Professional but tight.',
  full: 'Level FULL: drop articles, fragments OK, short synonyms. Classic caveman.',
  ultra:
    'Level ULTRA: also strip conjunctions where cause and effect stay unambiguous. One word when one word is enough. State each fact once.',
  'wenyan-lite':
    'Level WENYAN-LITE: semi-classical Chinese register. Drop filler and hedging but keep grammar structure.',
  'wenyan-full':
    'Level WENYAN-FULL: maximum classical terseness, fully 文言文: classical sentence patterns, subjects often omitted, classical particles (之/乃/為/其).',
  'wenyan-ultra':
    'Level WENYAN-ULTRA: extreme abbreviation while keeping classical Chinese feel. Maximum compression.',
}

function cavemanPrompt(l: Exclude<CavemanLevel, 'off'>): string {
  return [
    '# Caveman mode (token saver)',
    'Respond terse like smart caveman. All technical substance stays. Only fluff dies. Active every response until the user turns it off.',
    LEVEL_RULES[l],
    'Drop filler (just/really/basically/actually/simply), pleasantries (sure/certainly/happy to) and hedging. No narration before or between tool calls. No decorative tables or emoji. Quote only the shortest decisive line of an error log.',
    'Never drop not/never/no/only/except. Numbers, units, technical terms, code, API names, CLI commands and error strings stay exact. Code blocks unchanged. Do not invent abbreviations (cfg/impl/fn) and do not use arrows; they save no tokens.',
    "Reply in the user's language. Never name or announce the style.",
    'Write normal prose for anything persisted outside the chat: code, comments, commits, docs, PR text, files.',
    'Drop caveman for security warnings, irreversible-action confirmations, multi-step sequences where order could be misread, or when the user asks to clarify. Resume after.',
    'Pattern: [thing] [action] [reason]. [next step].',
  ].join('\n')
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

const headroomSaved = (s: Savings) =>
  Math.max(0, s.headroomBefore - s.headroomAfter - s.headroomRetrieved)
const totalSaved = (s: Savings) => s.cavemanSaved + headroomSaved(s)

async function bump($: EngineInterface, fn: (s: Savings) => Savings) {
  await update($, session, fn)
  const all = await update($, lifetime, fn)
  await $.store.set('lifetime', all)
  await refreshStatus($)
}

async function refreshStatus($: EngineInterface) {
  const l = await read($, level)
  const m = await read($, headroom)
  const s = await read($, session)
  $.ui.status(`caveman ${l} · headroom ${m} · saved ~${fmt(totalSaved(s))} tok`)
}

async function setLevel($: EngineInterface, l: CavemanLevel) {
  await update($, level, () => l)
  await $.store.set('level', l)
  await refreshStatus($)
}

async function setMode($: EngineInterface, m: HeadroomMode) {
  await update($, headroom, () => m)
  await $.store.set('headroom', m)
  await refreshStatus($)
}

async function openPane($: EngineInterface): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
  return opened.isPlaced ? '' : ` (pane could not be shown here: ${opened.reason})`
}

// One place that answers "caveman <level>", "headroom <mode>" and
// "tokens saved" (each optionally led by "ct-"), whichever way they arrive: slash command, plain text, tool.
async function runSetting(
  $: EngineInterface,
  what: 'caveman' | 'headroom' | 'tokens-saved',
  rawArg: string,
): Promise<string> {
  const arg = rawArg.trim().toLowerCase()
  if (what === 'caveman') {
    if (arg === '') {
      return `Caveman is ${await read($, level)}. Levels: ${LEVELS.join(', ')}.`
    }
    const l = arg === 'stop' || arg === 'normal' ? 'off' : arg
    if (!(LEVELS as string[]).includes(l)) {
      return `Unknown caveman level "${arg}". Use one of: ${LEVELS.join(', ')}.`
    }
    await setLevel($, l as CavemanLevel)
    return `Caveman set to ${l}.`
  }
  if (what === 'headroom') {
    if (arg === '') {
      return `Headroom is ${await read($, headroom)}. Modes: ${MODES.join(', ')}.`
    }
    if (!(MODES as string[]).includes(arg)) {
      return `Unknown headroom mode "${arg}". Use one of: ${MODES.join(', ')}.`
    }
    await setMode($, arg as HeadroomMode)
    return `Headroom set to ${arg}.`
  }
  const note = await openPane($)
  const s = await read($, session)
  const all = await read($, lifetime)
  return (
    `Saved ~${fmt(totalSaved(s))} tokens this session ` +
    `(caveman ~${fmt(s.cavemanSaved)}, headroom ~${fmt(headroomSaved(s))}); ` +
    `~${fmt(totalSaved(all))} all time. Caveman: ${await read($, level)}, headroom: ${await read($, headroom)}.${note}`
  )
}

// Plain-text forms, for apps whose chat box only knows skills after "/":
// "caveman ultra", "!caveman ultra", "headroom safe", "tokens saved".
const TYPED = /^\s*[!/]?\s*(?:ct[ -])?(caveman|headroom|tokens[ -]?saved|token[ -]saver|(?<=ct[ -])tokens)\b\s*([\w-]*)\s*$/i

export const register: Register = on => {
  // Originals of lossy compressions, so the model can get them back.
  const stash = new Map<string, string>()
  let nextId = 1

  on('session.start', async ($, e, next) => {
    const storedLevel = await $.store.get('level')
    const storedMode = await $.store.get('headroom')
    const storedAll = await $.store.get('lifetime')
    if (typeof storedLevel === 'string' && (LEVELS as string[]).includes(storedLevel)) {
      await update($, level, () => storedLevel as CavemanLevel)
    }
    if (typeof storedMode === 'string' && (MODES as string[]).includes(storedMode)) {
      await update($, headroom, () => storedMode as HeadroomMode)
    }
    if (storedAll !== null && typeof storedAll === 'object' && !Array.isArray(storedAll)) {
      await update($, lifetime, () => ({ ...ZERO, ...(storedAll as Partial<Savings>) }))
    }

    await $.tool.register({
      name: RETRIEVE,
      description:
        'Get back tool output that Headroom compressed. Pass the id from a "[headroom: ... id=...]" note. Optional: from/to (1-based line range) or grep (regex) to fetch only part of it.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          from: { type: 'number' },
          to: { type: 'number' },
          grep: { type: 'string' },
        },
        required: ['id'],
      },
    })
    await $.tool.register({
      name: 'settings',
      description:
        'ct-token-saver mod: set the caveman reply level and/or the headroom tool-output compression mode, or show tokens saved. Use when the user asks to change caveman level, headroom mode, or see token savings.',
      inputSchema: {
        type: 'object',
        properties: {
          caveman: { type: 'string', description: `Caveman level: ${LEVELS.join(', ')}. Empty string: report the current level.` },
          headroom: { type: 'string', description: `Headroom mode: ${MODES.join(', ')}. Empty string: report the current mode.` },
          show: { type: 'boolean', description: 'Open the savings pane and report totals' },
        },
      },
      isDeferred: false,
    })
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    await refreshStatus($)

    return next(e)
  })

  // Slash forms come from the plugin's skills (skills/*/SKILL.md), which
  // every app lists after "/"; they call the settings tool below.

  // The same settings typed as a plain message. The setting is applied here;
  // the prompt still goes through, with the answer attached, so the reply
  // shows it (the desktop app shows neither a dropped prompt's reason nor a toast).
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const m = TYPED.exec(e.text)
    if (m === null) return next(e)
    const word = (m[1] ?? '').toLowerCase()
    const what = word === 'caveman' ? 'caveman' : word === 'headroom' ? 'headroom' : 'tokens-saved'
    const answer = (await runSetting($, what, m[2] ?? '')).replace(/ \(pane could not be shown here:.*\)$/, '')
    $.ui.toast(answer)
    return next({
      ...e,
      context: [
        ...(e.context ?? []),
        `[ct-token-saver mod] Already done, do not call any tool. Reply with exactly this line and nothing else:\n${answer}`,
      ],
    })
  })

  // And in plain words ("set caveman to lite"): the model calls this tool.
  on('tool.call', { tool: /^mcp__ct-token-saver__settings$/ }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const parts: string[] = []
    if (typeof input.caveman === 'string') parts.push(await runSetting($, 'caveman', input.caveman))
    if (typeof input.headroom === 'string') parts.push(await runSetting($, 'headroom', input.headroom))
    if (parts.length === 0 || input.show === true) parts.push(await runSetting($, 'tokens-saved', ''))
    return { result: parts.join(' ') }
  })

  on('session.attach', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: PANE_TITLE })
    return next(e)
  })

  // --- Caveman: system prompt + savings estimate -----------------------------

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const l = await read($, level)
    if (l === 'off') return composed

    return {
      sections: [
        ...composed.sections,
        { id: `${PLUGIN}:caveman`, text: cavemanPrompt(l), scope: 'session' as const },
      ],
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const l = await read($, level)
    const out = e.usage?.output_tokens ?? 0
    if (e.agentId === undefined && l !== 'off' && out > 0) {
      // What the reply would likely have cost without caveman.
      const saved = Math.round(out / (1 - CUT[l]) - out)
      await bump($, s => ({
        ...s,
        cavemanTurns: s.cavemanTurns + 1,
        cavemanOutputTokens: s.cavemanOutputTokens + out,
        cavemanSaved: s.cavemanSaved + saved,
      }))
    }
    return done
  })

  // --- Headroom: compress tool output, serve retrievals ----------------------

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!isCompressible(tool) || ran.deny !== undefined || ran.isError === true) return ran
    const m = await read($, headroom)
    if (m === 'off') return ran

    const id = `hr${nextId}`
    const note = `\n[headroom: output compressed, id=${id}. Call ${RETRIEVE_TOOL} for the omitted parts]`
    const c = squeeze(tool, ran.result, m, note)
    if (c === undefined || c.after >= c.before) return ran

    nextId++
    if (c.isLossy) {
      stash.set(id, c.original)
      if (stash.size > 30) stash.delete(stash.keys().next().value as string)
    }
    const entry: Compression = {
      id,
      tool,
      label: labelOf(tool, e as unknown as Record<string, unknown>),
      before: c.before,
      after: c.after,
    }
    await update($, recent, list => [entry, ...list].slice(0, 8))
    await bump($, s => ({
      ...s,
      headroomCalls: s.headroomCalls + 1,
      headroomBefore: s.headroomBefore + c.before,
      headroomAfter: s.headroomAfter + c.after,
    }))

    return { result: c.result as never }
  }).catch(($, e, next) =>
    // Compression failed: hand the model the untouched output.
    next(e),
  )

  on('tool.call', { tool: /^mcp__ct-token-saver__headroom_retrieve$/ }, async ($, e) => {
    // The tool's arguments ride on the event beside `tool` and `tool_use_id`.
    const input = e as unknown as Record<string, unknown>
    const id = String(input.id ?? '')
    const original = stash.get(id)
    if (original === undefined) {
      return { result: `No stored output for id "${id}" (it may have expired). Re-run the command instead.` }
    }
    const text = slice(original, {
      from: typeof input.from === 'number' ? input.from : undefined,
      to: typeof input.to === 'number' ? input.to : undefined,
      grep: typeof input.grep === 'string' ? input.grep : undefined,
    })
    const cost = tokens(text)
    await bump($, s => ({ ...s, headroomRetrieved: s.headroomRetrieved + cost }))
    return { result: text }
  })

  // --- The pane --------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, level)
    const m = await read($, headroom)
    const s = await read($, session)
    const all = await read($, lifetime)
    const list = await read($, recent)
    const hSaved = headroomSaved(s)
    const hPct = s.headroomBefore > 0 ? Math.round((hSaved / s.headroomBefore) * 100) : 0

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Saved this session: ~{fmt(totalSaved(s))} tokens</Text>
          <Text dimColor>All time: ~{fmt(totalSaved(all))} tokens</Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Caveman · {l}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {LEVELS.map(one => (
              <Button key={`level-${one}`} label={one === l ? `[${one}]` : one} onPress={() => setLevel($, one)} />
            ))}
          </Box>
          <Text dimColor>
            {s.cavemanTurns} replies · {fmt(s.cavemanOutputTokens)} output tokens · ~{fmt(s.cavemanSaved)} saved (est.)
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Headroom · {m}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {MODES.map(one => (
              <Button key={`mode-${one}`} label={one === m ? `[${one}]` : one} onPress={() => setMode($, one)} />
            ))}
          </Box>
          <Text dimColor>
            {s.headroomCalls} outputs · {fmt(s.headroomBefore)} → {fmt(s.headroomAfter)} tokens · ~{fmt(hSaved)} saved ({hPct}%)
          </Text>
          {s.headroomRetrieved > 0 && (
            <Text dimColor>{fmt(s.headroomRetrieved)} tokens pulled back via retrieve (subtracted)</Text>
          )}
        </Box>

        {list.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Recent compressions</Text>
            {list.map(c => (
              <Text dimColor>
                {fmt(c.before)} → {fmt(c.after)} · {c.label}
              </Text>
            ))}
          </Box>
        )}

        <Button
          key="reset"
          label="Reset session count"
          onPress={async () => {
            await update($, session, () => ZERO)
            await update($, recent, () => [])
            await refreshStatus($)
          }}
        />
      </Box>
    )
  })
}
