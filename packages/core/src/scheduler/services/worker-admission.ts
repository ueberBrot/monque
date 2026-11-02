import { Context } from "effect";

import type { WorkerAdmissionState } from "./worker-admission-state.js";

export { WorkerAdmissionState } from "./worker-admission-state.js";

export class WorkerAdmission extends Context.Service<WorkerAdmission, WorkerAdmissionState>()(
  "@monque/core/scheduler/WorkerAdmission",
) {}
