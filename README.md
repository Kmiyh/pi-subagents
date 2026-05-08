# @kmiyh/pi-subagent

`@kmiyh/pi-subagent` is a Pi extension for delegating tasks to specialized subagents with isolated context windows.

It is packaged from Pi's `examples/extensions/subagent` extension.

## Features

- **Isolated context**: each subagent runs in a separate `pi` process
- **Streaming output**: see tool calls and progress as they happen
- **Parallel streaming**: parallel tasks stream updates simultaneously
- **Markdown rendering**: final output is rendered with formatting in expanded view
- **Usage tracking**: shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to subagent processes
- **Bundled agents and prompts**: includes `scout`, `planner`, `reviewer`, `worker` and workflow prompts

## Installation

```bash
pi install npm:@kmiyh/pi-subagent
```

Or install directly from GitHub:

```bash
pi install git:github.com/Kmiyh/pi-subagent
```

For local development:

```bash
npm install
npm run typecheck
pi -e ./src/index.ts
```

## Structure

```text
repo-pi-subagent/
├── README.md
├── LICENSE
├── package.json
├── tsconfig.json
├── .github/workflows/publish.yml
└── src/
    ├── index.ts
    ├── agents.ts
    ├── agents/
    │   ├── scout.md
    │   ├── planner.md
    │   ├── reviewer.md
    │   └── worker.md
    └── prompts/
        ├── implement.md
        ├── scout-and-plan.md
        └── implement-and-review.md
```

## Usage

### Single agent

```text
Use scout to find all authentication code
```

### Parallel execution

```text
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow

```text
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts

```text
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently, max 8 tasks, 4 concurrent |
| Chain | `{ chain: [...] }` | Sequential execution with `{previous}` placeholder |

## Agent definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: glm-5.1:cloud
thinking: low
---

System prompt for the agent goes here.
```

The `model` field sets which LLM the subagent uses. The `thinking` field sets the reasoning level (`off`, `low`, `medium`, `high`, `xhigh`). To change model or reasoning, edit the frontmatter in `src/agents/*.md`.

Agent locations:

- bundled package agents in `src/agents/*.md`
- user agents in `~/.pi/agent/agents/*.md`
- project agents in `.pi/agents/*.md` when `agentScope` is `project` or `both`

With `agentScope: "both"`, project agents override user agents, and user agents override bundled agents with the same name.

## Security model

This tool executes a separate `pi` subprocess with delegated system prompt and tool/model configuration.

Project-local agents are repo-controlled prompts that can instruct the model to read files, run bash commands, etc. Only enable project-local agents for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable.

## Publishing

Publishing matches `pi-plan-mode`: pushing a `v*` tag runs GitHub Actions to verify with `npm ci && npm run typecheck`, then publishes to npm and GitHub Packages.

Required secrets:

- `NPM_TOKEN` for npm publishing
- `GITHUB_TOKEN` is provided by GitHub Actions for GitHub Packages

## License

MIT
