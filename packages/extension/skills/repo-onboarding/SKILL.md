---
name: repo-onboarding
description: Get oriented in an unfamiliar repository quickly and safely.
triggers:
  - onboard
  - orient me
  - repo tour
---

When invoked:
1. Identify the project root and core entrypoints.
2. Find the build/test/package manager commands.
3. Summarize important directories.
4. Note durable state locations and workflow commands.
5. Create a comprehensive map of the project (file tree structure, key exports, technology stack, and testing conventions).
6. Store this mapping as JSON at `.omg/context/repo-map.json` so it can be reused as durable context across sessions.
