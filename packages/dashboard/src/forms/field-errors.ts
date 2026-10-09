import { isString, isObject } from "../lib/type-guards.js";

export const getFieldErrors = (errors: readonly unknown[]): string | undefined => {
  const messages = errors
    .flatMap((issue) => {
      if (isString(issue)) {
        return [issue];
      }
      if (issue !== null && isObject(issue) && "message" in issue && isString(issue.message)) {
        return [issue.message];
      }
      return [];
    })
    .filter(Boolean);
  return messages.length > 0 ? messages.join(", ") : undefined;
};
