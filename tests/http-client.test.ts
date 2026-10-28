import { createServer } from "node:http";

import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { HttpClient } from "effect/http";

import { noRedirectHttpClientLayer } from "../src/http-client.js";

const decodeAddress = Schema.decodeUnknownSync(
  Schema.Struct({ port: Schema.Int })
);

it.effect("never follows a redirect", () =>
  Effect.gen(function* () {
    let followed = 0;

    const server = createServer((request, response) => {
      if (request.url === "/start") {
        response.writeHead(302, { Location: "/target" }).end();

        return;
      }

      followed += 1;
      response.end("followed");
    });

    yield* Effect.acquireRelease(
      Effect.callback<undefined>((resume) => {
        server.listen(0, "127.0.0.1", () => {
          resume(Effect.undefined);
        });
      }),
      () =>
        Effect.callback<undefined>((resume) => {
          server.close(() => {
            resume(Effect.undefined);
          });
        })
    );
    const { port } = decodeAddress(server.address());

    const response = yield* HttpClient.get(`http://127.0.0.1:${port}/start`);
    assert.strictEqual(response.status, 302);
    assert.strictEqual(followed, 0);
  }).pipe(Effect.scoped, Effect.provide(noRedirectHttpClientLayer))
);
