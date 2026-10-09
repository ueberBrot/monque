/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { describe, expect, it } from "vite-plus/test";

import { getJobToken } from "@/utils/get-job-token";

// oxlint-disable-next-line typescript/no-extraneous-class -- Each call creates a distinct constructor with the same DI token name.
const createClass = () => class MyJob {};

describe(getJobToken, () => {
  it("should return a unique symbol based on class name", () => {
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class TestJob {}
    const token = getJobToken(TestJob);

    expect(token).toBeTypeOf("symbol");
    expect(token.toString()).toBe("Symbol(monque:job:TestJob)");
  });

  it("should throw an error for anonymous classes", () => {
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    expect(() => getJobToken(class {})).toThrow("Job class must have a non-empty name");
  });

  it("should return the same symbol for the same class", () => {
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class SameJob {}
    const token1 = getJobToken(SameJob);
    const token2 = getJobToken(SameJob);

    expect(token1).toBe(token2);
  });

  it("should return the same symbol for different classes with the same name", () => {
    const Class1 = createClass();
    const Class2 = createClass();

    expect(getJobToken(Class1)).toBe(getJobToken(Class2));
  });
});
