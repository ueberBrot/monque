# Technology Stack

**Analysis Date:** 2026-02-24

## Languages

**Primary:**
- TypeScript ^5.9.3 - All source code, tests, configuration, and scripts

**Secondary:**
- JavaScript (ESM) - Astro config (`apps/docs/astro.config.mjs`), remark plugins
- JSON/JSONC - Configuration files (`biome.json`, `tsconfig.json`, `turbo.json`)
- YAML - CI workflows (`.github/workflows/`), lefthook config (`lefthook.yml`)

## Runtime

**Environment:**
- Node.js >=22.0.0 (pinned in `.nvmrc`: `22.21.1`)
- Target: ESNext (both compile target and lib)
- Module system: ESM (`"type": "module"` in all `package.json` files)

**Package Manager:**
- Bun 1.3.5 (declared in root `package.json` `"packageManager"` field)
- CI uses Bun 1.3.9 (`.github/workflows/ci.yml`)
- Lockfile: `bun.lock` (present, committed)
- **Never use npm, yarn, or pnpm** — Bun is the sole package manager

## Frameworks

**Core:**
- No application framework — `@monque/core` is a library built on Node.js `EventEmitter` + native MongoDB driver
- Ts.ED ^8.25.1 - DI framework integration in `@monque/tsed` (peer dependency)

**Documentation:**
- Astro ^5.17.3 - Documentation site (`apps/docs/`)
- Starlight ^0.37.6 - Astro documentation theme (`@astrojs/starlight`)

**Testing:**
- Vitest ^4.0.18 - Test runner with `globals: true` (no explicit imports needed)
- `@vitest/coverage-v8` ^4.0.18 - V8 coverage provider
- Testcontainers ^11.12.0 / `@testcontainers/mongodb` ^11.12.0 - MongoDB containers for integration tests
- fishery ^2.4.0 - Test factories
- `@faker-js/faker` ^10.3.0 - Fake data generation

**Build/Dev:**
- tsdown ^0.20.3 - TypeScript bundler (builds to ESM + CJS with DTS)
- Turborepo ^2.8.10 - Monorepo task runner and build orchestrator
- TypeDoc ^0.28.17 + `typedoc-plugin-markdown` ^4.10.0 - API docs generation

## Key Dependencies

**Critical (Runtime):**
- `mongodb` ^7.1.0 - Native MongoDB driver (peer dependency of `@monque/core`; overridden at root)
- `cron-parser` ^5.5.0 - Cron expression parsing (only runtime dependency of `@monque/core`)

**Ts.ED Integration (Peer Dependencies of `@monque/tsed`):**
- `@tsed/core` ^8.25.1 - Ts.ED core utilities
- `@tsed/di` ^8.25.1 - Dependency injection container
- `@tsed/mongoose` ^8.25.1 - Mongoose integration (optional peer dependency)
- `@monque/core` ^1.3.0 - Core library (workspace dependency)

**Documentation Site:**
- `starlight-typedoc` ^0.21.5 - TypeDoc → Starlight page generation
- `starlight-links-validator` ^0.19.2 - Link validation
- `starlight-llms-txt` ^0.7.0 - LLM-friendly documentation generation
- `starlight-theme-nova` ^0.11.5 - Theme
- `sharp` ^0.34.5 - Image optimization
- `@fontsource/quicksand` ^5.2.10 - Custom font

**Infrastructure/Tooling:**
- `@biomejs/biome` ^2.4.4 - Linter and formatter (replaces ESLint + Prettier)
- `lefthook` ^2.1.1 - Git hooks manager
- `@changesets/cli` ^2.29.8 - Version management and changelog generation
- `@changesets/changelog-github` ^0.5.2 - GitHub-linked changelogs
- `knip` ^5.85.0 - Unused export/dependency detection
- `publint` ^0.3.17 - Package publish validation
- `@arethetypeswrong/cli` ^0.18.2 - TypeScript module resolution validation
- `rimraf` ^6.1.3 - Cross-platform file removal
- `@total-typescript/ts-reset` ^0.6.1 - TypeScript standard lib type fixes (dev)
- `unplugin-unused` ^0.5.7 - Unused code detection via build plugin

