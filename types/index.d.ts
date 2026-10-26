export type CavemanLevel =
  | 'off'
  | 'lite'
  | 'full'
  | 'ultra'
  | 'wenyan-lite'
  | 'wenyan-full'
  | 'wenyan-ultra'

export type HeadroomMode = 'off' | 'safe' | 'aggressive'

export type Savings = {
  cavemanTurns: number
  cavemanOutputTokens: number
  cavemanSaved: number
  headroomCalls: number
  headroomBefore: number
  headroomAfter: number
  headroomRetrieved: number
}

// Prompt-cache input tokens for the main thread, summed over the session,
// plus the last turn's hit rate.
export type Cache = {
  turns: number
  read: number
  written: number
  uncached: number
  lastPct: number | null
}

export type Compression = {
  id: string
  tool: string
  label: string
  before: number
  after: number
}

declare module 'claude-code' {
  interface PluginState {
    'ct-token-saver': {
      level: CavemanLevel
      headroom: HeadroomMode
      session: Savings
      lifetime: Savings
      recent: Compression[]
      cache: Cache
    }
  }
}
