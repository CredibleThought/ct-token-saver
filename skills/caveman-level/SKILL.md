---
name: caveman-level
description: "Set the token-saver caveman reply level: off, lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra."
argument-hint: "[level]"
disable-model-invocation: true
---

Call the `mcp__token-saver__settings` tool with `{"caveman": "$ARGUMENTS"}` (an empty string reports the current level). Do not call any other tool. Reply with exactly the text the tool returns and nothing else.
