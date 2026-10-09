declare const __MONQUE_CORE_VERSION__: string;

// Starlight 0.42 ships compiled types without its virtual config declaration.
declare module "virtual:starlight/user-config" {
  import type { StarlightConfig } from "@astrojs/starlight/types";

  const config: StarlightConfig;
  export default config;
}

declare module "virtual:starlight/user-images" {
  import type { ImageMetadata } from "astro";

  export const logos: {
    dark?: ImageMetadata;
    light?: ImageMetadata;
  };
}
