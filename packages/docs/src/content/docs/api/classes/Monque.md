---
editUrl: false
next: false
prev: false
title: "Monque"
---

Defined in: [packages/core/src/scheduler/monque.ts:134](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L134)

Monque - MongoDB-backed job scheduler

A type-safe job scheduler with atomic locking, exponential backoff, cron scheduling,
stale job recovery, and event-driven observability. Built on native MongoDB driver.

## Example

```;
typescript

import { Monque } from '@monque/core';

import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect()

const db = client.db('myapp');

// Create instance with options

const monque = new Monque(db, {
  collectionName: 'jobs',
  pollInterval: 1000,
  maxRetries: 10,
  shutdownTimeout: 30000,
});

// Initialize (sets up indexes and recovers stale jobs)
await monque.initialize()

// Register workers with type safety

type EmailJob = {};
  to: string
  subject: string
  body: string
}

monque.worker<EmailJob>('send-email', async (job) =>
{
  await emailService.send(job.data.to, job.data.subject, job.data.body)

}
)

// Monitor events for observability
monque.on('job:complete', (
{
job, duration;
}
) =>
{
  logger.info(`Job $job.namecompleted in $durationms`);
});

monque.on('job:fail', ({ job, error, willRetry }) => {
  logger.error(`Job $job.namefailed:`, error);
});

// Start processing
monque.start();

// Enqueue jobs
await monque.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.'
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await monque.stop();
  await client.close();
  process.exit(0);
});
```

## Extends

- `EventEmitter`

## Constructors

### Constructor

```ts
new Monque(db, options): Monque;
```

Defined in: [packages/core/src/scheduler/monque.ts:179](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L179)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `db` | `Db` |
| `options` | [`MonqueOptions`](/api/interfaces/monqueoptions/) |

#### Returns

`Monque`

#### Overrides

```ts
EventEmitter.constructor
```

## Methods

### \[captureRejectionSymbol\]()?

```ts
optional [captureRejectionSymbol](
   error, 
   event, ...
   args): void;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:118

The `Symbol.for('nodejs.rejection')` method is called in case a
promise rejection happens when emitting an event and
`captureRejections` is enabled on the emitter.
It is possible to use `events.captureRejectionSymbol` in
place of `Symbol.for('nodejs.rejection')`.

```js
import { EventEmitter, captureRejectionSymbol } from 'node:events';

class MyClass extends EventEmitter {
  constructor() {
    super({ captureRejections: true });
  }

  [captureRejectionSymbol](err, event, ...args) {
    console.log('rejection happened for', event, 'with', err, ...args);
    this.destroy(err);
  }

  destroy(err) {
    // Tear the resource down here.
  }
}
```

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `Error` |
| `event` | `string` \| `symbol` |
| ...`args` | `any`[] |

#### Returns

`void`

#### Since

v13.4.0, v12.16.0

#### Inherited from

```ts
EventEmitter.[captureRejectionSymbol]
```

***

### addListener()

```ts
addListener<E>(eventName, listener): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:123

