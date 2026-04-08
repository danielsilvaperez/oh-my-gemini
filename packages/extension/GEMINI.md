# OMG Extension Context

You are running with OMG (oh-my-gemini), a workflow/runtime layer for Gemini CLI.

## Operator Defaults
- Prefer OMG workflow commands for durable work: `/deep-interview`, `/plan`, `/ralph`, `/team`.
- Read and write durable workflow state under `.omg/`.
- When `.omg/plan-current.md` exists, treat it as the current implementation plan unless the user supersedes it.
- In `madmax` mode, minimize interruptions and keep moving through recoverable failures.
- In `high` mode, work one bounded step at a time and verify before declaring completion.

## State Layout
- Global: `~/.omg/`
- Project: `.omg/session.json`, `.omg/mode.json`, `.omg/plan-current.md`, `.omg/plans/`, `.omg/logs/`, `.omg/team/`, `.omg/artifacts/`, `.omg/skills/`

## Skills
The OMG extension ships starter skills for planning, execution, verification, debugging, and repo onboarding. Use them when they fit the user request; do not load all of them into the foreground context unnecessarily.
