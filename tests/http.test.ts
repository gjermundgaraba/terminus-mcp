import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { send, serve } from "./fake.js";

const noTerminus = () => assert.fail("No Terminus request expected");

const Discovery = Schema.Struct({
  result: Schema.Struct({
    capabilities: Schema.Struct({ tools: Schema.Json }),
  }),
});

const decodeRefusal = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.Struct({ code: Schema.Int }) })
  )
);

const decodeRefusalEvent = (eventStream: string) =>
  decodeRefusal(eventStream.replace(/^data: /mu, ""));

const listTools = (origin: string) =>
  Effect.map(
    send("tools/list", undefined, { origin }),
    (response) => response.status
  );

const start = (environment: Record<string, string>) =>
  Effect.flip(Layer.build(serve(noTerminus, environment))).pipe(
    Effect.map(String)
  );

it.effect("serves a health check beside the MCP endpoint", () =>
  Effect.gen(function* () {
    const health = yield* HttpClient.get("/healthz");
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(yield* health.json, { status: "ok" });

    assert.strictEqual((yield* send("tools/list")).status, 200);
  }).pipe(Effect.provide(serve(noTerminus)))
);

it.effect("advertises no tool-list changes and refuses subscriptions", () =>
  Effect.gen(function* () {
    const discovered = yield* HttpClientResponse.schemaBodyJson(Discovery)(
      yield* send("server/discover")
    );

    assert.deepStrictEqual(discovered.result.capabilities.tools, {
      listChanged: false,
    });

    const listen = yield* send("subscriptions/listen", {
      notifications: { toolsListChanged: true },
    });

    const event = decodeRefusalEvent(yield* listen.text);
    assert.strictEqual(event.error.code, -32_601);
  }).pipe(Effect.provide(serve(noTerminus)))
);

it.effect("admits only the configured browser origins", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* listTools("https://attacker.test"), 403);
    assert.strictEqual(yield* listTools("https://ui.example.test"), 200);
    assert.strictEqual(yield* listTools("https://ui.example.test:8443"), 403);
  }).pipe(
    Effect.provide(
      serve(noTerminus, {
        MCP_ALLOWED_ORIGINS: "https://ui.example.test, https://other.test",
      })
    )
  )
);

it.effect("refuses to start on an unusable URL setting", () =>
  Effect.gen(function* () {
    assert.match(
      yield* start({ TERMINUS_URL: "ftp://terminus.example.test" }),
      /TERMINUS_URL must use HTTP or HTTPS/u
    );
    assert.match(
      yield* start({ TERMINUS_URL: "https://user:pass@terminus.example.test" }),
      /TERMINUS_URL must not contain credentials/u
    );
    assert.match(
      yield* start({
        MCP_ALLOWED_ORIGINS: "https://ui.example.test, https://other.test/",
      }),
      /MCP_ALLOWED_ORIGINS entries must be exact origins/u
    );
  }).pipe(Effect.scoped)
);
