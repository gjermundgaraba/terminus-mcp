import { createServer } from "node:http";

import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient } from "effect/http";

import { httpClientLayer } from "../src/http-client.js";

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
      Effect.callback<void>((resume) => {
        server.listen(0, "127.0.0.1", () => resume(Effect.void));
      }),
      () =>
        Effect.callback<void>((resume) => {
          server.close(() => resume(Effect.void));
        }),
    );
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");

    const response = yield* HttpClient.get(`http://127.0.0.1:${address.port}/start`);
    assert.strictEqual(response.status, 302);
    assert.strictEqual(followed, 0);
  }).pipe(Effect.scoped, Effect.provide(httpClientLayer)),
);
