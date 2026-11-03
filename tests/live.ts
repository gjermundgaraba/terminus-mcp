import assert from "node:assert/strict";

import { NodeRuntime } from "@effect/platform-node";
import * as Action from "@gjermundgaraba/effect-actions/Action";
import { Config, Effect, flow, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { noRedirectHttpClientLayer } from "../src/http-client.js";
import {
  Actions,
  actions,
  ModelActions,
  modelActions,
  services,
} from "../src/server.js";
import { terminusConfig } from "../src/terminus/client.js";
import { Tokens } from "../src/terminus/contracts.js";
import type { FrameworkContext } from "../src/terminus/contracts.js";

interface Created {
  screen?: number;
  playlist?: number;
  extension?: number;
  model?: number;
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

  const { latest, update_available } = context.firmware;

  assert.equal(
    update_available,
    latest === null || device.firmware_version === null
      ? null
      : latest !== device.firmware_version
  );

  const { label, refresh_rate, sleep_start_at, sleep_stop_at } = device;

  yield* Effect.addFinalizer(() =>
    terminus
      .update_display_settings({
        device_id: device.id,
        label,
        refresh_rate,
        sleep:
          sleep_start_at === null || sleep_stop_at === null
            ? null
            : { start_at: sleep_start_at, stop_at: sleep_stop_at },
      })
      .pipe(Effect.orDie)
  );

  const { device: changed } = yield* terminus.update_display_settings({
    device_id: device.id,
    refresh_rate: refresh_rate + 1,
    sleep: { start_at: "03:00", stop_at: "03:00:01" },
  });

  assert.equal(changed.refresh_rate, refresh_rate + 1);
  assert.equal(changed.sleep_start_at, "03:00:00");
  assert.equal(changed.sleep_stop_at, "03:00:01");
  assert.equal(changed.label, label);

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
  // https://github.com/usetrmnl/terminus/blob/0.79.0/app/actions/api/screens/show.rb#L15-L19
  // https://github.com/usetrmnl/terminus/blob/0.79.0/app/actions/api/screens/delete.rb#L27
  // https://github.com/usetrmnl/terminus/blob/0.79.0/app/actions/api/playlists/delete.rb#L18-L22
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

  const models = yield* Action.client(modelActions);

  const { model: custom } = yield* models.create_model({
    name,
    label: "Terminus MCP verification",
    mime_type: "image/png",
    colors: 2,
    bit_depth: 1,
    width: model.width,
    height: model.height,
  });

  created.model = custom.id;
  assert.equal(custom.kind, "terminus");

  const { model: rotated } = yield* models.update_model({
    model_id: custom.id,
    rotation: 90,
    label: "Terminus MCP verification updated",
  });

  assert.equal(rotated.rotation, 90);
  assert.equal(rotated.width, model.width);

  if (model.kind !== "terminus") {
    const synced = yield* Effect.flip(
      models.update_model({ model_id: model.id, rotation: model.rotation })
    );

    assert.match(synced.message, /comes from TRMNL/u);
  }

  yield* Effect.logInfo(
    `Live verification passed for all ${Actions.length + ModelActions.length} actions.`
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
  // https://github.com/usetrmnl/terminus/blob/0.79.0/config/db/migrate/20260406095627_add_extension_exchange.rb#L10
  for (const [collection, id] of [
    ["api/extensions", created.extension],
    ["api/models", created.model],
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
