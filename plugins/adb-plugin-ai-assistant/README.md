# adb-plugin-ai-assistant

AI replies in a configured channel with a **per-user cooldown** so one member cannot exhaust the guild's shared Gemini quota (issue #42).

## Settings (dashboard)

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | Master switch |
| `aiChannel` | none | Channel the assistant listens in |
| `userCooldownSeconds` | `12` | Per user, per guild. `0` disables. Clamped to 0-3600 |
| `cooldownNoticeMode` | `notice` | `notice` = one "please wait" reply per window, `silent` = ignore |

The cooldown sits under any guild-level rate limit as a second layer. State is in memory (resets on restart) and bounded to 10,000 tracked users.

## Known limits

- Discord only allows ephemeral replies to interactions, not plain messages, so the wait notice is a normal channel message (sent at most once per cooldown window).
- Core declares `ai:gemini-proxy` but has no RPC for it yet; `index.js` uses `ctx.ai.generate` when present and logs a warning otherwise.
