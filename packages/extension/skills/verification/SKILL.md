---
name: verification
description: Produce concrete evidence that a change works.
triggers:
  - verify
  - regression
  - prove it
---

When invoked:
1. Identify the smallest set of commands or checks that prove the claim.
2. Run or describe them clearly.
3. Distinguish passed, failed, and not-run checks.
4. Record any durable evidence paths under `.omg/`.
