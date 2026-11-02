import { MutableRef } from "effect";

import type { JobHandler, PersistedJob } from "@/jobs";
import { DEFAULT_MAX_BACKOFF_DELAY, validateJobName, WorkerRegistrationError } from "@/shared";
import { definedProperty } from "@/shared/utils/defined-property.js";
import type { WorkerOptions, WorkerRegistration } from "@/workers";

import type { ProcessingState } from "../types.js";
import { validateIntegerOption, validateRetryOptions } from "../validate-options.js";
import type { ResolvedMonqueOptions } from "./types.js";

type AdmissionOptions = Pick<
  ResolvedMonqueOptions,
  | "workerConcurrency"
  | "instanceConcurrency"
  | "maxRetries"
  | "baseRetryInterval"
  | "maxBackoffDelay"
  | "schedulerInstanceId"
>;

export interface WorkerObservation {
  readonly name: string;
  readonly concurrency: number;
  readonly activeCount: number;
  readonly paused: boolean;
  readonly hasSchema: boolean;
  readonly maxRetries: number;
  readonly baseRetryInterval: number;
  readonly maxBackoffDelay: number;
}

interface ProcessingScope {
  instanceId: ProcessingState["instanceId"];
  name?: string;
}

interface AdmissionState {
  readonly running: boolean;
  readonly generation: number;
  readonly paused: boolean;
  readonly pausedWorkers: ReadonlySet<string>;
  readonly workers: ReadonlyMap<string, WorkerRegistration>;
  readonly lastServedWorker: string | null;
}

/**
 * Instance-owned state, constructed before asynchronous initialization. Every
 * transition is synchronous, without callbacks or yields, and publishes a new
 * snapshot. Nested Maps/Sets are copied before writing, never mutated through a Ref.
 * Executions survive processing generations; their records are the capacity truth.
 */
