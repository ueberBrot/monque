import type { Mock, MockInstance } from "vite-plus/test";

/** Test doubles are ordinary functions and never require a native method receiver. */
export type MockFunction<T extends NonNullable<Parameters<MockInstance["mockImplementation"]>[0]>> =
  (...args: Parameters<T>) => ReturnType<T>;

/** Preserve a native object shape while making its test methods receiver independent. */
export type NativeMock<T> = {
  [K in keyof T]: T[K] extends NonNullable<Parameters<MockInstance["mockImplementation"]>[0]>
    ? Mock<MockFunction<T[K]>>
    : T[K];
};
