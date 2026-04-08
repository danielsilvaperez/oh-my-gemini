---
name: debugging
description: Isolate failures, identify likely root causes, and propose the next fix.
triggers:
  - debug
  - failing
  - broken
---

When invoked:
1. Reproduce the issue.
2. Gather the exact error/output.
3. Identify likely root causes.
4. Suggest the smallest high-confidence next fix.
5. Preserve notes in `.omg/artifacts/` if useful.
