export const forEachSequential = async <T>(
  values: Iterable<T>,
  action: (value: T) => Promise<void>,
): Promise<void> => {
  const iterator = values[Symbol.iterator]();
  const runNext = async (): Promise<void> => {
    const next = iterator.next();
    if (next.done === true) {
      return;
    }
    await action(next.value);
    await runNext();
  };
  await runNext();
};
