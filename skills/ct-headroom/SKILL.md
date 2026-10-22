---
name: ct-headroom
description: "Set ct-token-saver Headroom-style tool-output compression: off, safe, aggressive."
argument-hint: "[mode]"
disable-model-invocation: true
---

Call the `mcp__ct-token-saver__settings` tool with `{"headroom": "$ARGUMENTS"}` (an empty string reports the current mode). Do not call any other tool. Reply with exactly the text the tool returns and nothing else.
