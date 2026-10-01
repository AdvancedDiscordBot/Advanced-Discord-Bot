---
name: 🐛 Bug Report
about: Create a detailed report to help us improve and squash bugs
title: "[BUG] <short description of the bug>"
labels: bug, needs-triage
assignees: ""
---

<!--
  AI coding agents: before filling this in, read AGENTS.md.
  Do not file a speculative bug, and do not file a test-harness gap as a plugin bug
  without first reading docs/VERIFICATION.md#known-limitations-of-the-integration-check.
-->

## 📦 Which repository?

<!-- Pick exactly one. Plugin bugs go in the plugin's own repo, not here. -->

- [ ] `AdvancedDiscordBot/Advanced-Discord-Bot` — the platform core (loader, broker, dashboard host, HTTP API)
- [ ] `AdvancedDiscordBot/adb-plugin-<name>` — a plugin
- [ ] `AdvancedDiscordBot/registry` — marketplace entries in `plugins.json`

<!-- Plugin name (if a plugin): ______  |  Plugin version from plugin.json: ______ -->

---

## 🔢 Version

- ADB core version or commit:
- Node.js version (`node -v`):
- MongoDB version:

---

## 🧪 How was this tested?

- [ ] I ran it in a real Discord test server (describe the server and what you did)
- [ ] `npm test` in the plugin repo
- [ ] `npm run test:integration` in the core repo, with a disposable loopback MongoDB
- [ ] I only read the code — **not reproduced**

> Offline checks use a simulated Discord API with **known gaps**. If the stack
> trace ends in `scripts/check-plugin-runtime.js` rather than in your plugin, the
> failure may be a mock gap, not a product bug. Please paste the full underlying
> exception, not just the generic "An error occurred while processing your request."

---

## 🐛 Bug Description

<!-- A clear, concise description of what the bug is. -->

Example:

> `/purge 20` removes the 20 oldest messages in the channel instead of the 20 most
> recent, so recent spam is never deleted.

---

## 📍 Steps to Reproduce

<!-- Smallest reproduction you have. -->

1. Go to '...'
2. Run '...'
3. Observe '...'

---

## 🤔 Expected Behavior

> What should have happened instead?

---

## 📷 Actual Output / Logs

<!-- Paste the real log line or stack trace. Do not paraphrase. -->

```text
Paste logs, terminal output, or stack trace here (if any)
```

---

## 🔒 Confidentiality

- [ ] This report contains **no** tokens, client IDs, OAuth secrets, session secrets, connection strings, or personal data.
- [ ] This is **not** a security vulnerability. (If it is, do not file a public issue — see [SECURITY.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/SECURITY.md).)