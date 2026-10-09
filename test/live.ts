import assert from "node:assert/strict";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, flow, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Action from "@gjermundgaraba/effect-actions/Action";

import { httpClientLayer } from "../src/http-client.js";
import { Actions, actions, services } from "../src/server.js";
import { terminusConfig } from "../src/terminus/client.js";
import { type FrameworkContext, Tokens } from "../src/terminus/contracts.js";

const created: { screen?: number; playlist?: number; extension?: number } = {};

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
    mode: "text",
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

  yield* terminus.delete_playlist({ playlist_id: saved.playlist.id });
  delete created.playlist;
  yield* terminus.delete_screen({ screen_id: screen.id });
  delete created.screen;

  // Terminus answers for each missing resource differently.
  for (const missing of [
    Effect.flip(terminus.get_screen_image({ screen_id: screen.id })),
    Effect.flip(terminus.delete_screen({ screen_id: screen.id })),
    Effect.flip(terminus.delete_playlist({ playlist_id: saved.playlist.id })),
  ]) {
    assert.match((yield* missing).message, /was not found/);
  }

  // Never built: no schedule, and no models or devices.
  const { extension } = yield* terminus.create_extension({
    name,
    label: "Terminus MCP verification",
    kind: "static",
    template: '<div class="{{ extension.css_classes }}">{{ source_1.title }}</div>',
    static_body: { title: "verified" },
  });
  created.extension = extension.id;
  const { extensions } = yield* terminus.list_extensions();
  assert.ok(extensions.some(({ id }) => id === extension.id));

  // A label alone still carries the schedule, so the extension is never empty.
  const renamed = yield* terminus.update_extension({
    extension_id: extension.id,
    label: "Terminus MCP verification updated",
  });
  assert.equal(renamed.extension.unit, "none");
  const scheduled = yield* terminus.update_extension({
    extension_id: extension.id,
    unit: "hour",
    interval: 1,
  });
  assert.equal(scheduled.extension.unit, "hour");
  assert.equal(scheduled.extension.label, "Terminus MCP verification updated");
  yield* terminus.update_extension({ extension_id: extension.id, unit: "none" });

  const { baseUrl } = yield* terminusConfig;
  const { exchange } = yield* terminus.create_extension_exchange({
    extension_id: extension.id,
    template: new URL("up", baseUrl).href,
    headers: { "X-Verification": "never returned" },
  });
  assert.deepEqual(exchange.header_names, ["X-Verification"]);
  yield* terminus.update_extension_exchange({
    extension_id: extension.id,
    exchange_id: exchange.id,
    verb: "get",
  });
  const detail = yield* terminus.get_extension({ extension_id: extension.id });
  assert.equal(detail.extension.label, "Terminus MCP verification updated");
  assert.deepEqual(
    detail.exchanges.map(({ id }) => id),
    [exchange.id],
  );
  assert.doesNotMatch(JSON.stringify(detail), /never returned/);

  const exchangeRef = { extension_id: extension.id, exchange_id: exchange.id };
  yield* terminus.delete_extension_exchange(exchangeRef);
  yield* terminus.delete_extension({ extension_id: extension.id });
  delete created.extension;

  for (const missing of [
    Effect.flip(terminus.get_extension({ extension_id: extension.id })),
    Effect.flip(terminus.update_extension({ extension_id: extension.id, label: "Gone" })),
    Effect.flip(terminus.delete_extension({ extension_id: extension.id })),
    Effect.flip(terminus.update_extension_exchange({ ...exchangeRef, verb: "get" })),
    Effect.flip(terminus.delete_extension_exchange(exchangeRef)),
  ]) {
    assert.match((yield* missing).message, /was not found/);
  }

  yield* Effect.logInfo(`Live verification passed for all ${Actions.length} actions.`);
});

/** Deletes what a failed run created, without the actions that may have failed it. */
const cleanup = Effect.gen(function* () {
  if (Object.values(created).every((id) => id === undefined)) return;

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

  // Deleting the extension deletes its exchanges.
  for (const [collection, id] of [
    ["api/extensions", created.extension],
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
