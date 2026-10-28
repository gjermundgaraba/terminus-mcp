import assert from "node:assert/strict";

import { NodeRuntime } from "@effect/platform-node";
import * as Action from "@gjermundgaraba/effect-actions/Action";
import { Config, Effect, flow, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { noRedirectHttpClientLayer } from "../src/http-client.js";
import { Actions, actions, services } from "../src/server.js";
import { terminusConfig } from "../src/terminus/client.js";
import { Tokens } from "../src/terminus/contracts.js";
import type { FrameworkContext } from "../src/terminus/contracts.js";

interface Created {
  screen?: number;
  playlist?: number;
  extension?: number;
}

const created: Created = {};

const verificationHtml = (
  framework: FrameworkContext,
  updated = false
): string => {
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
};

const verify = Effect.gen(function* () {
  const terminus = yield* Action.client(actions);

  const deviceId = yield* Config.option(Config.Int("TERMINUS_DEVICE_ID"));

  const { context } = yield* terminus.get_display_context(
    Option.match(deviceId, {
      onNone: () => ({}),
      onSome: (device_id) => ({ device_id }),
    })
  );

  const { device, model, framework } = context;
  const originalPlaylistId = device.playlist_id;
  assert.ok(
    originalPlaylistId !== null,
    "The live device needs an existing playlist for a no-op assignment test"
  );

  yield* terminus.list_screens({ model_id: model.id });
  yield* terminus.list_playlists();
  const { docs: entryPoints } = yield* terminus.search_screen_docs();
  assert.ok(entryPoints.some(({ id }) => id === "terminus:screen-authoring"));
  yield* terminus.read_screen_doc({ doc_id: "terminus:screen-authoring" });

  const { docs: structureDocs } = yield* terminus.search_screen_docs({
    query: "structure",
  });

  const [structureDoc] = structureDocs;
  assert.ok(structureDoc);
  assert.match(structureDoc.id, /^framework:\d+\.\d+:structure$/u);
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
  assert.match(image.mimeType, /^image\//u);
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

  yield* terminus.assign_playlist({
    device_id: device.id,
    playlist_id: originalPlaylistId,
  });

  yield* terminus.delete_playlist({ playlist_id: saved.playlist.id });
  delete created.playlist;
  yield* terminus.delete_screen({ screen_id: screen.id });
  delete created.screen;

  // Terminus answers for each missing resource differently.
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/actions/api/screens/show.rb#L15-L19
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/actions/api/screens/delete.rb#L27
  // https://github.com/usetrmnl/terminus/blob/0.78.0/app/actions/api/playlists/delete.rb#L15-L20
  for (const missing of [
    Effect.flip(terminus.get_screen_image({ screen_id: screen.id })),
    Effect.flip(terminus.delete_screen({ screen_id: screen.id })),
    Effect.flip(terminus.delete_playlist({ playlist_id: saved.playlist.id })),
  ]) {
    assert.match((yield* missing).message, /was not found/u);
  }

  const { extension } = yield* terminus.create_extension({
    name,
    label: "Terminus MCP verification",
    kind: "static",
    template:
      '<div class="{{ extension.css_classes }}">{{ source_1.title }}</div>',
    static_body: { title: "verified" },
  });

  created.extension = extension.id;
  const { extensions } = yield* terminus.list_extensions();
  assert.ok(extensions.some(({ id }) => id === extension.id));

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
  yield* terminus.update_extension({
    extension_id: extension.id,
    unit: "none",
  });

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
    [exchange.id]
  );
  assert.doesNotMatch(JSON.stringify(detail), /never returned/u);

  const exchangeRef = { extension_id: extension.id, exchange_id: exchange.id };
  yield* terminus.delete_extension_exchange(exchangeRef);
  yield* terminus.delete_extension({ extension_id: extension.id });
  delete created.extension;

  for (const missing of [
    Effect.flip(terminus.get_extension({ extension_id: extension.id })),
    Effect.flip(
      terminus.update_extension({ extension_id: extension.id, label: "Gone" })
    ),
    Effect.flip(terminus.delete_extension({ extension_id: extension.id })),
    Effect.flip(
      terminus.update_extension_exchange({ ...exchangeRef, verb: "get" })
    ),
    Effect.flip(terminus.delete_extension_exchange(exchangeRef)),
  ]) {
    assert.match((yield* missing).message, /was not found/u);
  }

  yield* Effect.logInfo(
    `Live verification passed for all ${Actions.length} actions.`
  );
});

const deleteCreatedWithoutActions = Effect.gen(function* () {
  if (Object.values(created).every((id) => id === undefined)) {
    return;
  }

  const { baseUrl, login, password } = yield* terminusConfig;

  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      flow(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.acceptJson)
    ),
    HttpClient.filterStatusOk
  );

  const { access_token } = yield* http
    .execute(
      HttpClientRequest.post("login").pipe(
        HttpClientRequest.bodyJsonUnsafe({
          login,
          password: Redacted.value(password),
        })
      )
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Tokens)));

  // Deleting the extension deletes its exchanges.
  // https://github.com/usetrmnl/terminus/blob/0.78.0/config/db/migrate/20260406095627_add_extension_exchange.rb#L10
  for (const [collection, id] of [
    ["api/extensions", created.extension],
    ["api/playlists", created.playlist],
    ["api/screens", created.screen],
  ] as const) {
    if (id === undefined) {
      continue;
    }

    yield* http.execute(
      HttpClientRequest.delete(`${collection}/${id}`).pipe(
        HttpClientRequest.setHeader("Authorization", access_token)
      )
    );
  }
});

NodeRuntime.runMain(
  verify.pipe(
    Effect.scoped,
    Effect.ensuring(Effect.orDie(deleteCreatedWithoutActions)),
    Effect.provide(Layer.provideMerge(services, noRedirectHttpClientLayer))
  )
);
