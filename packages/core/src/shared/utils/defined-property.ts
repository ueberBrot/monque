/** Copy a defined optional property while preserving omitted fields. */
export const definedProperty = <T extends object, K extends keyof T>(
  source: T,
  key: K,
): Partial<Pick<T, K>> => {
  const property: Partial<Pick<T, K>> = {};
  if (source[key] !== undefined) {
    property[key] = source[key];
  }
  return property;
};
