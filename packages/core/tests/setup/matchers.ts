import { expect } from "vite-plus/test";
import type { DeeplyAllowMatchers } from "vite-plus/test";

type NativeMatcher = Exclude<DeeplyAllowMatchers<string>, string>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native Vitest matcher factories erase their return type to any.
const nativeMatcher = (value: unknown): NativeMatcher =>
  // SAFETY: Every call below forwards a native asymmetric matcher unchanged.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Recover Vitest's own matcher type at its any boundary.
  value as NativeMatcher;

/** Forward native asymmetric matchers with Vitest's own expected-value type. */
export const anyMatcher = (...args: Parameters<typeof expect.any>): NativeMatcher =>
  nativeMatcher(expect.any(...args));
export const anythingMatcher = (...args: Parameters<typeof expect.anything>): NativeMatcher =>
  nativeMatcher(expect.anything(...args));
export const objectContainingMatcher = (
  ...args: Parameters<typeof expect.objectContaining>
): NativeMatcher => nativeMatcher(expect.objectContaining(...args));
export const arrayContainingMatcher = (
  ...args: Parameters<typeof expect.arrayContaining>
): NativeMatcher => nativeMatcher(expect.arrayContaining(...args));
export const stringContainingMatcher = (
  ...args: Parameters<typeof expect.stringContaining>
): NativeMatcher => nativeMatcher(expect.stringContaining(...args));
export const stringMatchingMatcher = (
  ...args: Parameters<typeof expect.stringMatching>
): NativeMatcher => nativeMatcher(expect.stringMatching(...args));
