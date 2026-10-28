import { Data, Effect, Layer, Stream } from "effect";
import { FetchHttpClient, HttpClientResponse } from "effect/http";

export const noRedirectHttpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })
  )
);

export class Unacceptable extends Data.TaggedError("Unacceptable")<{
  readonly reason: "type" | "size";
}> {}

export const download = (
  response: HttpClientResponse.HttpClientResponse,
  accepts: (type: string) => boolean,
  maximumBytes: number
) =>
  Effect.gen(function* () {
    const ok = yield* HttpClientResponse.filterStatusOk(response);
    const type = ok.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";

    if (!accepts(type)) {
      return yield* new Unacceptable({ reason: "type" });
    }

    const { chunks, size } = yield* ok.stream.pipe(
      Stream.runFoldEffect(
        () => ({ chunks: Array.of<Uint8Array>(), size: 0 }),
        (read, chunk) => {
          read.chunks.push(chunk);
          read.size += chunk.byteLength;

          return read.size > maximumBytes
            ? Effect.fail(new Unacceptable({ reason: "size" }))
            : Effect.succeed(read);
        }
      )
    );

    const body = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { type, body };
  });
