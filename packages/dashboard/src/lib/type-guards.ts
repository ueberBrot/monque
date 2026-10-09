export const isString = (value: unknown): value is string => typeof value === "string";
export const isNumber = (value: unknown): value is number => typeof value === "number";
export const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;
export const isFunction = (value: unknown): value is (...args: never[]) => void =>
  typeof value === "function";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
