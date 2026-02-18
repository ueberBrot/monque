---
name: monque-workflow
description: Standard development workflow for the Monque repository. Use when running tests, linting, building, checking types, or performing other common development tasks. Also use when unsure about which package manager or script to use.
---

# Monque Workflow

## Package Manager

Always use **`bun`**. Never use `npm`, `yarn`, or `pnpm`.

## Scripts

Run from root directory. TurboRepo handles task orchestration.

| Task | Command |
|---|---|
| Install | `bun install` |
| Build | `bun run build` |
| Test (Unit) | `bun run test:unit` |
| Test (Integration) | `bun run test:integration` |
| Test (Dev) | `bun run test:dev` |
| Test (All) | `bun run test` |
| Lint | `bun run lint` |
| Fix & Format | `bun run check` |
| Type Check | `bun run type-check` |
| Clean | `bun run clean` |

## Best Practices

- **Testing**: Prefer `bun run test:unit` for quick feedback. Run `bun run test:integration` before review if core logic changed. Use `bun run test:dev` when working with databases (keeps Testcontainers alive).
- **IMPORTANT**: Never use `bun test` directly. Always use `bun run test` or specific scripts to ensure Vitest configuration is used.
- **Linting**: Use Biome via `bun run lint` (check) and `bun run check` (fix + format).
- **Cache**: If Turbo cache causes issues, run `bun run clean` then re-run the command.
