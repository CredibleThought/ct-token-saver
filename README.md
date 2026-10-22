# ct-token-saver

Cuts Claude's token usage two ways and shows how much you've saved.

## Install

At the prompt of a Claude Code session:

```
/plugin install ct-token-saver --marketplace CredibleThought/ct-token-saver
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin marketplace add CredibleThought/ct-token-saver
claude plugin install ct-token-saver@ct-token-saver
```

In the Claude desktop app: **Customize → Plugins → Add → Add marketplace**, enter `CredibleThought/ct-token-saver`, then install **ct-token-saver**.

## Commands

| Slash command | Typed (no slash) | Does |
| --- | --- | --- |
| `/ct-tokens` or `/ct-token-saver` | `tokens saved` | Shows the figures and opens the pane |
| `/ct-caveman <level>` | `caveman ultra` | Sets the reply level: `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra` |
| `/ct-headroom <mode>` | `headroom safe` | Sets output compression: `off`, `safe`, `aggressive` |

Asking in plain words ("set caveman to lite") works too. Typed forms are answered by the mod itself; slash forms cost one short reply.

## What it does

- **Caveman-style replies** add a terse-reply instruction to the system prompt at the level you pick. Savings are an estimate: actual output tokens against what the reply would likely have cost (`full` uses caveman's measured 65% cut; the other levels are estimates).
- **Headroom-style compression** shrinks Bash output before Claude reads it. `safe` (default) strips ANSI codes, progress-bar redraws, trailing spaces, blank-line runs and repeated lines, and minifies JSON. `aggressive` also drops the middle of very long output and most items of big JSON arrays, always keeping error and warning lines; the original is kept so Claude can fetch it with the `headroom_retrieve` tool, and those tokens are subtracted from the savings.
- **The pane** shows session and all-time totals, level and mode buttons, and recent compressions. The status line shows the running total. Where the app can't draw panes (cloud chats in the desktop app), use the commands above.

Your level, mode and all-time total persist across sessions.

## Credits

Independent plugin, not affiliated with either project it borrows ideas from:

- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee: the terse-reply style and its levels.
- [Headroom](https://github.com/headroomlabs-ai/headroom): context compression for LLM tool output. This plugin reimplements a small part of the idea in TypeScript; it does not use Headroom's code.

MIT licensed.
