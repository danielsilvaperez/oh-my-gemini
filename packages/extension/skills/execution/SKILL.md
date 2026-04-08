---
name: execution
description: Execute an approved plan in bounded steps while keeping `.omg/` state current.
triggers:
  - execute
  - implement
  - carry it through
---

When invoked:
1. Find the current plan in `.omg/plan-current.md`.
2. Pick exactly one bounded step.
3. Execute it.
4. Verify it.
5. Record the result under `.omg/logs/` or `.omg/artifacts/`.
