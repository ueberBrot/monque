import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

afterEach(cleanup);
// jsdom has no scrolling implementation; browser tests verify workspace geometry.
if (globalThis.Element !== undefined) {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn<typeof window.scrollTo>(),
  });
}
if (globalThis.window !== undefined) {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn<typeof window.scrollTo>(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList requires the legacy listener methods for a complete browser API fixture.
      addListener: vi.fn<MediaQueryList["addListener"]>(),
      // oxlint-disable-next-line typescript/no-deprecated -- MediaQueryList requires the legacy listener methods for a complete browser API fixture.
      removeListener: vi.fn<MediaQueryList["removeListener"]>(),
      addEventListener: vi.fn<MediaQueryList["addEventListener"]>(),
      removeEventListener: vi.fn<MediaQueryList["removeEventListener"]>(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}
