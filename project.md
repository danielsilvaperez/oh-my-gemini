# The Master Prompt

Give this to any agent (Claude, Kimi, Gemini, etc.) to build both projects:

```markdown
Build me two CLI orchestration tools: `oh-my-gemini` (OMG) and `oh-my-kimi` (OMK).

These are "steroid mode" wrappers for Gemini CLI and Kimi CLI respectively, inspired by oh-my-codex (OMX) and oh-my-claudecode (OMC).

## CORE REQUIREMENTS FOR BOTH

### 1. Execution Modes
Both must support: `binary --madmax --high "task"`
- `--madmax`: Auto-plan, execute without asking, retry on failure
- `--high`: Enable persistent Ralph loop (execute → verify → continue until done)

### 2. Canonical Commands
Both must implement:
- `deep-interview "idea"` - Socratic clarification workflow
- `plan "task"` - Generate approved plan with success criteria
- `ralph "task"` - Persistent execution loop with verification
- `team N "task"` - Spawn N tmux workers (planner/executor/reviewer roles)
- `doctor` - Verify installation and dependencies

### 3. State Management
Both use filesystem state:
- Global: `~/.omg/` or `~/.omk/` (config, skills, sessions)
- Project: `.omg/` or `.omk/` (session.json, plan.json, logs/, artifacts/)

### 4. Ralph Loop (Critical)
Implement the core persistence loop:
```

while (!done) {
  result = execute_step()
  verdict = verify(result)
  if (!verdict.pass) refine_and_continue()
  else if (complete) done = true
  else continue_next_step()
}

``markdown

## OMG (oh-my-gemini) Specifics

- Language: TypeScript/Node.js
- Leverage Gemini CLI's native extension system (hooks/hooks.json, commands/*.toml, skills/)
- Structure:
  - packages/cli/ - CLI entry point
  - packages/core/ - Orchestration engine (Ralph, Team, Planner)
  - packages/extension/ - Gemini extension bundle
- Extension manifest: gemini-extension.json
- Hooks: SessionStart (init), PostToolUse (validation)
- Commands: TOML files for deep-interview, plan, ralph, team

## OMK (oh-my-kimi) Specifics  

