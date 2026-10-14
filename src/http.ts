#!/usr/bin/env node

import { createServer } from "node:http";

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { ByteSize, Config, Effect, Layer, Schema, SchemaTransformation } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ActionMcp from "@gjermundgaraba/effect-actions/ActionMcp";

import { httpClientLayer } from "./http-client.js";
import { actions, server, services } from "./server.js";

/** One entry of MCP_ALLOWED_ORIGINS, compared exactly with a request's Origin. */
const Origin = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Trimmed.check(
      Schema.makeFilter((value) => URL.canParse(value) && new URL(value).origin === value, {
        message:
          "MCP_ALLOWED_ORIGINS entries must be exact origins, such as https://ui.example.com",
      }),
    ),
    SchemaTransformation.trim(),
  ),
);

/**
 * The MCP endpoint at /mcp and the container health check at /healthz. Neither authenticates
 * its caller, so the server belongs on an access-controlled network.
 */
export const routes = Layer.unwrap(
  Effect.gen(function* () {
    const allowedOrigins = yield* Config.Array(Origin, "MCP_ALLOWED_ORIGINS").pipe(
      Config.withDefault([]),
    );

    return Layer.mergeAll(
      ActionMcp.layerHttp(actions, { ...server, allowedOrigins }),
      HttpRouter.add("GET", "/healthz", HttpServerResponse.jsonUnsafe({ status: "ok" })),
    );
  }),
);

export const main = Layer.unwrap(
  Effect.gen(function* () {
    const host = yield* Config.String("MCP_HOST").pipe(Config.withDefault("127.0.0.1"));
    const port = yield* Config.Port("MCP_PORT").pipe(Config.withDefault(8002));

    return HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { host, port })),
      // A screen's html is up to 1,000,000 characters, at most six bytes each once JSON-escaped.
      Layer.provide(Layer.succeed(HttpServerRequest.MaxBodySize, ByteSize.mebibytes(8))),
      Layer.provide(Layer.provide(services, httpClientLayer)),
    );
  }),
);

if (import.meta.main) {
  Layer.launch(main).pipe(NodeRuntime.runMain);
}
