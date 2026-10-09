type ErrorRuntime = Omit<ErrorConstructor, "captureStackTrace"> & {
  captureStackTrace?: ErrorConstructor["captureStackTrace"];
};

const hasStackCapture = (
  runtime: ErrorRuntime,
): runtime is ErrorRuntime & Pick<ErrorConstructor, "captureStackTrace"> =>
  typeof runtime.captureStackTrace === "function";

/** Preserve native V8 stack trimming while allowing other JavaScript runtimes. */
export const captureErrorStack = (
  error: Error,
  constructor: NonNullable<Parameters<typeof Error.captureStackTrace>[1]>,
): void => {
  if (hasStackCapture(Error)) {
    Error.captureStackTrace(error, constructor);
  }
};
