# Monque documentation

Guides and API references for the Monque packages, published at
[ueberBrot.github.io/monque](https://ueberBrot.github.io/monque/).

## Run locally

From the repository root:

```bash
bun install
bun run dev:docs
```

Open the URL printed by Astro, normally `http://localhost:4321/monque/`.
To build the site, run `bun run build:docs`. Output is written to `apps/docs/dist/`.

## Edit the docs

- Write guides in `src/content/docs/` as Markdown or MDX.
- Add navigation entries in `astro.config.mjs`.
- Edit public TypeScript declarations and their comments to update the generated API reference.
- Use `src/styles/` for site styles and `src/assets/` for images.

The site uses Astro Starlight with TypeDoc for API references and a Mermaid integration
for diagrams. Run `bun run build:docs` and `bun run lint:api-links` from the repository
root to check the build and API links before submitting changes.