Alias for `emitter.on(eventName, listener)`.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` \| `symbol` |
| `listener` | (...`args`) => `void` |

#### Returns

`this`

#### Since

v0.1.26

#### Inherited from

```ts
EventEmitter.addListener
```

***

### emit()

```ts
emit<K>(event, payload): boolean;
```

Defined in: [packages/core/src/scheduler/monque.ts:1589](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L1589)

Type-safe event emitter methods

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* keyof [`MonqueEventMap`](/api/interfaces/monqueeventmap/) |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `K` |
| `payload` | [`MonqueEventMap`](/api/interfaces/monqueeventmap/)\[`K`\] |

#### Returns

`boolean`

#### Overrides

```ts
EventEmitter.emit
```

***

### enqueue()

```ts
enqueue<T>(
   name, 
   data, 
options): Promise<PersistedJob<T>>;
```

Defined in: [packages/core/src/scheduler/monque.ts:370](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L370)

Enqueue a job for processing.

Jobs are stored in MongoDB and processed by registered workers. Supports
delayed execution via `runAt` and deduplication via `uniqueKey`.

When a `uniqueKey` is provided, only one pending or processing job with that key
can exist. Completed or failed jobs don't block new jobs with the same key.

Failed jobs are automatically retried with exponential backoff up to `maxRetries`
(default: 10 attempts). The delay between retries is calculated as `2^failCount × baseRetryInterval`.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The job data payload type (must be JSON-serializable) |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Job type identifier, must match a registered worker |
| `data` | `T` | Job payload, will be passed to the worker handler |
| `options` | [`EnqueueOptions`](/api/interfaces/enqueueoptions/) | Scheduling and deduplication options |

#### Returns

`Promise`\<[`PersistedJob`](/api/type-aliases/persistedjob/)\<`T`\>\>

Promise resolving to the created or existing job document

#### Throws

If database operation fails or scheduler not initialized

#### Examples

```typescript
await monque.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.'
});
```

```typescript
const oneHourLater = new Date(Date.now() + 3600000);
await monque.enqueue('reminder', { message: 'Check in!' }, {
  runAt: oneHourLater
});
```

```typescript
await monque.enqueue('sync-user', { userId: '123' }, {
  uniqueKey: 'sync-user-123'
});
// Subsequent enqueues with same uniqueKey return existing pending/processing job
```

***

### eventNames()

```ts
eventNames(): (string | symbol)[];
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:185

Returns an array listing the events for which the emitter has registered
listeners.

```js
import { EventEmitter } from 'node:events';

const myEE = new EventEmitter();
myEE.on('foo', () => {});
myEE.on('bar', () => {});

const sym = Symbol('symbol');
myEE.on(sym, () => {});

console.log(myEE.eventNames());
// Prints: [ 'foo', 'bar', Symbol(symbol) ]
```

#### Returns

(`string` \| `symbol`)[]

#### Since

v6.0.0

#### Inherited from

```ts
EventEmitter.eventNames
```

***

### getJob()

```ts
getJob<T>(id): Promise<PersistedJob<T> | null>;
```

Defined in: [packages/core/src/scheduler/monque.ts:1019](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L1019)

Get a single job by its MongoDB ObjectId.

Useful for retrieving job details when you have a job ID from events,
logs, or stored references.

#### Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| `T` | `unknown` | The expected type of the job data payload |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `id` | `ObjectId` | The job's ObjectId |

#### Returns

`Promise`\<[`PersistedJob`](/api/type-aliases/persistedjob/)\<`T`\> \| `null`\>

Promise resolving to the job if found, null otherwise

#### Throws

If scheduler not initialized

#### Examples

```typescript
monque.on('job:fail', async ({ job }) => {
  // Later, retrieve the job to check its status
  const currentJob = await monque.getJob(job._id);
  console.log(`Job status: ${currentJob?.status}`);
});
```

```typescript
app.get('/jobs/:id', async (req, res) => {
  const job = await monque.getJob(new ObjectId(req.params.id));
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});
```

***

### getJobs()

```ts
getJobs<T>(filter): Promise<PersistedJob<T>[]>;
```

Defined in: [packages/core/src/scheduler/monque.ts:950](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L950)

Query jobs from the queue with optional filters.

Provides read-only access to job data for monitoring, debugging, and
administrative purposes. Results are ordered by `nextRunAt` ascending.

#### Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| `T` | `unknown` | The expected type of the job data payload |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `filter` | [`GetJobsFilter`](/api/interfaces/getjobsfilter/) | Optional filter criteria |

#### Returns

`Promise`\<[`PersistedJob`](/api/type-aliases/persistedjob/)\<`T`\>[]\>

Promise resolving to array of matching jobs

#### Throws

If scheduler not initialized

