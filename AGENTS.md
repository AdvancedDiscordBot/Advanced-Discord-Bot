# AGENTS.md — hard rules for AI agents in this repository

This file is written for an AI coding agent (Claude Code, Codex, Copilot, Cursor,
opencode, …) that is about to modify this repository. Read it completely before
writing any code. It is short on purpose — the detail lives in the linked docs.

---

## 1. Ask what they want to do — before anything else

After reading this file and getting a sense of the codebase, **ask the user which
of these they want.** Do not assume. Do not start work first and ask later. One
question, a handful of options, and wait for the answer.

Ask something like:

> I've read the repo. Before I start — what would you like to work on?
>
> 1. **Make a new plugin** — I'll clone `adb-plugin-template`, set up a new
>    `adb-plugin-*` repo, and scaffold the feature you describe.
> 2. **Improve an existing plugin** — I'll set up its repo locally, reproduce what
>    you're seeing, and test before changing anything.
> 3. **Fix a specific bug** — tell me the symptom and I'll reproduce it first and
>    file or work the issue in the repo that owns the code.
> 4. **Test or document the platform** — plugin tests, the integration check, or
>    docs accuracy.
> 5. **Work on the core runtime** — loader, isolation, broker, dashboard. Say so
>    explicitly; this is the exception, not the default.
>
> If you already know, tell me and I'll skip ahead.

Then adapt. The rules that follow apply to all five; only the destination
changes.

### What each answer means for where you work

| They picked | You work in | You must do first |
|---|---|---|
| 1 — new plugin | a **new** `adb-plugin-<name>` repo | ask for the feature, then `LOCAL-SETUP.md` §5 |
| 2 — existing plugin | that plugin's repo | reproduce the behaviour in a running bot first |
| 3 — a bug | whichever repo owns the code | reproduce it before editing |
| 4 — tests/docs | the repo that owns the subject | `npm test` first, to see the current state |
| 5 — core runtime | **this** repo, on `beta` | confirm they really mean the core |

If their answer does not fit these — for example "add a moderation command" — say
which repo that belongs in and confirm before touching anything. That single
question prevents most wasted work in this project.

### Then confirm the setup, whatever they picked

Before you write code, ask them to get a bot running locally
([`LOCAL-SETUP.md`](./LOCAL-SETUP.md)) with their own Discord application and
their own database. Then ask them to exercise the feature and tell you what
happened. Do not patch code you have not seen run.

---

## 2. First, decide what you are allowed to touch

This repository is the **platform core**. It is not a plugin.

| Task | Where the code goes |
|---|---|
| A user-facing bot feature | **Your own plugin repo**, e.g. `adb-plugin-<name>` |
| A new plugin from scratch | **Your own plugin repo**, copied from [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template) |
| Registry entry / version bump | `registry` repo, `plugins.json` |
| Plugin runtime, loader, broker, dashboard host | **This repo** — only when the task is explicitly about the platform |

### The one rule that matters most

> **Do not create, commit, or open a PR against `Advanced-Discord-Bot` for a
> feature, bug fix, or improvement that belongs to a plugin.**

Concretely, **never**:

- run `mkdir plugins/adb-plugin-my-thing` in this repo and commit it;
- add a `commands/` or `models/` folder for a user-facing feature to this repo;
- open a PR here titled `feat: add /yourcommand`;
- change `plugins/` other than `plugins/administration` (the dashboard host);
- edit `package.json` dependencies to add a local `file:../…` plugin path and
  commit it;
- `git reset --hard`, rebase, force-push, or otherwise rewrite this repo's history.

The only in-repo plugin is `plugins/administration` (the dashboard itself).
Everything else that users interact with is a separate `adb-plugin-*` repository.
Older versions of `CONTRIBUTING.md` and `CREATE-PLUGIN.md` told contributors to
make plugins inside this repo — **that advice was wrong and has been removed.**
If you were told to do that, stop and re-read this file.

If the user asks for a feature and you cannot tell whether it is a plugin or a
core change, **ask before writing code**. Guessing wrong here costs the user a
migration.

---

## 3. Before you write any code, make the user set the bot up locally

**Never propose a patch to a plugin you have not actually executed.** Do not
guess at behaviour. Ask the user to do this first, in this order, and wait for
confirmation:

