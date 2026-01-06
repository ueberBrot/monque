# Monque Documentation

Documentation site for the [Monque](https://github.com/ueberBrot/monque) job scheduler, built with [Astro Starlight](https://starlight.astro.build/).

## Tech Stack

- **Framework**: [Astro](https://astro.build/)
- **Documentation Theme**: [Starlight](https://starlight.astro.build/)
- **API Documentation**: [TypeDoc](https://typedoc.org/) with [Starlight TypeDoc Plugin](https://starlight-typedoc.vercel.app/)

## Getting Started

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Start the development server**:

   ```bash
   bun dev
   ```

   The site will be available at <http://localhost:4321/monque>.

## Building

To build the static documentation site:

```bash
bun build
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
