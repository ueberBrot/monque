---
name: documentation-writing
description: Instructions for updating the project documentation. Use this when the user asks to update docs, add examples, or fix typos in the documentation.
---

# Documentation Writing Skill

This skill provides guidelines for working with the project's documentation in `apps/docs`.

## When to use this skill

- When adding new pages to the documentation.
- When updating existing documentation.
- When fixing typos or clarifying sections.

## How to use it

### Technology Stack

- **Framework**: [Astro](https://astro.build/)
- **Theme**: [Starlight](https://starlight.astro.build/)

### Workflow

1.  **Location**: specific documentation source files are in `apps/docs/src/content/docs/`.
2.  **Preview**: Run `bun dev:docs` in the root directory to start the dev server (usually at http://localhost:4321).
3.  **Format**: Files are written in Markdown (`.md`) or MDX (`.mdx`).

### Guidelines

- **Frontmatter**: Ensure every page has a `title` and `description` in the frontmatter.
- **Code Blocks**: Use standard markdown code blocks with language identifiers.
- **Links**: Use relative links for internal navigation.

### Commands

- `bun dev:docs`: Start the documentation server.
- `bun build:docs`: Build the documentation site.
