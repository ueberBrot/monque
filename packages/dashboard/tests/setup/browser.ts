import { vi } from 'vitest';

// jsdom has no scrolling implementation; browser tests verify workspace geometry.
if (typeof Element !== 'undefined') {
	Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
}

if (typeof window !== 'undefined') {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: vi.fn(
			(query: string): MediaQueryList => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(() => true),
			}),
		),
	});
}
