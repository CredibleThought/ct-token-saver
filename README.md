# token-saver

Cuts token usage two ways and shows how much you've saved.

## Install

At the prompt of a Claude Code session:

```
/plugin install token-saver --marketplace CredibleThought/token-saver
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin marketplace add CredibleThought/token-saver
claude plugin install token-saver@token-saver
```

## What it does

- **Caveman** — adds a terse-reply instruction to the system prompt. Pick a level with `/caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off` or the buttons in the pane. Savings are an estimate: actual output tokens vs. what the reply would likely have cost (full = caveman's measured 65% cut; other levels estimated).
- **Headroom** — compresses Bash output before the model reads it. `/headroom safe` (default) strips ANSI codes, progress-bar redraws, trailing spaces, blank-line runs, repeated lines and minifies JSON. `/headroom aggressive` also drops the middle of very long output and most items of big JSON arrays, always keeping error/warning lines; the original is kept so the model can fetch it with the `headroom_retrieve` tool (retrieved tokens are subtracted from the savings).
- **Pane** — `/tokens-saved` opens it: session and all-time totals, level/mode pickers, recent compressions. The status line shows the running total too.

In apps where slash commands only list skills (such as the Claude desktop app), type the commands without the slash: `caveman ultra`, `headroom safe`, `tokens saved`, or ask in plain words ("set caveman to lite").

Your level, mode and all-time total persist across sessions.
