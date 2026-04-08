# OMG (oh-my-gemini)

OMG is a workflow/runtime layer for Gemini CLI.

It aims to make day-to-day Gemini usage feel closer to the operator ergonomics of oh-my-codex / oh-my-claudecode:

- stronger session startup
- mode-driven defaults (`smart`, `madmax`, `high`)
- first-class workflow commands (`setup`, `doctor`, `deep-interview`, `plan`, `ralph`, `team`)
- persistent project state under `.omg/`
- tmux-backed team execution
- Gemini extension hooks, commands, and starter skills

## Repo layout

```text
packages/
  cli/        CLI entrypoint + command surface
  core/       orchestration/state/runtime engine
  extension/  Gemini extension bundle (hooks, commands, skills)
```

## Install

```bash
npm install
npm run build
```

## Setup

```bash
node dist/packages/cli/bin/omg.js setup
# or, after linking/installing the package:
omg setup
```

`omg setup` does the following:
- creates `~/.omg/` and project `.omg/` directories
- scaffolds project `.gemini/GEMINI.md` if missing
- mirrors the packaged extension into `~/.omg/extension`
- stages the extension bundle in `~/.omg/extension` and writes a helper script at `~/.omg/link-extension.sh`

## Doctor

```bash
omg doctor
```

Checks:
- Node.js
- npm
- Gemini CLI
- tmux
- extension assets present
- project/global state writable
- OMG config present

## First run

### Normal Gemini session

```bash
omg
omg --smart
omg --madmax
omg --madmax --high
```

Without a task argument, OMG initializes project state and launches Gemini interactively with OMG environment variables so the extension hooks can inject mode-aware context.

### One-shot task execution

```bash
omg "summarize this repo"
omg --madmax "ship the auth change"
omg --madmax --high "finish the approved implementation"
```

Behavior:
- `smart`: lightweight planning for non-trivial tasks, otherwise direct execution
- `madmax`: plans non-trivial tasks first, then executes autonomously
- `high`: uses the structured Ralph loop (`plan -> execute one step -> verify -> continue`)

### tmux-backed session launch

```bash
omg --tmux --madmax --high
```

Starts a detached tmux session running Gemini (or Ralph for task-driven high mode) and prints the attach command.

## Canonical workflow commands

```bash
omg deep-interview "clarify the auth change"
omg deep-interview --non-interactive "clarify the auth change"
omg plan "approve the safest implementation path"
omg ralph "carry the approved plan to completion"
omg team 3:executor "execute the approved plan in parallel"
omg team status <team-id>
omg team resume <team-id>
omg team shutdown <team-id>
```

Additional utility surfaces in v1:

```bash
omg hud --watch
omg explore --prompt "read-only repo question"
omg sparkshell "git status --short"
```

## State layout

### Global

```text
~/.omg/
  config.json
  extension/
  logs/
  sessions/
  skills/
  artifacts/
```

### Project

```text
.omg/
  session.json
  mode.json
  plan-current.md
  plan-current.json
  plans/
  logs/
  team/
  artifacts/
  skills/
```

## Ralph loop

`omg ralph` is a real stepwise loop:

1. Generate a structured plan.
2. Execute one bounded step at a time with Gemini headless mode.
3. Run step verification commands.
4. Persist iteration history to `.omg/artifacts/ralph-state.json` and `.omg/logs/ralph.jsonl`.
5. Continue, retry, or stop based on structured execution + verification state.

It does **not** rely on brittle string matching like “contains complete”.

## Team mode

`omg team` creates a durable tmux session and state under `.omg/team/<team-id>/`.

Current v1 behavior:
- worker 1 = primary delivery lane (writable)
- middle workers = support / analysis lanes
- final worker = verification lane
- each worker has `config.json`, `status.json`, `result.json` (on success), a summary/status trail, and a dedicated log file
- `status`, `resume`, and `shutdown` inspect or control the tmux session while preserving durable artifacts on disk

## Gemini extension bundle

The packaged extension includes:
- `gemini-extension.json`
- `hooks/hooks.json`
- `hooks/session-start.mjs`, `before-agent.mjs`, `after-agent.mjs`, `session-end.mjs`
- slash commands: `/deep-interview`, `/plan`, `/ralph`, `/team`
- starter skills: planning, execution, verification, debugging, repo-onboarding

## Notes / limitations

- OMG prefers extension/context-based behavior instead of forcing `GEMINI_SYSTEM_MD`, because Gemini’s system override is a full replacement of built-in firmware.
- Team mode is intentionally lane-based in v1 to avoid unsafe multi-writer conflicts in the same checkout.
- Extension hooks/commands depend on Gemini trusting the workspace and successfully loading the linked extension.