#### Examples

```typescript
const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
console.log(`${pendingJobs.length} jobs waiting`);
```

```typescript
const failedEmails = await monque.getJobs({
  name: 'send-email',
  status: JobStatus.FAILED,
});
for (const job of failedEmails) {
  console.error(`Job ${job._id} failed: ${job.failReason}`);
}
```

```typescript
const page1 = await monque.getJobs({ limit: 50, skip: 0 });
const page2 = await monque.getJobs({ limit: 50, skip: 50 });
```

```typescript
import { isPendingJob, isRecurringJob } from '@monque/core';

const jobs = await monque.getJobs();
const pendingRecurring = jobs.filter(job => isPendingJob(job) && isRecurringJob(job));
```

***

### getMaxListeners()

```ts
getMaxListeners(): number;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:192

Returns the current max listener value for the `EventEmitter` which is either
set by `emitter.setMaxListeners(n)` or defaults to
`events.defaultMaxListeners`.

#### Returns

`number`

#### Since

v1.0.0

#### Inherited from

```ts
EventEmitter.getMaxListeners
```

***

### initialize()

```ts
initialize(): Promise<void>;
```

Defined in: [packages/core/src/scheduler/monque.ts:203](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L203)

Initialize the scheduler by setting up the MongoDB collection and indexes.
Must be called before start().

#### Returns

`Promise`\<`void`\>

#### Throws

If collection or index creation fails

***

### isHealthy()

```ts
isHealthy(): boolean;
```

Defined in: [packages/core/src/scheduler/monque.ts:904](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L904)

Check if the scheduler is healthy (running and connected).

Returns `true` when the scheduler is started, initialized, and has an active
MongoDB collection reference. Useful for health check endpoints and monitoring.

A healthy scheduler:
- Has called `initialize()` successfully
- Has called `start()` and is actively polling
- Has a valid MongoDB collection reference

#### Returns

`boolean`

`true` if scheduler is running and connected, `false` otherwise

#### Examples

```typescript
app.get('/health', (req, res) => {
  const healthy = monque.isHealthy();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unavailable',
    scheduler: healthy,
    timestamp: new Date().toISOString()
  });
});
```

```typescript
app.get('/readyz', (req, res) => {
  if (monque.isHealthy() && dbConnected) {
    res.status(200).send('ready');
  } else {
    res.status(503).send('not ready');
  }
});
```

```typescript
setInterval(() => {
  if (!monque.isHealthy()) {
    logger.error('Scheduler unhealthy');
    metrics.increment('scheduler.unhealthy');
  }
}, 60000); // Check every minute
```

***

### listenerCount()

```ts
listenerCount<E>(eventName, listener?): number;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:201

Returns the number of listeners listening for the event named `eventName`.
If `listener` is provided, it will return how many times the listener is found
in the list of the listeners of the event.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `eventName` | `string` \| `symbol` | The name of the event being listened for |
| `listener?` | (...`args`) => `void` | The event handler function |

#### Returns

`number`

#### Since

v3.2.0

#### Inherited from

```ts
EventEmitter.listenerCount
```

***

### listeners()

```ts
listeners<E>(eventName): (...args) => void[];
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:214

Returns a copy of the array of listeners for the event named `eventName`.

```js
server.on('connection', (stream) => {
  console.log('someone connected!');
});
console.log(util.inspect(server.listeners('connection')));
// Prints: [ [Function] ]
```

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` \| `symbol` |

#### Returns

(...`args`) => `void`[]

#### Since

v0.1.26

#### Inherited from

```ts
EventEmitter.listeners
```

***

### now()

```ts
now<T>(name, data): Promise<PersistedJob<T>>;
```

Defined in: [packages/core/src/scheduler/monque.ts:464](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L464)

Enqueue a job for immediate processing.

