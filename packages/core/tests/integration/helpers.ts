/** Require a database result or observed event before checking its fields. */
export const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a database result or observed value");
  }
  return value;
};

/** Keep ordered integration setup and observations sequential. */
export const forEachSequential = async <T>(
  values: Iterable<T>,
  action: (value: T, index: number) => Promise<void>,
): Promise<void> => {
  const iterator = values[Symbol.iterator]();
  let index = 0;
  const visitNext = async (): Promise<void> => {
    const next = iterator.next();
    if (next.done === true) {
      return;
    }
    await action(next.value, index);
    index += 1;
    await visitNext();
  };
  await visitNext();
};
