---
name: "awaken-agent-skills"
description: "Awaken DEX trading and market data operations for agents."
---

# Awaken Agent Skill

## When to use
- Use this skill when you need Awaken DEX quote, swap, liquidity, and kline analysis tasks.

## Capabilities
- Read operations: quote, pair info, balances, allowance, positions
- Write operations: swap, add/remove liquidity, approve
- SignalR-based K-line retrieval and interval discovery
- Supports SDK, CLI, MCP, and OpenClaw integration from one codebase.

## Safe usage rules
- Never print private keys, mnemonics, or tokens in channel outputs.
- For write operations, require explicit user confirmation and validate parameters before sending transactions.
- Prefer `simulate` or read-only queries first when available.

## Command recipes
- Start MCP server: `bun run mcp`
- Run CLI entry: `bun run awaken_query_skill.ts quote --symbol-in ELF --symbol-out USDT --amount-in 1`
- Generate OpenClaw config: `bun run build:openclaw`
- Verify OpenClaw config: `bun run build:openclaw:check`
- Run CI coverage gate: `bun run test:coverage:ci`

## Limits / Non-goals
- This skill focuses on domain operations and adapters; it is not a full wallet custody system.
- Do not hardcode environment secrets in source code or docs.
- Avoid bypassing validation for external service calls.