## Configuration

**TypeScript:**
- Strict mode with extra strictness flags enabled
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`
- `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`
- `verbatimModuleSyntax` - Enforces `import type` for type-only imports
- `moduleResolution: "bundler"` - Modern bundler-mode resolution
- Core config: `packages/core/tsconfig.json`
- Ts.ED config: `packages/tsed/tsconfig.json` (adds `experimentalDecorators` + `emitDecoratorMetadata`)
- Path aliases: `@/` → `src/`, `@tests/` → `tests/`, `@test-utils/` → `tests/setup/`

**Formatting (Biome):**
- Config: `biome.json` (root)
- Indentation: Tabs (width 2)
- Quotes: Single
- Semicolons: Always
- Line width: 100
- Import organization: Automatic with custom group order (URL → builtins/packages → aliases → relative)
- Unsafe parameter decorators enabled (for Ts.ED)

**Linting (Biome):**
- Recommended rules enabled
- `noUnusedImports`: error
- `noUnusedVariables`: error
- `useLiteralKeys`: off (allows bracket notation for index signatures)

**Build (tsdown):**
- Core config: `packages/core/tsdown.config.ts`
- Ts.ED config: `packages/tsed/tsdown.config.ts`
- Output formats: ESM (`.mjs`) + CJS (`.cjs`)
- DTS generation enabled
- Sourcemaps enabled
- Target: `node22`
- External: `mongodb` (core), plus `@tsed/*` and `@monque/core` (tsed)
- Includes `publint` and `attw` validation

**Monorepo (Turborepo):**
- Config: `turbo.json`
- Workspaces: `packages/*`, `apps/*`
- Task dependency graph: `build → test`, `build → type-check`, `build → check:exports`
- Caching enabled for all non-persistent tasks
- Global dependency on `.env.*local` files

**Git Hooks (Lefthook):**
- Config: `lefthook.yml`
- Pre-commit (parallel): `type-check` + `biome check --write` on staged files + lockfile verification

**Dependency Updates (Renovate):**
- Config: `renovate.json`
- Enabled managers: `bun`, `github-actions`
- Auto-merge for non-major dev deps and GitHub Actions digests
- Manual review for peer dependency updates, Ts.ED updates, and major versions
- Concurrent PR limit: 4

**Unused Export Detection (Knip):**
- Config: `knip.json`
- Scans `packages/*` with entry `src/**/*.ts` and `tests/**/*.ts`
- Ignores `specs/` directory
- Ignores `@fontsource/quicksand` and `sharp` (used implicitly by docs)

## Package Exports

**`@monque/core` (v1.3.0):**
- Dual ESM/CJS with conditional exports
- Entry: `src/index.ts` → `dist/index.mjs` / `dist/index.cjs`
- Types: `dist/index.d.mts` / `dist/index.d.cts`
- Published to npm (public access)
- Ships `dist/` + `src/` in package

**`@monque/tsed` (v1.2.0):**
- Same dual ESM/CJS export structure
- Published to npm (public access)
- Ships `dist/` + `src/` in package

## Platform Requirements

**Development:**
- Node.js >=22.0.0
- Bun 1.3.5+
- Docker (for Testcontainers integration tests)
- Git (for lefthook, VCS-aware Biome)

**Production (Library consumers):**
- Node.js >=22.0.0
- MongoDB 6.0+ (for Change Streams support; replica set or sharded cluster recommended)
- `mongodb` ^7.1.0 driver (peer dependency)

**CI:**
- GitHub Actions (Ubuntu latest)
- Bun 1.3.9
- Node.js 22 (for npm publish via changesets)
- Docker (Testcontainers runs MongoDB containers during test job)

---

*Stack analysis: 2026-02-24*
