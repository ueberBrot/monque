const createStubController = (name: string) => {
  // oxlint-disable-next-line typescript/no-extraneous-class -- The TsED mock registry needs constructor identities without handler methods.
  class StubController {}
  Object.defineProperty(StubController, "name", { value: name });
  return StubController;
};

export const StubControllerA = createStubController("StubControllerA");
export const StubControllerB = createStubController("StubControllerB");
export const StubControllerC = createStubController("StubControllerC");
