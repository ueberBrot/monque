---
name: monque-workflow
description: Helper for general development workflow in the Monque repository. Use this for running tests, linting, building, and other common tasks.
---

# Monque Workflow Skill

This skill provides instructions for the standard development workflow in the Monque repository.

## When to use this skill

- When the user asks to run tests, lint code, check types, or build the project.
- When you need to verify changes you've made.
- When you are unsure about which package manager or script to use.

## How to use it

### Package Manager

Always use **`bun`** as the package manager. Do not use `npm`, `yarn`, or `pnpm`.

### Scripts

This repository uses **TurboRepo**. Most tasks should be executed from the root directory using `bun run <script>`, which often delegates to Turbo.

**Available Root Scripts:**

- **Install Dependencies**: `bun install` (or `bun i`)
- **Build**: `bun run build` (runs `turbo build`)
- **Test (Unit)**: `bun run test:unit` (runs `turbo test:unit`) - *Use this for fast feedback.*
- **Test (Integration)**: `bun run test:integration` (runs `turbo test:integration`)
- **Test (Dev)**: `bun run test:dev` (runs `turbo test:dev`) - *Keeps Docker containers running for faster re-runs.*
- **Test (All)**: `bun run test` (runs `turbo test`)
- **Lint**: `bun run lint` (uses Biome)
- **Type Check**: `bun run type-check` (runs `turbo type-check`)
- **Clean**: `bun run clean`

### Best Practices

- **Testing**:
    - Prefer running `bun run test:unit` for quick feedback during development.
    - Run `bun run test:integration` before asking for a review if you changed core logic.
    - **Development**: Use `bun run test:dev` when working on features requiring databases. It enables Testcontainers reuse, significantly scanning up repeated test runs.
    - **IMPORTANT**: Do NOT use `bun test` directly. Always use `bun run test` or specific test scripts defined in `package.json` to ensure the correct test runner (Vitest) and configuration are used.

- **Linting & Formatting**:
    - The project uses **Biome**.
    - Run `bun run lint` to check for issues.
    - Run `bun run format` to fix formatting issues.

- **TurboRepo**:
    - When you run a command like `bun run build`, Turbo will try to cache the result. If you need to force a re-run, you can sometimes use `--force` (e.g., `bun run build -- --force`), but usually, `bun run clean` followed by the command is cleaner.
