declare const __MONQUE_CORE_VERSION__: string;

declare module 'virtual:starlight/user-images' {
	type ImageMetadata = import('astro').ImageMetadata;

	export const logos: {
		dark?: ImageMetadata;
		light?: ImageMetadata;
	};
}