1. The user creates **their own** Discord application and bot (they must never
   share or borrow the maintainer's token, client id, or OAuth secret).
2. The user creates **their own** throwaway MongoDB (Docker is fine).
3. The user clones this repo and **this repo only** — untouched, on `main` or
   `beta` — and gets `npm start` working against their own guild.
4. The user installs the plugin under test into that bot checkout
   (`npm install --no-save ../adb-plugin-<name>`) so the edited source is what runs.
5. The user runs the bot and exercises the feature in a real test server.

Then — and only then — ask the user:

> "The bot is set up. Can you now run the plugin's tests and try
> `<feature>` so we can see the real behaviour before I change anything?"

Full, copy-pasteable instructions: **[LOCAL-SETUP.md](./LOCAL-SETUP.md)**.

---

## 4. Read the real contract, not your assumptions

Before editing a plugin, read these in the plugin repo:

- `README.md` — the plugin's own contract, including what it declares
  (`manifestVersion`, `isolation`, `capabilities`, `permissions`, `engines`).
- `plugin.json` — the actual declared manifest. This is what the runtime enforces.
- `test/local-harness.js` and `test/mock-ctx.js` — the existing tests. Run them
  first; they pass today.
- [`CREATE-PLUGIN.md`](./CREATE-PLUGIN.md) and
  [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template)
  for the plugin API.

Do not assume an API exists because it exists in discord.js. Plugins run under
**two** load modes and both must keep working:

- **isolated** (`isolation: true`, default) — a `worker_thread`; `ctx.client` is
  `null`, `ctx.discord` exists, Discord data arrives as serialized plain values;
- **direct** (`isolation: false`) — main process; `ctx.client` exists and
  `ctx.discord` does not.

Anything you write must work in **both** modes, or it must fail loudly and
readably in the mode it does not support.

---

## 5. Secrets and safety

- Never commit `.env`, tokens, client ids, OAuth secrets, session secrets, or
  MongoDB connection strings. `.env` is gitignored; leave it that way.
- Never run the bot against production infrastructure, a production MongoDB, or a
  shared Discord application. If you need a database, use a disposable one whose
  name starts with `adb_verify_` on loopback.
- Never run a second gateway process using the maintainer's bot token.
- Do not run `docker compose down -v` or `docker rm -v` anywhere except the
  explicitly disposable verification container.

---

## 6. Verify before you claim anything

```bash
# in the plugin repo
npm install && npm test

# in a bot checkout, with the plugin installed from source
npm test
npm run test:integration        # needs a disposable loopback MongoDB; see docs/VERIFICATION.md
```

Rules:

- If you did not run it, do not describe the result. Say what you ran.
- Quote real output. Never invent passing tests.
- A plugin's own harness passing is **not** proof it works in the bot. The bot's
  integration check plus a real test guild is the evidence that counts.
- Known limitation of the integration check's Discord mock:
  [`docs/VERIFICATION.md`](./docs/VERIFICATION.md#known-limitations-of-the-integration-check).
  If a plugin fails there with a confusing "An error occurred while processing
  your request", check that section before you "fix" the plugin — the failure is
  often in the mock, not the plugin.

---

## 7. Reporting bugs

Report a bug when you can reproduce it and you have evidence. One issue per
bug. Use the `bug` label. Include:

1. **which repo** (`adb-plugin-<name>` or `Advanced-Discord-Bot`);
2. the exact version/commit;
3. the smallest reproduction you can manage;
4. the **actual** output (log line or stack trace), not a paraphrase;
5. what you expected instead.

Do not file speculative bugs. Do not file "this is untested" as a bug — file it
against the gap in coverage with the specific untested path named.

---

## 8. Pull requests

- One PR = one change. No drive-by reformatting.
- Branch names: `fix/<short>`, `feat/<short>`, `docs/<short>`, `chore/<short>`.
- Conventional Commit subjects, e.g. `fix(purge): delete the newest N messages`.
- Say in the PR body: what changed, why, **how you tested it**, and what you
  could not test.
- Never push to `main` in the plugin repos without asking.
- In the core repo, `main` is release-only and releases are **tags**. Feature
  work belongs on `beta`.

---

## 9. When you are unsure

Ask. Specifically, ask when:

- it is ambiguous whether a change belongs in core or in a plugin;
- you cannot reproduce a bug but were asked to fix it;
- a fix would require changing the plugin API, the manifest format, or the
  capability model;
- you need a Discord token, a database, or network access you do not have.

Reference: [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`LOCAL-SETUP.md`](./LOCAL-SETUP.md)
· [`docs/VERIFICATION.md`](./docs/VERIFICATION.md) · [`SECURITY.md`](./SECURITY.md)