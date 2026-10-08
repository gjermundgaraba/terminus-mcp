import { Data, Effect, Layer, Stream } from "effect";
import { FetchHttpClient, HttpClientResponse } from "effect/http";

/**
 * The process's HttpClient: fetch that never follows a redirect, which is an answer, never a
 * second request. Followed, one could carry the Terminus access token to another origin, or
 * take a documentation fetch outside the TRMNL allowlist.
 */
export const httpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
);

/** A download refused for its content type, or for exceeding its size limit. */
export class Unacceptable extends Data.TaggedError("Unacceptable")<{
  readonly reason: "type" | "size";
}> {}

/**
 * A successful response's media type and body, read only while it stays within `maximumBytes`,
 * whatever its `Content-Length` says.
 */
export const download = (
  response: HttpClientResponse.HttpClientResponse,
  accepts: (type: string) => boolean,
  maximumBytes: number,
) =>
  Effect.gen(function* () {
    const ok = yield* HttpClientResponse.filterStatusOk(response);
    const type = ok.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";
    if (!accepts(type)) return yield* new Unacceptable({ reason: "type" });

    const { chunks, size } = yield* ok.stream.pipe(
      Stream.runFoldEffect(
        () => ({ chunks: [] as Array<Uint8Array>, size: 0 }),
        (read, chunk) => {
          read.chunks.push(chunk);
          read.size += chunk.byteLength;
          return read.size > maximumBytes
            ? Effect.fail(new Unacceptable({ reason: "size" }))
            : Effect.succeed(read);
        },
      ),
    );

    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { type, body };
  });
