---
name: documentation-writing
description: Guidelines for working with the project documentation site in apps/docs. Use when adding new documentation pages, updating existing docs, fixing typos, or clarifying documentation sections.
---

# Documentation Writing

## Technology Stack

- **Framework**: [Astro](https://astro.build/)
- **Theme**: [Starlight](https://starlight.astro.build/)

## Workflow

1. Source files are in `apps/docs/src/content/docs/`.
2. Preview with `bun dev:docs` (serves at http://localhost:4321).
3. Files use Markdown (`.md`) or MDX (`.mdx`).

## Guidelines

- **Frontmatter**: Every page must have `title` and `description`.
- **Code Blocks**: Use standard markdown code blocks with language identifiers.
- **Links**: Use relative links for internal navigation.

## Commands

- `bun dev:docs`: Start the documentation dev server.
- `bun build:docs`: Build the documentation site.