Convenience method equivalent to `enqueue(name, data, { runAt: new Date() })`.
Jobs are picked up on the next poll cycle (typically within 1 second based on `pollInterval`).

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The job data payload type (must be JSON-serializable) |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Job type identifier, must match a registered worker |
| `data` | `T` | Job payload, will be passed to the worker handler |

#### Returns

`Promise`\<[`PersistedJob`](/api/type-aliases/persistedjob/)\<`T`\>\>

Promise resolving to the created job document

#### Throws

If database operation fails or scheduler not initialized

#### Examples

```typescript
await monque.now('send-email', {
  to: 'admin@example.com',
  subject: 'Alert',
  body: 'Immediate attention required'
});
```

```typescript
const order = await createOrder(data);
await monque.now('process-order', { orderId: order.id });
return order; // Return immediately, processing happens async
```

***

### off()

```ts
off<K>(event, listener): this;
```

Defined in: [packages/core/src/scheduler/monque.ts:1607](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L1607)

Alias for `emitter.removeListener()`.

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* keyof [`MonqueEventMap`](/api/interfaces/monqueeventmap/) |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `K` |
| `listener` | (`payload`) => `void` |

#### Returns

`this`

#### Since

v10.0.0

#### Overrides

```ts
EventEmitter.off
```

***

### on()

```ts
on<K>(event, listener): this;
```

Defined in: [packages/core/src/scheduler/monque.ts:1593](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L1593)

Adds the `listener` function to the end of the listeners array for the
event named `eventName`. No checks are made to see if the `listener` has
already been added. Multiple calls passing the same combination of `eventName`
and `listener` will result in the `listener` being added, and called, multiple
times.

```js
server.on('connection', (stream) => {
  console.log('someone connected!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

By default, event listeners are invoked in the order they are added. The
`emitter.prependListener()` method can be used as an alternative to add the
event listener to the beginning of the listeners array.

```js
import { EventEmitter } from 'node:events';
const myEE = new EventEmitter();
myEE.on('foo', () => console.log('a'));
myEE.prependListener('foo', () => console.log('b'));
myEE.emit('foo');
// Prints:
//   b
//   a
```

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* keyof [`MonqueEventMap`](/api/interfaces/monqueeventmap/) |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event` | `K` | - |
| `listener` | (`payload`) => `void` | The callback function |

#### Returns

`this`

#### Since

v0.1.101

#### Overrides

```ts
EventEmitter.on
```

***

### once()

```ts
once<K>(event, listener): this;
```

Defined in: [packages/core/src/scheduler/monque.ts:1600](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L1600)

Adds a **one-time** `listener` function for the event named `eventName`. The
next time `eventName` is triggered, this listener is removed and then invoked.

```js
server.once('connection', (stream) => {
  console.log('Ah, we have our first user!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

By default, event listeners are invoked in the order they are added. The
`emitter.prependOnceListener()` method can be used as an alternative to add the
event listener to the beginning of the listeners array.

```js
import { EventEmitter } from 'node:events';
const myEE = new EventEmitter();
myEE.once('foo', () => console.log('a'));
myEE.prependOnceListener('foo', () => console.log('b'));
myEE.emit('foo');
// Prints:
//   b
//   a
```

#### Type Parameters

| Type Parameter |
| ------ |
| `K` *extends* keyof [`MonqueEventMap`](/api/interfaces/monqueeventmap/) |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event` | `K` | - |
| `listener` | (`payload`) => `void` | The callback function |

#### Returns

`this`

#### Since

v0.3.0

#### Overrides

```ts
EventEmitter.once
```

***

### prependListener()

