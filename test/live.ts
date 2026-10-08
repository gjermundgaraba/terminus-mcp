import assert from "node:assert/strict";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, flow, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Action from "@gjermundgaraba/effect-actions/Action";

import { httpClientLayer } from "../src/http-client.js";
import { actions, services } from "../src/server.js";
import { terminusConfig } from "../src/terminus/client.js";
import { type FrameworkContext, Tokens } from "../src/terminus/contracts.js";

const created: { screen?: number; playlist?: number } = {};

const verify = Effect.gen(function* () {
  const terminus = yield* Action.client(actions);

  const { context } = yield* terminus.get_display_context();
  const { device, model, framework } = context;
  const originalPlaylistId = device.playlist_id;
  assert.ok(
    originalPlaylistId !== null,
    "The live device needs an existing playlist for a no-op assignment test",
  );

  yield* terminus.list_screens({ model_id: model.id });
  yield* terminus.list_playlists();
  const { docs: entryPoints } = yield* terminus.search_screen_docs();
  assert.ok(entryPoints.some(({ id }) => id === "terminus:screen-authoring"));
  yield* terminus.read_screen_doc({ doc_id: "terminus:screen-authoring" });
  const { docs: structureDocs } = yield* terminus.search_screen_docs({ query: "structure" });
  const structureDoc = structureDocs[0];
  assert.ok(structureDoc);
  assert.match(structureDoc.id, /^framework:\d+\.\d+:structure$/);
  yield* terminus.read_screen_doc({ doc_id: structureDoc.id });

  const name = `terminus-mcp-verify-${Date.now().toString(36)}`;
  const { screen } = yield* terminus.create_screen({
    model_id: model.id,
    name,
    label: "Terminus MCP verification",
    html: verificationHtml(framework),
  });
  created.screen = screen.id;

  const { image } = yield* terminus.get_screen_image({ screen_id: screen.id });
  assert.match(image.mimeType, /^image\//);
  assert.ok(image.data.byteLength > 0, "The rendered image is empty");
  yield* terminus.update_screen({
    screen_id: screen.id,
    label: "Terminus MCP verification updated",
    html: verificationHtml(framework, true),
  });

  const saved = yield* terminus.save_playlist({
    name,
    label: "Terminus MCP verification",
    mode: "manual",
    screen_ids: [screen.id],
  });
  assert.equal(saved.action, "created");
  created.playlist = saved.playlist.id;

  const updated = yield* terminus.save_playlist({
    playlist_id: saved.playlist.id,
    name,
    label: "Terminus MCP verification updated",
    mode: "automatic",
    screen_ids: [screen.id],
  });
  assert.equal(updated.action, "updated");

  yield* terminus.assign_playlist({ device_id: device.id, playlist_id: originalPlaylistId });

  yield* Effect.logInfo("Live verification passed for all ten actions.");
});

/** Deletes what the run created, which no action can. */
const cleanup = Effect.gen(function* () {
  if (created.screen === undefined && created.playlist === undefined) return;

  const { baseUrl, login, password } = yield* terminusConfig;
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      flow(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.acceptJson),
    ),
    HttpClient.filterStatusOk,
  );

  const { access_token } = yield* http
    .execute(
      HttpClientRequest.post("login").pipe(
        HttpClientRequest.bodyJsonUnsafe({ login, password: Redacted.value(password) }),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Tokens)));

  for (const [collection, id] of [
    ["api/playlists", created.playlist],
    ["api/screens", created.screen],
  ] as const) {
    if (id === undefined) continue;
    yield* http.execute(
      HttpClientRequest.delete(`${collection}/${id}`).pipe(
        HttpClientRequest.setHeader("Authorization", access_token),
      ),
    );
  }
});

function verificationHtml(framework: FrameworkContext, updated = false): string {
  const style = Object.entries(framework.screen_variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${framework.css_url}">
<script src="${framework.javascript_url}"></script>
</head><body class="environment trmnl">
<div class="${framework.screen_classes.join(" ")}" style="${style}">
  <div class="view view--full">
    <div class="layout layout--col layout--center">
      <div class="title">Terminus MCP ${updated ? "updated" : "verified"}</div>
    </div>
  </div>
</div></body></html>`;
}

verify.pipe(
  Effect.scoped,
  Effect.ensuring(Effect.orDie(cleanup)),
  // The cleanup reads the HttpClient too.
  Effect.provide(Layer.provideMerge(services, httpClientLayer)),
  NodeRuntime.runMain,
);
