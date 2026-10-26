import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'ct-token-saver',
  component: 'Pane',
  requestId: 'ct-token-saver',
  props: {
    title: 'Token saver',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const noisy =
  '\x1b[32mok\x1b[0m   \n' +
  Array.from({ length: 300 }, (_, i) => (i === 150 ? 'ERROR: boom' : `line ${i % 3 === 0 ? 'same' : i}`)).join('\n')

function base(on: any, statuses: string[] = []) {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ct-token-saver__headroom_retrieve' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    if (e.text !== undefined) statuses.push(e.text)
    return { value: {} }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: noisy, stderr: '', interrupted: false },
  }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
}

test('headroom compresses Bash output and the pane counts it', async ($, on) => {
  base(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ct-token-saver__settings', headroom: 'aggressive' } as any)

  const ran = await $.tool.call({ tool: 'Bash', command: 'make' })
  const out = (ran.result as { stdout: string }).stdout
  expect(out.length).toBeLessThan(noisy.length)
  expect(out).toContain('ERROR: boom')
  expect(out).not.toContain('\x1b[')
  expect(out).toContain('id=hr1')

  const back = await $.tool.call({
    tool: 'mcp__ct-token-saver__headroom_retrieve',
    id: 'hr1',
    grep: 'boom',
  } as any)
  expect(String(back.result)).toContain('ERROR: boom')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Headroom · aggressive/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 outputs/ })).toBeDefined()
    await ui.press({ key: 'mode-safe' })
    expect(await ui.find({ type: 'Text', text: /Headroom · safe/ })).toBeDefined()
    await ui.press({ key: 'mode-aggressive' })
    await ui.unmount()
  }
})

test('caveman adds its prompt section at the chosen level and estimates savings', async ($, on) => {
  base(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ct-token-saver__settings', caveman: 'ultra' } as any)

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as any)
  const section = composed.sections.find(s => s.id === 'ct-token-saver:caveman')
  expect(section?.text).toContain('ULTRA')

  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
  } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /~300 saved/ })).toBeDefined()
  await ui.press({ key: 'level-off' })
  expect(await ui.find({ type: 'Text', text: /Caveman · off/ })).toBeDefined()
  await ui.unmount()

  const after = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as any)
  expect(after.sections.find(s => s.id === 'ct-token-saver:caveman')).toBeUndefined()
})

test('plain-text settings apply and attach the answer for the reply', async ($, on) => {
  base(on)
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => ({ text: e.text, context: e.context }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const r = await $.prompt.submit({ text: 'caveman lite' } as any)
  expect(String(r.context)).toContain('Caveman set to lite.')
  const h = await $.prompt.submit({ text: '!headroom aggressive' } as any)
  expect(String(h.context)).toContain('Headroom set to aggressive.')
  const t = await $.prompt.submit({ text: 'tokens saved' } as any)
  expect(String(t.context)).toContain('Saved ~0 tokens')
  const normal = await $.prompt.submit({ text: 'what does caveman mean?' } as any)
  expect(normal.text).toBe('what does caveman mean?')

  const tool = await $.tool.call({ tool: 'mcp__ct-token-saver__settings', caveman: 'ultra' } as any)
  expect(String(tool.result)).toBe('Caveman set to ultra.')
})

const files = Array.from({ length: 30 }, (_, i) => `/home/me/projects/app/src/components/widget${i}.tsx`)
const grepContent = files.flatMap((f, i) => [1, 2, 3].map(n => `${f}:${i * 10 + n}:  const value = useThing(${n})`)).join('\n')
const page = Array.from({ length: 200 }, (_, i) => (i === 100 ? 'Error: element not found' : `menu item ${i % 4}`)).join('\n')

test('headroom covers Grep, Glob and connector output, never Read', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Grep' }, (_: unknown, e: { output_mode?: string }) =>
    e.output_mode === 'content'
      ? { result: { mode: 'content', numFiles: 30, filenames: files, content: grepContent } }
      : { result: { mode: 'files_with_matches', numFiles: 30, filenames: files } },
  )
  on('tool.call', { tool: 'Glob' }, () => ({
    result: { durationMs: 1, numFiles: 30, filenames: files, truncated: false },
  }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: '/a', content: '   spaced   \n\n\n\n' + 'x\n'.repeat(400), numLines: 400, startLine: 1, totalLines: 400 } },
  }))
  on('tool.call', (_: unknown, e: { tool: string }) =>
    e.tool === 'mcp__browser__get_page_text'
      ? { result: { content: [{ type: 'text', text: page }] } }
      : { result: {} },
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ct-token-saver__settings', headroom: 'aggressive' } as any)

  const grep = await $.tool.call({ tool: 'Grep', pattern: 'useThing', output_mode: 'content' } as any)
  const content = (grep.result as { content: string }).content
  expect(content.length).toBeLessThan(grepContent.length)
  expect(content).toContain('/home/me/projects/app/src/components/widget7.tsx\n  71: ')

  const glob = await $.tool.call({ tool: 'Glob', pattern: '**/*.tsx' } as any)
  const names = (glob.result as { filenames: string[] }).filenames
  expect(names.length).toBe(1)
  expect(names[0]).toContain('/home/me/projects/app/src/components/: widget0.tsx, widget1.tsx')

  const web = await $.tool.call({ tool: 'mcp__browser__get_page_text' } as any)
  const text = (web.result as { content: { text: string }[] }).content[0]?.text ?? ''
  expect(text.length).toBeLessThan(page.length)
  expect(text).toContain('Error: element not found')
  expect(text).toContain('mcp__ct-token-saver__headroom_retrieve')

  const read = await $.tool.call({ tool: 'Read', file_path: '/a' } as any)
  expect((read.result as { file: { content: string } }).file.content.startsWith('   spaced   \n\n\n\n')).toBe(true)
})

test('prompt cache hit rate shows in the pane and status, and resets', async ($, on) => {
  const statuses: string[] = []
  base(on, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses[statuses.length - 1]).toContain('cache —')

  const turn = (read: number, written: number, uncached: number) =>
    $.turn.complete({
      answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer',
      usage: { input_tokens: uncached, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: written, model: 'm' },
    } as any)
  await turn(0, 900, 100)
  await turn(9000, 500, 500)

  // Session: 9000 read of 11000 input. Last turn: 9000 of 10000.
  expect(statuses[statuses.length - 1]).toContain('cache 82%')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Prompt cache · 82% hit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 turns · last turn 90%/ })).toBeDefined()
  await ui.press({ key: 'reset' })
  expect(await ui.find({ type: 'Text', text: /Prompt cache · — hit/ })).toBeDefined()
  await ui.unmount()
})
