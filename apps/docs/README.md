# Monque Documentation

Documentation site for the [Monque](https://github.com/ueberbrot/monque) job scheduler, built with [Astro Starlight](https://starlight.astro.build/).

The site uses [Astro](https://astro.build/) and [Starlight](https://starlight.astro.build/).
[TypeDoc](https://typedoc.org/) generates the API reference through the
[Starlight TypeDoc plugin](https://starlight-typedoc.vercel.app/).

## Getting Started

1. Install dependencies:

   ```bash
   bun install
   ```

2. Start the development server:

   ```bash
   # From the repo root
   bun run dev:docs

   # Or from within apps/docs
   cd apps/docs && bun run dev
   ```

   The site will be available at <http://localhost:4321/monque>.

## Building

Build the static site:

```bash
# From the repo root
bun run build:docs

# Or from within apps/docs
cd apps/docs && bun run build
```

The output will be in the `dist/` directory.

## Project Structure

- `src/content/docs`: Markdown and MDX files for the documentation pages.
- `src/assets`: Static assets like images.
- `src/styles`: Custom CSS.
- `astro.config.mjs`: Astro and Starlight configuration.
- `package.json`: Dependencies and scripts.

## Contribution

To add a new documentation page:

1. Create a new `.md` or `.mdx` file in `src/content/docs/`.
2. Add the page to the `sidebar` configuration in `astro.config.mjs` if you want it to appear in the navigation menu.