```ts
prependListener<E>(eventName, listener): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:303

Adds the `listener` function to the _beginning_ of the listeners array for the
event named `eventName`. No checks are made to see if the `listener` has
already been added. Multiple calls passing the same combination of `eventName`
and `listener` will result in the `listener` being added, and called, multiple
times.

```js
server.prependListener('connection', (stream) => {
  console.log('someone connected!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`) => `void` | The callback function |

#### Returns

`this`

#### Since

v6.0.0

#### Inherited from

```ts
EventEmitter.prependListener
```

***

### prependOnceListener()

```ts
prependOnceListener<E>(eventName, listener): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:320

Adds a **one-time** `listener` function for the event named `eventName` to the
_beginning_ of the listeners array. The next time `eventName` is triggered, this
listener is removed, and then invoked.

```js
server.prependOnceListener('connection', (stream) => {
  console.log('Ah, we have our first user!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`) => `void` | The callback function |

#### Returns

`this`

#### Since

v6.0.0

#### Inherited from

```ts
EventEmitter.prependOnceListener
```

***

### rawListeners()

```ts
rawListeners<E>(eventName): (...args) => void[];
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:351

Returns a copy of the array of listeners for the event named `eventName`,
including any wrappers (such as those created by `.once()`).

```js
import { EventEmitter } from 'node:events';
const emitter = new EventEmitter();
emitter.once('log', () => console.log('log once'));

// Returns a new Array with a function `onceWrapper` which has a property
// `listener` which contains the original listener bound above
const listeners = emitter.rawListeners('log');
const logFnWrapper = listeners[0];

// Logs "log once" to the console and does not unbind the `once` event
logFnWrapper.listener();

// Logs "log once" to the console and removes the listener
logFnWrapper();

emitter.on('log', () => console.log('log persistently'));
// Will return a new Array with a single function bound by `.on()` above
const newListeners = emitter.rawListeners('log');

// Logs "log persistently" twice
newListeners[0]();
emitter.emit('log');
```

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` \| `symbol` |

#### Returns

(...`args`) => `void`[]

#### Since

v9.4.0

#### Inherited from

```ts
EventEmitter.rawListeners
```

***

### removeAllListeners()

```ts
removeAllListeners<E>(eventName?): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:362

Removes all listeners, or those of the specified `eventName`.

It is bad practice to remove listeners added elsewhere in the code,
particularly when the `EventEmitter` instance was created by some other
component or module (e.g. sockets or file streams).

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName?` | `string` \| `symbol` |

#### Returns

`this`

#### Since

v0.1.26

#### Inherited from

```ts
EventEmitter.removeAllListeners
```

***

### removeListener()

```ts
removeListener<E>(eventName, listener): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:449

Removes the specified `listener` from the listener array for the event named
`eventName`.

```js
const callback = (stream) => {
  console.log('someone connected!');
};
server.on('connection', callback);
// ...
server.removeListener('connection', callback);
```

`removeListener()` will remove, at most, one instance of a listener from the
listener array. If any single listener has been added multiple times to the
listener array for the specified `eventName`, then `removeListener()` must be
called multiple times to remove each instance.

Once an event is emitted, all listeners attached to it at the
time of emitting are called in order. This implies that any
`removeListener()` or `removeAllListeners()` calls _after_ emitting and
_before_ the last listener finishes execution will not remove them from
`emit()` in progress. Subsequent events behave as expected.

```js
import { EventEmitter } from 'node:events';
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const callbackA = () => {
  console.log('A');
  myEmitter.removeListener('event', callbackB);
};

const callbackB = () => {
  console.log('B');
};

myEmitter.on('event', callbackA);

myEmitter.on('event', callbackB);

// callbackA removes listener callbackB but it will still be called.
// Internal listener array at time of emit [callbackA, callbackB]
myEmitter.emit('event');
// Prints:
//   A
//   B

// callbackB is now removed.
// Internal listener array [callbackA]
myEmitter.emit('event');
// Prints:
//   A
```

Because listeners are managed using an internal array, calling this will
change the position indexes of any listener registered _after_ the listener
being removed. This will not impact the order in which listeners are called,
but it means that any copies of the listener array as returned by
the `emitter.listeners()` method will need to be recreated.

When a single function has been added as a handler multiple times for a single
event (as in the example below), `removeListener()` will remove the most
recently added instance. In the example the `once('ping')`
listener is removed:

```js
import { EventEmitter } from 'node:events';
const ee = new EventEmitter();

function pong() {
  console.log('pong');
}

ee.on('ping', pong);
ee.once('ping', pong);
ee.removeListener('ping', pong);

ee.emit('ping');
ee.emit('ping');
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Type Parameters

| Type Parameter |
| ------ |
| `E` *extends* `string` \| `symbol` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` \| `symbol` |
| `listener` | (...`args`) => `void` |

#### Returns

`this`

#### Since

v0.1.26

#### Inherited from

```ts
EventEmitter.removeListener
```

***

### schedule()

```ts
schedule<T>(
   cron, 
   name, 
   data, 
options): Promise<PersistedJob<T>>;
```

Defined in: [packages/core/src/scheduler/monque.ts:512](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L512)

Schedule a recurring job with a cron expression.

Creates a job that automatically re-schedules itself based on the cron pattern.
Uses standard 5-field cron format: minute, hour, day of month, month, day of week.
Also supports predefined expressions like `@daily`, `@weekly`, `@monthly`, etc.
After successful completion, the job is reset to `pending` status and scheduled
for its next run based on the cron expression.

When a `uniqueKey` is provided, only one pending or processing job with that key
can exist. This prevents duplicate scheduled jobs on application restart.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The job data payload type (must be JSON-serializable) |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `cron` | `string` | Cron expression (5 fields or predefined expression) |
| `name` | `string` | Job type identifier, must match a registered worker |
| `data` | `T` | Job payload, will be passed to the worker handler on each run |
| `options` | [`ScheduleOptions`](/api/interfaces/scheduleoptions/) | Scheduling options (uniqueKey for deduplication) |

#### Returns

`Promise`\<[`PersistedJob`](/api/type-aliases/persistedjob/)\<`T`\>\>

Promise resolving to the created job document with `repeatInterval` set

#### Throws

If cron expression is invalid

#### Throws

If database operation fails or scheduler not initialized

#### Examples

```typescript
await monque.schedule('0 * * * *', 'cleanup-temp-files', {
  directory: '/tmp/uploads'
});
```

```typescript
await monque.schedule('0 * * * *', 'hourly-report', { type: 'sales' }, {
  uniqueKey: 'hourly-report-sales'
});
// Subsequent calls with same uniqueKey return existing pending/processing job
```

```typescript
await monque.schedule('@daily', 'daily-report', {
  reportType: 'sales',
  recipients: ['analytics@example.com']
});
```

***

### setMaxListeners()

```ts
setMaxListeners(n): this;
```

Defined in: node\_modules/.bun/@types+node@25.0.2/node\_modules/@types/node/events.d.ts:460

By default `EventEmitter`s will print a warning if more than `10` listeners are
added for a particular event. This is a useful default that helps finding
memory leaks. The `emitter.setMaxListeners()` method allows the limit to be
modified for this specific `EventEmitter` instance. The value can be set to
`Infinity` (or `0`) to indicate an unlimited number of listeners.

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `n` | `number` |

#### Returns

`this`

#### Since

v0.3.5

#### Inherited from

```ts
EventEmitter.setMaxListeners
```

***

### start()

```ts
start(): void;
```

Defined in: [packages/core/src/scheduler/monque.ts:714](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L714)

Start polling for and processing jobs.

Begins polling MongoDB at the configured interval (default: 1 second) to pick up
pending jobs and dispatch them to registered workers. Must call `initialize()` first.
Workers can be registered before or after calling `start()`.

Jobs are processed concurrently up to each worker's configured concurrency limit.
The scheduler continues running until `stop()` is called.

#### Returns

`void`

#### Examples

```typescript
const monque = new Monque(db);
await monque.initialize();

monque.worker('send-email', emailHandler);
monque.worker('process-order', orderHandler);

monque.start(); // Begin processing jobs
```

```typescript
monque.on('job:start', (job) => {
  logger.info(`Starting job ${job.name}`);
});

monque.on('job:complete', ({ job, duration }) => {
  metrics.recordJobDuration(job.name, duration);
});

monque.on('job:fail', ({ job, error, willRetry }) => {
  logger.error(`Job ${job.name} failed:`, error);
  if (!willRetry) {
    alerting.sendAlert(`Job permanently failed: ${job.name}`);
  }
});

monque.start();
```

#### Throws

If scheduler not initialized (call `initialize()` first)

***

### stop()

```ts
stop(): Promise<void>;
```

Defined in: [packages/core/src/scheduler/monque.ts:780](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L780)

Stop the scheduler gracefully, waiting for in-progress jobs to complete.

Stops polling for new jobs and waits for all active jobs to finish processing.
Times out after the configured `shutdownTimeout` (default: 30 seconds), emitting
a `job:error` event with a `ShutdownTimeoutError` containing incomplete jobs.

It's safe to call `stop()` multiple times - subsequent calls are no-ops if already stopped.

#### Returns

`Promise`\<`void`\>

Promise that resolves when all jobs complete or timeout is reached

#### Examples

```typescript
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await monque.stop(); // Wait for jobs to complete
  await mongoClient.close();
  process.exit(0);
});
```

```typescript
monque.on('job:error', ({ error }) => {
  if (error.name === 'ShutdownTimeoutError') {
    logger.warn('Forced shutdown after timeout:', error.incompleteJobs);
  }
});

await monque.stop();
```

***

### worker()

```ts
worker<T>(
   name, 
   handler, 
   options): void;
```

Defined in: [packages/core/src/scheduler/monque.ts:653](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/monque.ts#L653)

Register a worker to process jobs of a specific type.

Workers can be registered before or after calling `start()`. Each worker
processes jobs concurrently up to its configured concurrency limit (default: 5).

The handler function receives the full job object including metadata (`_id`, `status`,
`failCount`, etc.). If the handler throws an error, the job is retried with exponential
backoff up to `maxRetries` times. After exhausting retries, the job is marked as `failed`.

Events are emitted during job processing: `job:start`, `job:complete`, `job:fail`, and `job:error`.

**Duplicate Registration**: By default, registering a worker for a job name that already has
a worker will throw a `WorkerRegistrationError`. This fail-fast behavior prevents accidental
replacement of handlers. To explicitly replace a worker, pass `{ replace: true }`.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The job data payload type for type-safe access to `job.data` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Job type identifier to handle |
| `handler` | [`JobHandler`](/api/type-aliases/jobhandler/)\<`T`\> | Async function to execute for each job |
| `options` | [`WorkerOptions`](/api/interfaces/workeroptions/) | Worker configuration |

#### Returns

`void`

#### Throws

When a worker is already registered for `name` and `replace` is not `true`

#### Examples

```typescript
interface EmailJob {
  to: string;
  subject: string;
  body: string;
}

monque.worker<EmailJob>('send-email', async (job) => {
  await emailService.send(job.data.to, job.data.subject, job.data.body);
});
```

```typescript
// Limit to 2 concurrent video processing jobs (resource-intensive)
monque.worker('process-video', async (job) => {
  await videoProcessor.transcode(job.data.videoId);
}, { concurrency: 2 });
```

```typescript
// Replace the existing handler for 'send-email'
monque.worker('send-email', newEmailHandler, { replace: true });
```

```typescript
monque.worker('sync-user', async (job) => {
  try {
    await externalApi.syncUser(job.data.userId);
  } catch (error) {
    // Job will retry with exponential backoff
    // Delay = 2^failCount × baseRetryInterval (default: 1000ms)
    throw new Error(`Sync failed: ${error.message}`);
  }
});
```