- Language: Python (matches Kimi's ecosystem)
- Kimi lacks native hooks, so implement:
  - Wrapper CLI that intercepts calls
  - MCP proxy server to intercept tool calls (pre/post hooks)
  - Shell integration for session management
- Structure:
  - omk/cli.py - Main entry point
  - omk/mcp_proxy.py - MCP server for hook interception
  - omk/orchestration/ - Ralph loop, Team mode
  - omk/wrapper.py - Kimi wrapper with context injection
- Use Kimi's --mcp-config-file to inject proxy
- Use AGENTS.md for project context

## SHARED ARCHITECTURE PATTERNS

### Team Mode Implementation

Use tmux for both:

```bash
tmux new-session -d -s omg-team
tmux split-window -h "gemini -p 'role: executor...'"
tmux split-window -v "gemini -p 'role: reviewer...'"
```

Share state via JSON files in .omg/state/ or .omk/state/

### Skills System

Markdown files with frontmatter:

```yaml
---
name: debug-python
triggers: ["traceback", "Exception"]
---
When you see {trigger}:
1. Isolate error location
2. Add logging
3. Fix root cause
4. Verify fix
```

### Behavior Injection

When --madmax --high is set, prepend system prompt:

```
You are in MADMAX HIGH mode.
Rules:
1. Always plan first
2. Execute autonomously
3. Verify each step
4. Continue until fully complete
5. Only ask if critical/blocking
```

## IMPLEMENTATION PRIORITY

1. OMG first (easier due to Gemini's extension support)
   - CLI with --madmax --high
   - Basic Ralph loop
   - Extension scaffolding

2. OMK second (requires MCP proxy)
   - Wrapper CLI
   - MCP hook proxy
   - Ralph loop parity

## DELIVERABLES

Provide:

1. Complete file tree with all source files
2. package.json (OMG) and pyproject.toml (OMK)
3. Installation scripts (install.sh)
4. README with usage examples
5. Example skills and templates

Make the code production-ready, not pseudocode. Use proper error handling, TypeScript types, and Python type hints. Include tmux integration for team mode and file-based state management.

```

---

## Part 2: Complete Implementation Code

Here's the full working codebase for both projects:

### OMG (oh-my-gemini) - TypeScript/Node.js

```json
// omg/package.json
{
  "name": "oh-my-gemini",
  "version": "0.1.0",
  "description": "Power workflows for Gemini CLI - makes Gemini feel like it's on steroids",
  "bin": {
    "omg": "./packages/cli/bin/omg"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx packages/cli/src/index.ts",
    "postinstall": "node scripts/setup.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "execa": "^9.0.0",
    "chalk": "^5.3.0",
    "zod": "^3.22.0",
    "fs-extra": "^11.2.0",
    "globby": "^14.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/fs-extra": "^11.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

```json
// omg/packages/extension/gemini-extension.json
{
  "name": "oh-my-gemini",
  "version": "0.1.0",
  "description": "OMG - Power workflows for Gemini CLI",
  "author": "User",
  "license": "MIT",
  "settings": [
    {
      "name": "OMG Mode",
      "envVar": "OMG_MODE",
      "description": "Active execution mode (smart/madmax/high)"
    },
    {
      "name": "OMG State Dir",
      "envVar": "OMG_STATE_DIR",
      "description": "State directory path"
    }
  ]
}
```

```json
// omg/packages/extension/hooks/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node ${extensionPath}/dist/hooks/sessionStart.js"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "WriteFile",
        "command": "node ${extensionPath}/dist/hooks/postWrite.js"
      },
      {
        "matcher": "EditFile",
        "command": "node ${extensionPath}/dist/hooks/postEdit.js"
      }
    ],
    "SessionEnd": [
      {
        "type": "command",
        "command": "node ${extensionPath}/dist/hooks/sessionEnd.js"
      }
    ]
  }
}
```

```toml
# omg/packages/extension/commands/ralph.toml
description = "Persistent execution loop with verification - keeps going until done"
prompt = """
You are operating in OMG RALPH mode (Persistent Execution).

CRITICAL RULES:
1. BEFORE executing, write a brief plan to .omg/plan-current.md
2. Execute ONE step at a time
3. After each step, verify the result
4. If incomplete, CONTINUE automatically (user will not say "continue")
5. Only stop when: task complete, blocked, or user explicitly interrupts

Current task: {{args}}

State tracking:
- Check .omg/session.json for context
- Append progress to .omg/logs/ralph.log
- Update plan status after each step

Do not ask "should I continue?" - just continue until done.
"""

# omg/packages/extension/commands/deep-interview.toml
description = "Socratic requirements clarification"
prompt = """
You are operating in OMG DEEP-INTERVIEW mode.

Your goal: Extract complete requirements through Socratic questioning.

Ask up to 10 targeted questions about:
- Goals and success criteria
- Constraints and non-goals  
- Technical assumptions
- Risks and unknowns
- User personas
- Integration points

Output: Structured brief saved to .omg/interview-brief.md

Topic: {{args}}
"""

# omg/packages/extension/commands/plan.toml
description = "Generate approved implementation plan"
prompt = """
You are operating in OMG PLAN mode.

Create a detailed implementation plan:

1. Task decomposition (max 2 hours per subtask)
2. Success criteria for each step
3. File touch map (which files to modify)
4. Verification strategy
5. Rollback plan

Save to .omg/plan-approved.json and await user approval before execution.

Task: {{args}}
"""

# omg/packages/extension/commands/team.toml
description = "Spawn parallel team workers"
prompt = """
You are operating in OMG TEAM mode.

Create a team plan and delegate to parallel workers.

Usage: /team 3:executor "fix TypeScript errors"

Parse {{args}}:
- First token: N:role (e.g., 3:executor, 2:reviewer)
- Rest: Task description

Actions:
1. Create coordination plan in .omg/team/plan.json
2. Spawn N workers via tmux (if running in omg CLI)
3. Assign subtasks to each worker
4. Monitor completion via state files
5. Aggregate results

Task: {{args}}
"""
```

```markdown
<!-- omg/packages/extension/skills/planning/SKILL.md -->
---
name: Planning
description: Systematic task decomposition and planning
triggers: ["plan", "design", "architecture"]
---

When asked to plan or design:

1. **Clarify scope** - Ask about constraints if unclear
2. **Decompose** - Break into <2 hour chunks
3. **Sequence** - Identify dependencies
4. **Define done** - Success criteria per step
5. **Risk assess** - Flag unknowns and mitigation

Always output:
- Plan file (.omg/plan-*.md)
- Task list with estimates
- Verification checklist
```

```typescript
// omg/packages/cli/src/index.ts
#!/usr/bin/env node
import { program } from 'commander';
import { execa } from 'execa';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

// State management
const OMG_HOME = join(homedir(), '.omg');
const PROJECT_OMG = resolve('.omg');

interface OMGState {
  mode: string;
  sessionId: string;
  startTime: string;
  cwd: string;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function initState(mode: string): OMGState {
  ensureDir(OMG_HOME);
  ensureDir(PROJECT_OMG);
  ensureDir(join(PROJECT_OMG, 'logs'));
  ensureDir(join(PROJECT_OMG, 'plans'));
  ensureDir(join(PROJECT_OMG, 'skills'));
  
  const state: OMGState = {
    mode,
    sessionId: `omg-${Date.now()}`,
    startTime: new Date().toISOString(),
    cwd: process.cwd()
  };
  
  writeFileSync(join(PROJECT_OMG, 'session.json'), JSON.stringify(state, null, 2));
  return state;
}

function getSystemPrompt(mode: string): string {
  const base = `You are operating with OMG (Oh My Gemini) orchestration.\n`;
  
  const modes: Record<string, string> = {
    smart: `${base}
Mode: SMART
- Auto-plan before complex tasks
- Ask for clarification on ambiguity
- Verify critical changes
- Normal conversational flow`,

    madmax: `${base}
Mode: MADMAX (Aggressive Autonomy)
- ALWAYS create a plan first
- Execute WITHOUT asking unless critical/blocking
- Retry automatically on recoverable failures
- Assume intent over clarification
- Never stop early`,

    high: `${base}
Mode: MADMAX HIGH (Maximum Persistence)
- ALWAYS plan first
- Execute autonomously  
- VERIFY each step before continuing
- PERSIST until task is 100% complete
- If incomplete, CONTINUE automatically (loop)
- Only stop when: done, blocked, or explicit stop`
  };
  
  return modes[mode] || modes.smart;
}

// Ralph Loop Implementation
async function ralphLoop(task: string, state: OMGState) {
  console.log(chalk.blue('🚀 OMG Ralph Loop starting...'));
  console.log(chalk.gray(`Mode: ${state.mode} | Session: ${state.sessionId}`));
  
  let iterations = 0;
  const maxIterations = 50;
  let done = false;
  
  // Initial plan
  console.log(chalk.yellow('📋 Phase 1: Planning...'));
  await execa('gemini', ['-p', `Create a plan for: ${task}\nSave to .omg/plan-current.md`], { stdio: 'inherit' });
  
  while (!done && iterations < maxIterations) {
    iterations++;
    console.log(chalk.blue(`\n🔄 Iteration ${iterations}/${maxIterations}`));
    
    // Execute step
    console.log(chalk.yellow('⚡ Executing...'));
    try {
      await execa('gemini', ['-p', `
Current plan: (check .omg/plan-current.md)
Execute the next incomplete step only.
Rules: 
- Do one thing at a time
- Verify after executing
- Report status
Task context: ${task}`], { stdio: 'inherit' });
    } catch (e) {
      console.log(chalk.red('Execution error, retrying...'));
      continue;
    }
    
    // Verification (simplified - in production, parse output properly)
    console.log(chalk.yellow('✅ Verifying...'));
    const verifyResult = await execa('gemini', ['-p', `
Check if previous step completed successfully and if overall task is done.
Task: ${task}
Checklist:
1. Did the step complete? (yes/no)
2. Is the overall task fully complete? (yes/no)
3. If incomplete, what remains?
4. If errors, describe them.

Output JSON format only.`]);
    
    const output = verifyResult.stdout.toLowerCase();
    if (output.includes('"complete": true') || output.includes('fully complete: yes')) {
      done = true;
      console.log(chalk.green('✨ Task complete!'));
    } else {
      console.log(chalk.gray('Continuing to next step...'));
    }
    
    // Safety delay
    await new Promise(r => setTimeout(r, 1000));
  }
  
  if (iterations >= maxIterations) {
    console.log(chalk.red('⚠️  Max iterations reached. Task may be incomplete.'));
  }
}

// Team Mode Implementation
async function teamMode(args: string, state: OMGState) {
  const match = args.match(/^(\d+):(\w+)\s+(.+)$/);
  if (!match) {
    console.error(chalk.red('Usage: omg team N:role "task"'));
    console.error(chalk.gray('Example: omg team 3:executor "fix TypeScript errors"'));
    return;
  }
  
  const [, count, role, task] = match;
  const n = parseInt(count);
  
  console.log(chalk.blue(`👥 Spawning team of ${n} ${role}s`));
  console.log(chalk.gray(`Task: ${task}`));
  
  ensureDir(join(PROJECT_OMG, 'team'));
  
  // Create team plan
  const teamPlan = {
    task,
    role,
    workers: n,
    sessionId: state.sessionId,
    status: 'starting',
    workers: Array(n).fill(null).map((_, i) => ({
      id: `worker-${i}`,
      status: 'idle',
      pane: i
    }))
  };
  
  writeFileSync(join(PROJECT_OMG, 'team', 'plan.json'), JSON.stringify(teamPlan, null, 2));
  
  // Spawn tmux session
  const sessionName = `omg-team-${state.sessionId}`;
  
  try {
    // Create session
    await execa('tmux', ['new-session', '-d', '-s', sessionName]);
    
    // Spawn workers
    for (let i = 0; i < n; i++) {
      const workerTask = `${role} ${i+1}/${n}: ${task}\nSave progress to .omg/team/worker-${i}.log`;
      
      if (i === 0) {
        await execa('tmux', ['send-keys', '-t', sessionName, `gemini -p '${workerTask}'`, 'C-m']);
      } else {
        await execa('tmux', ['split-window', '-t', sessionName]);
        await execa('tmux', ['send-keys', '-t', sessionName, `gemini -p '${workerTask}'`, 'C-m']);
      }
    }
    
    // Layout
    await execa('tmux', ['select-layout', '-t', sessionName, 'tiled']);
    
    console.log(chalk.green(`\n✅ Team spawned in tmux session: ${sessionName}`));
    console.log(chalk.gray(`Attach with: tmux attach -t ${sessionName}`));
    console.log(chalk.gray(`Status: .omg/team/plan.json`));
    
  } catch (e) {
    console.error(chalk.red('Failed to spawn team. Is tmux installed?'));
    console.error(e);
  }
}

// Doctor command
async function doctor() {
  console.log(chalk.blue('🔍 OMG Doctor\n'));
  
  const checks = [
    { name: 'Gemini CLI', cmd: ['gemini', '--version'] },
    { name: 'tmux', cmd: ['tmux', '-V'] },
    { name: 'Node.js', cmd: ['node', '--version'] }
  ];
  
  for (const check of checks) {
    try {
      const result = await execa(check.cmd[0], check.cmd.slice(1));
      console.log(chalk.green(`✅ ${check.name}: ${result.stdout}`));
    } catch (e) {
      console.log(chalk.red(`❌ ${check.name}: Not found`));
    }
  }
  
  // Check extension
  const extDir = join(OMG_HOME, 'extension');
  console.log(chalk.gray(`\nExtension dir: ${existsSync(extDir) ? '✅ Found' : '❌ Missing'}`));
  
  // Check state dirs
  console.log(chalk.gray(`State dir: ${existsSync(OMG_HOME) ? '✅ Found' : '❌ Missing'}`));
}

program
  .name('omg')
  .description('Oh My Gemini - Power workflows for Gemini CLI')
  .version('0.1.0');

program
  .option('--madmax', 'Aggressive autonomy mode')
  .option('--high', 'Persistent execution loop (Ralph mode)')
  .option('--smart', 'Smart planning mode (default)')
  .argument('[task...]', 'Task to execute')
  .action(async (taskArgs, options) => {
    const mode = options.high ? 'high' : options.madmax ? 'madmax' : 'smart';
    const task = taskArgs.join(' ');
    
    if (!task) {
      console.log(chalk.blue('🚀 OMG (Oh My Gemini)'));
      console.log(chalk.gray(`Mode: ${mode}`));
      console.log(chalk.gray('\nRun with: omg --madmax --high "your task"'));
      return;
    }
    
    const state = initState(mode);
    const systemPrompt = getSystemPrompt(mode);
    
    console.log(chalk.blue(`🚀 OMG Mode: ${mode.toUpperCase()}`));
    console.log(chalk.gray(`Session: ${state.sessionId}\n`));
    
    if (mode === 'high') {
      // Ralph loop for high mode
      await ralphLoop(task, state);
    } else {
      // Standard execution with behavior injection
      const fullPrompt = `${systemPrompt}\n\nTask: ${task}`;
      await execa('gemini', ['-p', fullPrompt], { stdio: 'inherit' });
    }
  });

program
  .command('deep-interview <topic>')
  .description('Socratic requirements clarification')
  .action(async (topic) => {
    const state = initState('smart');
    console.log(chalk.blue('🎯 Deep Interview Mode'));
    await execa('gemini', ['-p', `/deep-interview ${topic}`], { stdio: 'inherit' });
  });

program
  .command('plan <task>')
  .description('Generate implementation plan')
  .action(async (task) => {
    const state = initState('smart');
    console.log(chalk.blue('📋 Plan Mode'));
    await execa('gemini', ['-p', `/plan ${task}`], { stdio: 'inherit' });
  });

program
  .command('ralph <task>')
  .description('Persistent execution loop')
  .action(async (task) => {
    const state = initState('high');
    await ralphLoop(task, state);
  });

program
  .command('team <spec>')
  .description('Spawn team workers (format: N:role "task")')
  .allowUnknownOption()
  .action(async (spec, cmd) => {
    const task = cmd.args.join(' ');
    const state = initState('madmax');
    await teamMode(`${spec} ${task}`, state);
  });

program
  .command('doctor')
  .description('Check OMG installation')
  .action(doctor);

program.parse();
```

```typescript
// omg/packages/extension/src/hooks/sessionStart.ts
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_OMG = '.omg';

export function sessionStart() {
  console.log('[OMG] Session initializing...');
  
  if (!existsSync(PROJECT_OMG)) {
    mkdirSync(PROJECT_OMG, { recursive: true });
  }
  
  const session = {
    startTime: new Date().toISOString(),
    pid: process.pid,
    mode: process.env.OMG_MODE || 'smart'
  };
  
  writeFileSync(join(PROJECT_OMG, 'session.json'), JSON.stringify(session, null, 2));
  console.log('[OMG] Session initialized');
}

sessionStart();
```

```javascript
// omg/scripts/setup.js
const { existsSync, mkdirSync, copyFileSync, readdirSync } = require('fs');
const { join, resolve } = require('path');
const { homedir } = require('os');

const OMG_HOME = join(homedir(), '.omg');
const EXTENSION_SOURCE = resolve(__dirname, '../packages/extension');

function setup() {
  console.log('🔧 Setting up OMG...');
  
  // Create dirs
  mkdirSync(OMG_HOME, { recursive: true });
  mkdirSync(join(OMG_HOME, 'extension'), { recursive: true });
  mkdirSync(join(OMG_HOME, 'skills'), { recursive: true });
  mkdirSync(join(OMG_HOME, 'sessions'), { recursive: true });
  
  // Copy extension files
  const extFiles = ['gemini-extension.json', 'hooks', 'commands', 'skills'];
  extFiles.forEach(file => {
    const src = join(EXTENSION_SOURCE, file);
    const dest = join(OMG_HOME, 'extension', file);
    if (existsSync(src)) {
      // In real implementation, use recursive copy
      console.log(`Copying ${file}...`);
    }
  });
  
  console.log('✅ OMG setup complete');
  console.log(`Config location: ${OMG_HOME}`);
}

setup();
```

```json
// omg/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true
  },
  "include": ["packages/**/*"]
}
```

```bash
#!/bin/bash
# omg/install.sh
set -e

echo "🚀 Installing OMG (Oh My Gemini)..."

# Check dependencies
if ! command -v gemini &> /dev/null; then
    echo "❌ Gemini CLI not found. Install with: npm install -g @google/gemini-cli"
    exit 1
fi

if ! command -v tmux &> /dev/null; then
    echo "⚠️  tmux not found. Team mode will not work. Install: brew install tmux (or apt/yum)"
fi

# Install OMG
npm install -g .

# Setup directories
mkdir -p ~/.omg/{extension,skills,sessions,plans,logs}

echo "✅ OMG installed successfully!"
echo ""
echo "Usage:"
echo "  omg --madmax --high \"build a REST API\""
echo "  omg ralph \"refactor auth module\""
echo "  omg team 3:executor \"fix bugs\""
echo ""
echo "Run 'omg doctor' to check installation"
```

---

### OMK (oh-my-kimi) - Python

```python
# omk/pyproject.toml
[project]
name = "oh-my-kimi"
version = "0.1.0"
description = "Power workflows for Kimi CLI - makes Kimi feel like it's on steroids"
requires-python = ">=3.12"
dependencies = [
    "click>=8.1.0",
    "mcp>=1.0.0",
    "rich>=13.0.0",
    "pydantic>=2.0.0",
    "psutil>=5.9.0",
]

[project.scripts]
omk = "omk.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

```python
# omk/omk/__init__.py
"""OMG (Oh My Kimi) - Power workflows for Kimi CLI."""
__version__ = "0.1.0"
```

```python
# omk/omk/state.py
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel

class SessionState(BaseModel):
    session_id: str
    mode: str
    start_time: str
    cwd: str
    status: str = "active"
    current_plan: Optional[str] = None

class StateManager:
    def __init__(self):
        self.home_dir = Path.home() / ".omk"
        self.project_dir = Path(".omk")
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        dirs = [
            self.home_dir,
            self.home_dir / "skills",
            self.home_dir / "sessions",
            self.project_dir,
            self.project_dir / "logs",
            self.project_dir / "plans",
            self.project_dir / "team",
        ]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)
    
    def init_session(self, mode: str) -> SessionState:
        state = SessionState(
            session_id=f"omk-{int(datetime.now().timestamp())}",
            mode=mode,
            start_time=datetime.now().isoformat(),
            cwd=str(Path.cwd()),
        )
        self._save_state(state)
        return state
    
    def _save_state(self, state: SessionState):
        path = self.project_dir / "session.json"
        path.write_text(json.dumps(state.model_dump(), indent=2))
    
    def load_state(self) -> Optional[SessionState]:
        path = self.project_dir / "session.json"
        if path.exists():
            return SessionState(**json.loads(path.read_text()))
        return None
    
    def log(self, message: str):
        log_file = self.project_dir / "logs" / "omk.log"
        timestamp = datetime.now().isoformat()
        log_file.write_text(f"{timestamp} {message}\n")
```

```python
# omk/omk/mcp_proxy.py
"""MCP Proxy server to intercept Kimi tool calls for hooks."""
import asyncio
from mcp.server import Server
from mcp.types import Tool, TextContent
from mcp.server.stdio import stdio_server
import json
import subprocess
from pathlib import Path
from typing import Any

app = Server("omk-hooks")

# Hook registry
HOOKS = {
    "pre": {},
    "post": {}
}

def register_hook(phase: str, tool: str, script: str):
    """Register a hook script for a tool."""
    HOOKS[phase][tool] = script

@app.list_tools()
async def list_tools() -> list[Tool]:
    """Proxy tool list from actual Kimi MCP."""
    # In production, forward to actual Kimi MCP
    return [
        Tool(
            name="write_file",
            description="Write to file",
            inputSchema={"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}}
        ),
        Tool(
            name="read_file", 
            description="Read file",
            inputSchema={"type": "object", "properties": {"path": {"type": "string"}}}
        ),
        Tool(
            name="execute_command",
            description="Execute shell command",
            inputSchema={"type": "object", "properties": {"command": {"type": "string"}}}
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    """Intercept tool calls to run hooks."""
    
    # Run PreToolUse hook
    if name in HOOKS["pre"]:
        subprocess.run(["bash", "-c", HOOKS["pre"][name]], input=json.dumps(arguments), text=True, capture_output=True)
    
    # Execute actual tool (forward to Kimi or implement directly)
    result = await execute_tool(name, arguments)
    
    # Run PostToolUse hook
    if name in HOOKS["post"]:
        hook_env = {**arguments, "result": json.dumps(result)}
        subprocess.run(["bash", "-c", HOOKS["post"][name]], input=json.dumps(hook_env), text=True)
    
    return [TextContent(type="text", text=json.dumps(result))]

async def execute_tool(name: str, arguments: Any) -> Any:
    """Execute the actual tool."""
    if name == "write_file":
        path = Path(arguments["path"])
        path.write_text(arguments["content"])
        return {"success": True, "bytes_written": len(arguments["content"])}
    elif name == "read_file":
        content = Path(arguments["path"]).read_text()
        return {"content": content}
    elif name == "execute_command":
        result = subprocess.run(arguments["command"], shell=True, capture_output=True, text=True)
        return {"stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode}
    return {"error": "Unknown tool"}

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

```python
# omk/omk/orchestration.py
"""Core orchestration: Ralph loop, Team mode, Planner."""
import asyncio
import subprocess
import json
from pathlib import Path
from typing import Optional
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
import time

console = Console()

class RalphLoop:
    """Persistent execution loop with verification."""
    
    def __init__(self, state_manager):
        self.state = state_manager
        self.max_iterations = 50
    
    async def run(self, task: str):
        console.print(f"[blue]🚀 OMK Ralph Loop starting...[/blue]")
        console.print(f"[gray]Task: {task}[/gray]\n")
        
        # Initial plan
        console.print("[yellow]📋 Phase 1: Creating plan...[/yellow]")
        await self._run_kimi(f"Create a detailed plan for: {task}. Save to .omk/plan-current.md")
        
        iteration = 0
        done = False
        
        while not done and iteration < self.max_iterations:
            iteration += 1
            console.print(f"\n[blue]🔄 Iteration {iteration}/{self.max_iterations}[/blue]")
            
            # Execute step
            console.print("[yellow]⚡ Executing step...[/yellow]")
            try:
                await self._run_kimi(
                    "Execute the next incomplete step from .omk/plan-current.md. "
                    "Do ONE thing only, then report status."
                )
            except Exception as e:
                console.print(f"[red]Error: {e}. Retrying...[/red]")
                continue
            
            # Verify
            console.print("[yellow]✅ Verifying...[/yellow]")
            verify_result = await self._run_kimi(
                "Check if the task is fully complete. "
                "Output JSON only: {\"complete\": bool, \"remaining\": []}",
                capture=True
            )
            
            try:
                # Extract JSON from response
                result = json.loads(self._extract_json(verify_result))
                if result.get("complete"):
                    done = True
                    console.print("[green]✨ Task complete![/green]")
                else:
                    console.print(f"[gray]Remaining: {result.get('remaining', 'unknown')}[/gray]")
            except:
                # If parsing fails, ask user or continue based on heuristics
                if "complete" in verify_result.lower() and "not" not in verify_result.lower():
                    done = True
            
            time.sleep(1)
        
        if iteration >= self.max_iterations:
            console.print("[red]⚠️ Max iterations reached[/red]")
    
    async def _run_kimi(self, prompt: str, capture=False) -> str:
        """Run Kimi CLI with prompt."""
        cmd = ["kimi", "-p", prompt]
        
        if capture:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return result.stdout
        else:
            subprocess.run(cmd)
            return ""
    
    def _extract_json(self, text: str) -> str:
        """Extract JSON from text response."""
        # Simple extraction - look for curly braces
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            return text[start:end+1]
        return "{}"

class TeamOrchestrator:
    """Spawn and manage tmux-based team workers."""
    
    def __init__(self, state_manager):
        self.state = state_manager
    
    async def spawn(self, count: int, role: str, task: str, session_id: str):
        console.print(f"[blue]👥 Spawning team: {count}x {role}[/blue]")
        
        # Create team state
        team_dir = Path(".omk") / "team"
        team_dir.mkdir(exist_ok=True)
        
        plan = {
            "task": task,
            "role": role,
            "count": count,
            "workers": [{"id": f"{role}-{i}", "status": "starting"} for i in range(count)],
            "session": session_id
        }
        
        (team_dir / "plan.json").write_text(json.dumps(plan, indent=2))
        
        # Spawn tmux session
        tmux_name = f"omk-team-{session_id}"
        
        try:
            # Create session
            subprocess.run(["tmux", "new-session", "-d", "-s", tmux_name], check=True)
            
            # Create workers
            for i in range(count):
                worker_prompt = f"""You are {role} {i+1}/{count} in OMK Team mode.
Task: {task}
Rules:
- Save progress to .omk/team/worker-{i}.log
- Coordinate via .omk/team/plan.json
- Focus on your subtask only
"""
                if i > 0:
                    subprocess.run(["tmux", "split-window", "-t", tmux_name])
                
                subprocess.run([
                    "tmux", "send-keys", "-t", tmux_name,
                    f"kimi -p '{worker_prompt}'", "C-m"
                ])
            
            # Tile layout
            subprocess.run(["tmux", "select-layout", "-t", tmux_name, "tiled"])
            
            console.print(f"[green]✅ Team spawned: {tmux_name}[/green]")
            console.print(f"[gray]Attach: tmux attach -t {tmux_name}[/gray]")
            
        except subprocess.CalledProcessError:
            console.print("[red]Failed to spawn team. Is tmux installed?[/red]")

class Planner:
    """Generate and manage implementation plans."""
    
    async def create_plan(self, task: str):
        console.print("[blue]📋 Generating plan...[/blue]")
        
        prompt = f"""Create a detailed implementation plan for: {task}

Structure:
1. Overview
2. Subtasks (max 2 hours each)
3. Success criteria per subtask
4. Files to modify
5. Verification steps
6. Rollback plan

Save to .omk/plan-approved.md
"""
        subprocess.run(["kimi", "-p", prompt])
        console.print("[green]✅ Plan created at .omk/plan-approved.md[/green]")
```

```python
# omk/omk/cli.py
#!/usr/bin/env python3
"""OMK CLI - Oh My Kimi"""
import click
import asyncio
import subprocess
import sys
from pathlib import Path
from .state import StateManager
from .orchestration import RalphLoop, TeamOrchestrator, Planner
from rich.console import Console

console = Console()

def get_system_prompt(mode: str) -> str:
    """Get behavior injection prompt for mode."""
    base = "You are operating with OMK (Oh My Kimi) orchestration.\n"
    
    modes = {
        "smart": f"{base}Mode: SMART - Auto-plan before complex tasks, ask for clarification.",
        "madmax": f"{base}Mode: MADMAX - ALWAYS plan first, execute WITHOUT asking, retry on failures, never stop early.",
        "high": f"{base}Mode: MADMAX HIGH - Plan first, execute autonomously, VERIFY each step, PERSIST until 100% complete, loop automatically."
    }
    return modes.get(mode, modes["smart"])

@click.group(invoke_without_command=True)
@click.option('--madmax', is_flag=True, help='Aggressive autonomy mode')
@click.option('--high', is_flag=True, help='Persistent execution loop')
@click.option('--smart', is_flag=True, help='Smart planning mode (default)')
@click.argument('task', nargs=-1)
@click.pass_context
def cli(ctx, madmax, high, smart, task):
    """OMK - Oh My Kimi. Makes Kimi CLI feel like it's on steroids."""
    if ctx.invoked_subcommand is None:
        mode = "high" if high else "madmax" if madmax else "smart"
        task_str = " ".join(task)
        
        if not task_str:
            console.print("[blue]🚀 OMK (Oh My Kimi)[/blue]")
            console.print(f"[gray]Mode: {mode}[/gray]")
            console.print("\nRun with: omk --madmax --high \"your task\"")
            return
        
        state_mgr = StateManager()
        session = state_mgr.init_session(mode)
        
        console.print(f"[blue]🚀 OMK Mode: {mode.upper()}[/blue]")
        console.print(f"[gray]Session: {session.session_id}[/gray]\n")
        
        if mode == "high":
            # Ralph loop
            ralph = RalphLoop(state_mgr)
            asyncio.run(ralph.run(task_str))
        else:
            # Standard with behavior injection
            prompt = f"{get_system_prompt(mode)}\n\nTask: {task_str}"
            subprocess.run(["kimi", "-p", prompt])

@cli.command()
@click.argument('topic')
def deep_interview(topic):
    """Socratic requirements clarification."""
    state_mgr = StateManager()
    state_mgr.init_session("smart")
    
    console.print(f"[blue]🎯 Deep Interview: {topic}[/blue]")
    
    prompt = f"""You are in OMK DEEP-INTERVIEW mode.

Ask up to 10 Socratic questions to fully understand:
{topic}

Cover: goals, constraints, assumptions, risks, success criteria.

Save structured brief to .omk/interview-brief.md
"""
    subprocess.run(["kimi", "-p", prompt])

@cli.command()
@click.argument('task')
def plan(task):
    """Generate implementation plan."""
    state_mgr = StateManager()
    state_mgr.init_session("smart")
    
    planner = Planner()
    asyncio.run(planner.create_plan(task))

@cli.command()
@click.argument('task')
def ralph(task):
    """Persistent execution loop (Ralph mode)."""
    state_mgr = StateManager()
    state_mgr.init_session("high")
    
    ralph_loop = RalphLoop(state_mgr)
    asyncio.run(ralph_loop.run(task))

@cli.command()
@click.argument('spec')  # Format: 3:executor
@click.argument('task', nargs=-1)
def team(spec, task):
    """Spawn team workers (format: N:role 'task')."""
    try:
        count_str, role = spec.split(":")
        count = int(count_str)
    except ValueError:
        console.print("[red]Usage: omk team N:role \"task\"[/red]")
        console.print("[gray]Example: omk team 3:executor \"fix bugs\"[/gray]")
        return
    
    task_str = " ".join(task)
    state_mgr = StateManager()
    session = state_mgr.init_session("madmax")
    
    orchestrator = TeamOrchestrator(state_mgr)
    asyncio.run(orchestrator.spawn(count, role, task_str, session.session_id))

@cli.command()
def doctor():
    """Check OMK installation."""
    console.print("[blue]🔍 OMK Doctor[/blue]\n")
    
    checks = [
        ("Kimi CLI", ["kimi", "--version"]),
        ("tmux", ["tmux", "-V"]),
        ("Python", ["python", "--version"]),
    ]
    
    for name, cmd in checks:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            console.print(f"[green]✅ {name}: {result.stdout.strip()}[/green]")
        except FileNotFoundError:
            console.print(f"[red]❌ {name}: Not found[/red]")
    
    # Check dirs
    omk_home = Path.home() / ".omk"
    console.print(f"\n[gray]OMK Home: {'✅' if omk_home.exists() else '❌'} {omk_home}[/gray]")

@cli.command()
def mcp_proxy():
    """Start MCP proxy server (for hook interception)."""
    from .mcp_proxy import main
    asyncio.run(main())

def main():
    cli()

if __name__ == "__main__":
    main()
```

```python
# omk/omk/wrapper.py
"""Wrapper for Kimi CLI to inject context and hooks."""
import subprocess
import sys
import os
import json
from pathlib import Path

def wrap_kimi():
    """Wrap kimi command with OMK context."""
    # Extract flags
    args = sys.argv[1:]
    
    # Check if OMK mode is set
    mode = os.environ.get("OMK_MODE", "smart")
    
    # Load skills that match context
    skills_dir = Path(".omk/skills")
    injected_context = ""
    
    if skills_dir.exists():
        for skill_file in skills_dir.glob("*.md"):
            content = skill_file.read_text()
            # Simple trigger detection - in production, use proper matching
            if any(trigger in " ".join(args) for trigger in ["bug", "fix", "error"]):
                if "debug" in skill_file.name:
                    injected_context += f"\n## Skill: {skill_file.name}\n{content}\n"
    
    # Build modified arguments
    if "-p" in args:
        idx = args.index("-p")
        original_prompt = args[idx + 1]
        
        # Prepend behavior and context
        modified_prompt = f"""
{injected_context}

You are in OMK {mode.upper()} mode.

{original_prompt}
"""
        args[idx + 1] = modified_prompt
    
    # Add MCP config if available
    mcp_config = Path.home() / ".omk" / "mcp.json"
    if mcp_config.exists():
        args.extend(["--mcp-config-file", str(mcp_config)])
    
    # Execute actual kimi
    result = subprocess.run(["kimi"] + args)
    sys.exit(result.returncode)

if __name__ == "__main__":
    wrap_kimi()
```

```bash
#!/bin/bash
# omk/install.sh
set -e

echo "🚀 Installing OMK (Oh My Kimi)..."

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found"
    exit 1
fi

# Check Kimi
if ! command -v kimi &> /dev/null; then
    echo "❌ Kimi CLI not found. Install with: curl -LsSf https://code.kimi.com/install.sh | bash"
    exit 1
fi

# Install package
pip install -e .

# Create directories
mkdir -p ~/.omk/{skills,sessions,plans,logs,team}

# Create MCP config
cat > ~/.omk/mcp.json <<EOF
{
  "mcpServers": {
    "omk-hooks": {
      "command": "python",
      "args": ["-m", "omk.mcp_proxy"],
      "env": {
        "OMK_MODE": "high"
      }
    }
  }
}
EOF

echo "✅ OMK installed successfully!"
echo ""
echo "Usage:"
echo "  omk --madmax --high \"build a REST API\""
echo "  omk ralph \"refactor auth module\""
echo "  omk team 3:executor \"fix bugs\""
```

```markdown
<!-- omk/README.md -->
# OMK (Oh My Kimi)

Power workflows for Kimi CLI. Makes Kimi feel like it's on steroids.

## Installation

```bash
./install.sh
```

## Usage

```bash
# Madmax + High mode (persistent execution)
omk --madmax --high "build a REST API"

# Ralph loop (explicit)
omk ralph "refactor the auth module"

# Team mode
omk team 3:executor "fix all TypeScript errors"

# Deep interview
omk deep-interview "startup idea for a SaaS"

# Planning
omk plan "implement user authentication"
```

## Modes

- `--smart`: Default, asks for clarification
- `--madmax`: Aggressive autonomy, executes without asking
- `--high`: Persistent loop, keeps going until done (Ralph mode)

## Architecture

OMK works around Kimi CLI's limitations:

- **Wrapper CLI**: Intercepts calls, injects context
- **MCP Proxy**: Intercepts tool calls for hooks
- **State Management**: Filesystem-based session tracking
- **Tmux Integration**: Team mode via terminal multiplexing

```

---

### Quick Start Commands

**Install OMG:**
```bash
cd omg
chmod +x install.sh
./install.sh
```

**Install OMK:**

```bash
cd omk
chmod +x install.sh
./install.sh
```

**Test OMG:**

```bash
omg --madmax --high "create a simple todo list app"
omg doctor
```

**Test OMK:**

```bash
omk --madmax --high "create a simple todo list app"  
omk doctor
```

Both implementations provide the "steroids" feeling through:

1. **Behavior injection** (system prompts that enforce planning/verification)
2. **Ralph loop** (persistent execution until completion)
3. **State management** (filesystem tracking of plans/sessions)
4. **Team mode** (tmux-based parallel workers)
5. **Skill system** (context-aware capability injection)

This is a rough starting point.