export class WorkerAdmissionState {
  readonly #state = MutableRef.make<AdmissionState>({
    running: false,
    generation: 0,
    paused: false,
    pausedWorkers: new Set(),
    workers: new Map(),
    lastServedWorker: null,
  });
  private readonly options: AdmissionOptions;
  /** Live read-only compatibility view, including for callers that capture it. */
  readonly workers: ReadonlyMap<string, WorkerRegistration>;
  constructor(options: AdmissionOptions) {
    this.options = options;
    const state = this.#state;
    this.workers = {
      get size() {
        return state.current.workers.size;
      },
      get: (name) => state.current.workers.get(name),
      has: (name) => state.current.workers.has(name),
      entries: () => state.current.workers.entries(),
      keys: () => state.current.workers.keys(),
      values: () => state.current.workers.values(),
      [Symbol.iterator]: () => state.current.workers[Symbol.iterator](),
      forEach: (callback, thisArg) => {
        for (const [name, worker] of state.current.workers) {
          callback.call(thisArg, worker, name, this.workers);
        }
      },
    };
  }

  get running(): boolean {
    return this.#state.current.running;
  }
  get generation(): number {
    return this.#state.current.generation;
  }
  start(): void {
    MutableRef.update(this.#state, (state) =>
      state.running ? state : { ...state, running: true, generation: state.generation + 1 },
    );
  }
  stop(): void {
    MutableRef.update(this.#state, (state) => ({ ...state, running: false }));
  }
  register<T>(name: string, handler: JobHandler<T>, options: WorkerOptions<T> = {}): void {
    validateJobName(name);
    const concurrency = options.concurrency ?? this.options.workerConcurrency;
    validateIntegerOption("concurrency", concurrency);

    const retryOptions = {
      maxRetries: options.maxRetries ?? this.options.maxRetries,
      baseRetryInterval: options.baseRetryInterval ?? this.options.baseRetryInterval,
      maxBackoffDelay: options.maxBackoffDelay ?? this.options.maxBackoffDelay,
    };

    validateRetryOptions(retryOptions);

    // Read application-supplied options before publishing the transition.
    if (this.workers.has(name) && options.replace !== true) {
      throw new WorkerRegistrationError(
        `Worker already registered for job name "${name}". Use { replace: true } to replace.`,
        name,
      );
    }

    const schema = definedProperty(options, "schema");
    const state = this.#state.current;
    const workers = new Map(state.workers);
    workers.set(name, {
      // SAFETY: The heterogeneous registry retains each schema beside its handler.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Preserve the public generic handler API while storing registrations together.
      handler: handler as JobHandler,
      concurrency,
      retryOptions,
      ...schema,
      activeJobs: state.workers.get(name)?.activeJobs ?? new Map(),
    });
    MutableRef.set(this.#state, { ...state, workers });
  }
  pause(name?: string): void {
    if (name !== undefined) {
      validateJobName(name);
    }

    MutableRef.update(this.#state, (state) => ({
      ...state,
      ...(name === undefined
        ? { paused: true }
        : { pausedWorkers: new Set([...state.pausedWorkers, name]) }),
    }));
  }
  resume(name?: string): void {
    if (name !== undefined) {
      validateJobName(name);
    }

    MutableRef.update(this.#state, (state) => {
      const pausedWorkers = new Set(state.pausedWorkers);

      if (name !== undefined) {
        pausedWorkers.delete(name);
      }

      return name === undefined ? { ...state, paused: false } : { ...state, pausedWorkers };
    });
  }
  isPaused(name?: string): boolean {
    if (name !== undefined) {
      validateJobName(name);
    }

    const state = this.#state.current;

    return state.paused || (name !== undefined && state.pausedWorkers.has(name));
  }
  processingState(name?: string): ProcessingState {
    const scope: ProcessingScope = {
      instanceId: this.options.schedulerInstanceId,
    };

    if (name !== undefined) {
      scope.name = name;
    }

    return {
      ...scope,
      paused: this.isPaused(name),
      globallyPaused: this.#state.current.paused,
    };
  }
  workerObservations(name?: string): readonly WorkerObservation[] {
    const state = this.#state.current;
    let selected: Iterable<readonly [string, WorkerRegistration]> = state.workers;

    if (name !== undefined) {
      const registration = state.workers.get(name);
      selected = registration ? [[name, registration]] : [];
    }

    return [...selected].map(([workerName, worker]) => ({
      name: workerName,
      concurrency: worker.concurrency,
      activeCount: worker.activeJobs.size,
      paused: state.paused || state.pausedWorkers.has(workerName),
      hasSchema: worker.schema !== undefined,
      maxRetries: worker.retryOptions?.maxRetries ?? this.options.maxRetries,
      baseRetryInterval: worker.retryOptions?.baseRetryInterval ?? this.options.baseRetryInterval,
      maxBackoffDelay:
        worker.retryOptions?.maxBackoffDelay ??
        this.options.maxBackoffDelay ??
        DEFAULT_MAX_BACKOFF_DELAY,
    }));
  }
  /** Registration order, rotated after the last successful Claim when capped. */
  orderedNames(): string[] {
    const { workers, lastServedWorker } = this.#state.current;

    if (this.instanceSlots() <= 0) {
      return [];
    }

    const names = [...workers.keys()];

    if (this.options.instanceConcurrency === undefined) {
      return names;
    }

    const next = lastServedWorker === null ? 0 : names.indexOf(lastServedWorker) + 1;

    return [...names.slice(next), ...names.slice(0, next)];
  }
  /** Capacity only; callers retain their synchronous running/pause admission guards. */
  availableSlots(name: string): number {
    const worker = this.workers.get(name);

    if (!worker) {
      return 0;
    }

    return Math.min(worker.concurrency - worker.activeJobs.size, this.instanceSlots());
  }
  private instanceSlots(): number {
    const { instanceConcurrency } = this.options;

    if (instanceConcurrency === undefined) {
      return Number.POSITIVE_INFINITY;
    }

    let active = 0;

    for (const registration of this.workers.values()) {
      active += registration.activeJobs.size;
    }

    return instanceConcurrency - active;
  }
  /** A successful Claim advances fairness even when a pause requires releasing it. */
  noteClaim(name: string): void {
    MutableRef.update(this.#state, (state) => ({ ...state, lastServedWorker: name }));
  }
  /** Handoff from an admitted Claim to execution, before synchronous job:start. */
  beginExecution(name: string, job: PersistedJob): () => void {
    const state = this.#state.current;
    const worker = state.workers.get(name);

    if (!worker) {
      throw new Error("Cannot admit an execution without a registered Worker");
    }

    const key = job.claimId ?? job._id.toString();
    const activeJobs = new Map(worker.activeJobs);
    activeJobs.set(key, job);
    const workers = new Map(state.workers);
    workers.set(name, { ...worker, activeJobs });
    MutableRef.set(this.#state, { ...state, workers });

    return () => {
      this.finishExecution(name, key, job);
    };
  }
  /** Release the execution record, including after replacement or a timed-out stop. */
  private finishExecution(name: string, key: string, job: PersistedJob): void {
    const state = this.#state.current;
    const worker = state.workers.get(name);

    if (worker?.activeJobs.get(key) !== job) {
      return;
    }

    const activeJobs = new Map(worker.activeJobs);
    activeJobs.delete(key);
    const workers = new Map(state.workers);
    workers.set(name, { ...worker, activeJobs });
    MutableRef.set(this.#state, { ...state, workers });
  }
  activeJobs(): PersistedJob[] {
    return [...this.workers.values()].flatMap((worker) => [...worker.activeJobs.values()]);
  }
}
