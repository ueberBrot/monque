import { vi } from "vite-plus/test";
import type { Mock, MockInstance } from "vite-plus/test";

type MockImplementation = NonNullable<Parameters<MockInstance["mockImplementation"]>[0]>;

/** Model a native async API while evaluating fixture operations in the calling turn. */
export const nativeAsyncMock = <T extends MockImplementation, TResult = Awaited<ReturnType<T>>>(
  operation: (...args: Parameters<T>) => TResult,
): Mock<(...args: Parameters<T>) => Promise<TResult>> =>
  vi.fn<(...args: Parameters<T>) => Promise<TResult>>(
    // oxlint-disable-next-line eslint/require-await -- Native async construction captures synchronous throws and keeps fulfillment timing; adding await would insert a microtask.
    async (...args): Promise<TResult> => operation(...args),
  );
