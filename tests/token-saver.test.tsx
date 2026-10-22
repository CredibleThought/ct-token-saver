import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'token-saver',
  component: 'Pane',
  requestId: 'token-saver',
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

function base(on: any) {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__token-saver__headroom_retrieve' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: {} }))
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
  await $.command.run({ command: 'headroom', args: 'aggressive' } as any)

  const ran = await $.tool.call({ tool: 'Bash', command: 'make' })
  const out = (ran.result as { stdout: string }).stdout
  expect(out.length).toBeLessThan(noisy.length)
  expect(out).toContain('ERROR: boom')
  expect(out).not.toContain('\x1b[')
  expect(out).toContain('id=hr1')

  const back = await $.tool.call({
    tool: 'mcp__token-saver__headroom_retrieve',
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
  await $.command.run({ command: 'caveman', args: 'ultra' } as any)

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as any)
  const section = composed.sections.find(s => s.id === 'token-saver:caveman')
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
  expect(after.sections.find(s => s.id === 'token-saver:caveman')).toBeUndefined()
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

  const tool = await $.tool.call({ tool: 'mcp__token-saver__settings', caveman: 'ultra' } as any)
  expect(String(tool.result)).toBe('Caveman set to ultra.')
})
