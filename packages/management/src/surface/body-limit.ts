import { ORPCError } from "@orpc/server";

export const createLimitedRequest = function createLimitedRequest(
  request: Request,
  maxBodySize: number,
): Request {
  const source = request.body;
  if (source === null) {
    return request;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let size = 0;
  let stopped = false;
  let abort: (() => void) | undefined;

  const releaseReader = function releaseReader(): void {
    if (abort) {
      request.signal.removeEventListener("abort", abort);
    }
    reader?.releaseLock();
  };

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- ReadableStream cancellation reasons are arbitrary values and must reach the original reader unchanged.
  const cancelReader = async function cancelReader(reason: unknown): Promise<void> {
    await reader?.cancel(reason).catch(() => {
      // Cancellation failure must not prevent releasing the stream reader lock.
    });
    releaseReader();
  };
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= source.getReader();
        abort ??= () => {
          stopped = true;
          controller.error(request.signal.reason);
          void cancelReader(request.signal.reason);
        };
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) {
          abort();
          return;
        }
        try {
          if (Number(request.headers.get("content-length")) > maxBodySize) {
            throw new ORPCError("PAYLOAD_TOO_LARGE");
          }
          const { done, value } = await reader.read();
          if (stopped) {
            return;
          }
          if (done) {
            releaseReader();
            controller.close();
            return;
          }
          size += value.byteLength;
          if (size > maxBodySize) {
            throw new ORPCError("PAYLOAD_TOO_LARGE");
          }
          controller.enqueue(value);
        } catch (error) {
          if (!stopped) {
            stopped = true;
            controller.error(error);
            await cancelReader(error);
          }
        }
      },
      async cancel(reason) {
        stopped = true;
        await cancelReader(reason);
      },
    },
    { highWaterMark: 0 },
  );

  const init: RequestInit & { duplex: "half" } = { body, duplex: "half" };
  return new Request(request, init);
};
