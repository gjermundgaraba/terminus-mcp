import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Testing from "@gjermundgaraba/effect-actions/Testing";

import { ScreenDocs } from "../src/docs.js";
import { Actions } from "../src/server.js";
import { Terminus } from "../src/terminus/client.js";
import {
  configured,
  device,
  docsFetches,
  exchange,
  extension,
  fakeHttp,
  json,
  model,
  playlist,
  png,
  screen,
  send,
  serve,
  terminus,
  trmnlDocs,
} from "./fake.js";

interface Tool {
  readonly name: string;
  readonly inputSchema: unknown;
  readonly annotations: Record<string, unknown>;
}

interface ToolResult {
  readonly isError: boolean;
  readonly content: ReadonlyArray<{ readonly type: string; readonly data?: string }>;
  readonly structuredContent?: unknown;
}

/** One JSON-RPC request to /mcp, answered with its `result`. */
const rpc = <A>(method: string, params?: Testing.McpParams) =>
  Effect.gen(function* () {
    const response = yield* send(method, params);
    return ((yield* response.json) as { readonly result: A }).result;
  });

const callTool = (name: string, args: { readonly [key: string]: Schema.Json }) =>
  rpc<ToolResult>("tools/call", { name, arguments: args });

const noTerminus = () => assert.fail("No Terminus request expected");

it.effect("lists the curated tools with their hints", () =>
  Effect.gen(function* () {
    const { tools } = yield* rpc<{ readonly tools: ReadonlyArray<Tool> }>("tools/list");
    const tool = (name: string) => {
      const found = tools.find((candidate) => candidate.name === name);
      assert.ok(found, `${name} is listed`);
      return found;
    };

    assert.deepStrictEqual(tools.map(({ name }) => name).sort(), [
      "assign_playlist",
      "create_extension",
      "create_extension_exchange",
      "create_screen",
      "delete_extension",
      "delete_extension_exchange",
      "delete_playlist",
      "delete_screen",
      "get_display_context",
      "get_extension",
      "get_screen_image",
      "list_extensions",
      "list_playlists",
      "list_screens",
      "read_screen_doc",
      "save_playlist",
      "search_screen_docs",
      "update_extension",
      "update_extension_exchange",
      "update_screen",
    ]);
    assert.match(JSON.stringify(tool("create_screen").inputSchema), /Use dither for photos/);
    assert.notMatch(JSON.stringify(tool("update_screen").inputSchema), /model_id|"name"/);
    const required = (name: string) => (tool(name).inputSchema as { required?: unknown }).required;
    assert.deepStrictEqual(required("update_extension"), ["extension_id"]);
    assert.deepStrictEqual(required("update_extension_exchange"), ["extension_id", "exchange_id"]);
    assert.strictEqual(tool("list_screens").annotations.readOnlyHint, true);
    const assign = tool("assign_playlist").annotations;
    assert.strictEqual(assign.readOnlyHint, false);
    assert.strictEqual(assign.destructiveHint, false);
    assert.strictEqual(assign.idempotentHint, true);
    for (const name of ["list_extensions", "get_extension"]) {
      assert.strictEqual(tool(name).annotations.readOnlyHint, true);
    }
    for (const name of ["create_extension", "create_extension_exchange"]) {
      assert.strictEqual(tool(name).annotations.destructiveHint, false);
    }
    for (const name of [
      "delete_screen",
      "delete_playlist",
      "delete_extension",
      "delete_extension_exchange",
    ]) {
      const hints = tool(name).annotations;
      assert.strictEqual(hints.readOnlyHint, false);
      assert.notStrictEqual(hints.destructiveHint, false);
      assert.strictEqual(hints.idempotentHint, true);
    }
  }).pipe(Effect.provide(serve(noTerminus))),
);

it.effect("redacts device credentials and reuses one login", () => {
  let logins = 0;

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    const context = yield* callTool("get_display_context", {});
    assert.notMatch(JSON.stringify(context), /api_key|mac_address|must-never|e0:72/i);
    const { context: display } = yield* mcp.get_display_context();
    assert.strictEqual(display.device.label, "Desk");
    assert.deepStrictEqual(display.framework.screen_classes, [
      "screen",
      "screen--md",
      "screen--ogv2",
      "screen--density-1x",
      "screen--1bit",
      "screen--landscape",
    ]);
    assert.deepStrictEqual(display.framework.screen_variables, {
      "--screen-w": "800px",
      "--screen-h": "480px",
    });

    const assigned = yield* callTool("assign_playlist", { device_id: 40, playlist_id: 20 });
    assert.notMatch(JSON.stringify(assigned), /api_key|mac_address|must-never/i);
    assert.strictEqual(logins, 1);
  }).pipe(
    Effect.provide(
      serve((request) => {
        if (request.url.pathname === "/login") logins += 1;
        return terminus(({ method, url, body }) => {
          if (url.pathname !== "/api/devices/40" || method !== "PATCH") return undefined;
          assert.deepStrictEqual(body, { device: { playlist_id: 20 } });
          return json({ data: device });
        })(request);
      }),
    ),
  );
});

it.effect("returns a screen's rendered image beside its record", () =>
  Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    const image = yield* mcp.get_screen_image({ screen_id: 10 });
    assert.strictEqual(image.screen.id, 10);
    assert.deepStrictEqual(image.image, { data: png, mimeType: "image/png" });

    const result = yield* callTool("get_screen_image", { screen_id: 10 });
    assert.deepStrictEqual(result.structuredContent, { screen });
    assert.deepStrictEqual(
      result.content.map(({ type }) => type),
      ["text", "image"],
    );
    assert.strictEqual(result.content[1]?.data, Buffer.from(png).toString("base64"));
  }).pipe(Effect.provide(serve(terminus()))),
);

it.effect("creates and replaces screens", () => {
  let creates = 0;
  let patches = 0;

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    // Sent raw: the typed client encodes, and refuses untrimmed text; the server trims it.
    const created = yield* callTool("create_screen", {
      model_id: 1,
      label: "  Created ",
      name: "created",
      html: "<h1>Created</h1>",
    });
    assert.strictEqual(created.isError, false);

    const stalePlaylist = yield* Effect.flip(
      mcp.create_screen({
        model_id: 1,
        label: "Orphan",
        name: "orphan",
        html: "<h1>Orphan</h1>",
        playlist_id: 999,
      }),
    );
    assert.strictEqual(stalePlaylist._tag, "TerminusError");
    assert.match(stalePlaylist.message, /Playlist 999 was not found/);
    assert.strictEqual(creates, 1);

    yield* mcp.update_screen({ screen_id: 10, label: "Updated", html: "<h1>Updated</h1>" });
    const identityUpdate = yield* callTool("update_screen", {
      screen_id: 10,
      model_id: 2,
      name: "different-screen",
      html: "<h1>Wrong target</h1>",
    });
    assert.strictEqual(identityUpdate.isError, true);
    assert.strictEqual(patches, 1);
  }).pipe(
    Effect.provide(
      serve(
        terminus(({ method, url, body }) => {
          if (url.pathname === "/api/screens" && method === "POST") {
            creates += 1;
            assert.deepStrictEqual(body, {
              screen: {
                model_id: 1,
                label: "Created",
                name: "created",
                content: "<h1>Created</h1>",
              },
            });
            return json({ data: { ...screen, label: "Created", name: "created" } });
          }
          if (url.pathname === "/api/screens/10" && method === "PATCH") {
            patches += 1;
            assert.deepStrictEqual(body, {
              screen: { label: "Updated", content: "<h1>Updated</h1>" },
            });
            return json({ data: { ...screen, label: "Updated" } });
          }
          return undefined;
        }),
      ),
    ),
  );
});

it.effect("deletes one screen or playlist", () => {
  const deleted: Array<string> = [];

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    const { screen: gone } = yield* mcp.delete_screen({ screen_id: 10 });
    assert.deepStrictEqual(gone, screen);
    const { playlist: emptied } = yield* mcp.delete_playlist({ playlist_id: 20 });
    assert.strictEqual(emptied.id, playlist.id);
    assert.deepStrictEqual(deleted, ["/api/screens/10", "/api/playlists/20"]);
  }).pipe(
    Effect.provide(
      serve(
        terminus(({ method, url }) => {
          if (method !== "DELETE") return undefined;
          deleted.push(url.pathname);
          if (url.pathname === "/api/screens/10") return json({ data: screen });
          if (url.pathname === "/api/playlists/20") return json({ data: playlist });
          return undefined;
        }),
      ),
    ),
  );
});

it.effect("reports a missing resource however Terminus answers for it", () => {
  const notFound = { type: "about:blank", title: "Not Found", status: 404 };
  const answers = [
    json(notFound, 404),
    json(notFound),
    json({ data: {} }),
    json({ data: { id: "not a screen" } }),
  ];

  return Effect.gen(function* () {
    const terminus = yield* Terminus;
    const messages = [];
    for (const index of answers.keys()) {
      const error = yield* Effect.flip(terminus.deleteScreen({ screen_id: 900 + index }));
      messages.push(error.message);
    }
    assert.deepStrictEqual(messages, [
      "Screen 900 was not found.",
      "Screen 901 was not found.",
      "Screen 902 was not found.",
      "Terminus returned an unexpected response.",
    ]);
  }).pipe(
    Effect.provide(
      terminusLayer(terminus(({ url }) => answers[Number(url.pathname.split("/").at(-1)) - 900])),
    ),
  );
});

it.effect("lists and reads extensions without exchange header values", () =>
  Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    const { extensions } = yield* mcp.list_extensions();
    assert.deepStrictEqual(extensions, [extension]);

    const result = yield* callTool("get_extension", { extension_id: 50 });
    assert.strictEqual(result.isError, false);
    assert.notMatch(JSON.stringify(result), /must-never-leak/);
    const detail = yield* mcp.get_extension({ extension_id: 50 });
    assert.deepStrictEqual(detail.extension, extension);
    assert.deepStrictEqual(detail.exchanges[0]?.header_names, ["Authorization"]);
    assert.deepStrictEqual(detail.exchanges[0]?.data, exchange.data);
  }).pipe(Effect.provide(serve(terminus()))),
);

it.effect("creates extensions and exchanges in the shape Terminus takes", () => {
  const sent: Array<unknown> = [];

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    yield* mcp.create_extension({
      name: "save-point",
      label: "Save Point",
      kind: "static",
      template: "<div>{{ source_1.games[0] }}</div>",
      static_body: { games: ["Chrono Trigger"] },
      interval: 15,
      unit: "minute",
      model_ids: [1],
    });
    const { exchange: created } = yield* mcp.create_extension_exchange({
      extension_id: 50,
      template: "https://api.example.test/games.json",
      headers: { Authorization: "Bearer must-never-leak" },
    });
    assert.deepStrictEqual(created.header_names, ["Authorization"]);
    assert.notMatch(JSON.stringify(created), /must-never-leak/);

    assert.deepStrictEqual(sent, [
      {
        extension: {
          name: "save-point",
          label: "Save Point",
          kind: "static",
          template: "<div>{{ source_1.games[0] }}</div>",
          static_body: { games: ["Chrono Trigger"] },
          interval: 15,
          unit: "minute",
        },
        model_ids: [1],
      },
      {
        exchange: {
          template: "https://api.example.test/games.json",
          headers: { Authorization: "Bearer must-never-leak" },
        },
      },
    ]);
  }).pipe(
    Effect.provide(
      serve(
        terminus(({ method, url, body }) => {
          if (method !== "POST") return undefined;
          sent.push(body);
          if (url.pathname === "/api/extensions") return json({ data: extension });
          if (url.pathname === "/api/extensions/50/exchanges") return json({ data: exchange });
          return undefined;
        }),
      ),
    ),
  );
});

it.effect("keeps an extension's models, devices and schedule through a partial update", () => {
  const patches: Array<unknown> = [];

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    yield* mcp.update_extension({ extension_id: 50, label: "Renamed" });
    yield* mcp.update_extension({ extension_id: 50, unit: "hour" });
    yield* mcp.update_extension({ extension_id: 50, device_ids: [40] });
    yield* mcp.update_extension_exchange({ extension_id: 50, exchange_id: 60, verb: "post" });

    assert.deepStrictEqual(patches, [
      {
        extension: { label: "Renamed", interval: 15, unit: "minute" },
        model_ids: [1],
        device_ids: [],
      },
      { extension: { interval: 15, unit: "hour" }, model_ids: [1], device_ids: [] },
      { extension: { interval: 15, unit: "minute" }, model_ids: [1], device_ids: [40] },
      { exchange: { verb: "post" } },
    ]);
  }).pipe(
    Effect.provide(
      serve(
        terminus(({ method, url, body }) => {
          if (method !== "PATCH") return undefined;
          patches.push(body);
          if (url.pathname === "/api/extensions/50") return json({ data: extension });
          if (url.pathname === "/api/extensions/50/exchanges/60") {
            return json({ data: exchange });
          }
          return undefined;
        }),
      ),
    ),
  );
});

it.effect("deletes extensions and exchanges without exchange header values", () =>
  Effect.gen(function* () {
    const terminus = yield* Terminus;

    const { extension: deleted } = yield* terminus.deleteExtension({ extension_id: 50 });
    assert.strictEqual(deleted.id, 50);
    const { exchange: gone } = yield* terminus.deleteExchange({
      extension_id: 50,
      exchange_id: 60,
    });
    assert.deepStrictEqual(gone.header_names, ["Authorization"]);
    assert.notMatch(JSON.stringify(gone), /must-never-leak/);
  }).pipe(
    Effect.provide(
      terminusLayer(
        terminus(({ method, url }) => {
          if (method !== "DELETE") return undefined;
          if (url.pathname === "/api/extensions/50") return json({ data: extension });
          if (url.pathname === "/api/extensions/50/exchanges/60") return json({ data: exchange });
          return undefined;
        }),
      ),
    ),
  ),
);

it.effect("names each field Terminus refuses", () =>
  Effect.gen(function* () {
    const terminus = yield* Terminus;
    const error = yield* Effect.flip(
      terminus.createExtension({
        name: "late",
        label: "Late",
        kind: "static",
        template: "<p></p>",
        interval: 30,
        unit: "hour",
      }),
    );
    assert.strictEqual(
      error.message,
      'Terminus request failed (HTTP 422): Validation failed. {"extension":{"interval":["must be 0-23"]}}',
    );
  }).pipe(
    Effect.provide(
      terminusLayer(
        terminus(({ method }) =>
          method === "POST"
            ? json(
                {
                  type: "/problem_details#extension_payload",
                  status: 422,
                  detail: "Validation failed.",
                  errors: { extension: { interval: ["must be 0-23"] } },
                },
                422,
              )
            : undefined,
        ),
      ),
    ),
  ),
);

it.effect("saves playlists and selects the first item of a replaced one", () => {
  let patches = 0;
  const items = [{ ...playlist.items[0], id: 31 }];

  return Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);

    const created = yield* mcp.save_playlist({
      name: "agent",
      label: "Agent",
      mode: "manual",
      screen_ids: [10],
    });
    assert.strictEqual(created.action, "created");

    const updated = yield* mcp.save_playlist({
      playlist_id: 20,
      name: "main",
      label: "Main updated",
      mode: "manual",
      screen_ids: [10],
    });
    assert.strictEqual(updated.action, "updated");
    assert.strictEqual(updated.playlist.current_item_id, 31);
    assert.strictEqual(patches, 2);
  }).pipe(
    Effect.provide(
      serve(
        terminus(({ method, url, body }) => {
          if (url.pathname === "/api/playlists" && method === "POST") {
            assert.deepStrictEqual(body, {
              playlist: {
                name: "agent",
                label: "Agent",
                mode: "manual",
                items: [{ screen_id: 10 }],
              },
            });
            return json({ data: { ...playlist, id: 21, name: "agent", label: "Agent" } });
          }
          if (url.pathname !== "/api/playlists/20" || method !== "PATCH") return undefined;

          patches += 1;
          if (patches === 1) {
            assert.deepStrictEqual(body, {
              playlist: {
                name: "main",
                label: "Main updated",
                mode: "manual",
                items: [{ screen_id: 10 }],
              },
            });
            return json({
              data: {
                ...playlist,
                label: "Main updated",
                current_item_id: null,
                mode: "manual",
                items,
              },
            });
          }
          assert.deepStrictEqual(body, {
            playlist: { name: "main", label: "Main updated", current_item_id: 31 },
          });
          return json({
            data: {
              ...playlist,
              label: "Main updated",
              current_item_id: 31,
              mode: "manual",
              items,
            },
          });
        }),
      ),
    ),
  );
});

it.effect("searches and reads the screen docs from one catalog", () =>
  Effect.gen(function* () {
    const mcp = yield* Testing.mcpClient(Actions);
    const catalogFetches = docsFetches.get("https://trmnl.com/framework") ?? 0;

    const { docs } = yield* mcp.search_screen_docs();
    assert.deepStrictEqual(
      docs.map(({ id }) => id),
      [
        "terminus:screen-authoring",
        "trmnl:private-plugins/templates",
        "framework:3.1:structure",
        "framework:3.1:screen",
        "framework:3.1:layout",
        "framework:3.1:framework_runtime",
      ],
    );
    const guide = yield* mcp.read_screen_doc({ doc_id: "terminus:screen-authoring" });
    assert.match(guide.markdown, /complete HTML document/);

    const structure = yield* mcp.search_screen_docs({ query: "structure" });
    assert.deepStrictEqual(
      structure.docs.map(({ id }) => id),
      ["framework:3.1:structure"],
    );
    const frameworkDoc = yield* mcp.read_screen_doc({ doc_id: "framework:3.1:structure" });
    assert.strictEqual(frameworkDoc.markdown, "# Structure");

    const unknownDoc = yield* Effect.flip(mcp.read_screen_doc({ doc_id: "framework:3.1:nope" }));
    assert.strictEqual(unknownDoc._tag, "DocsError");
    assert.match(unknownDoc.message, /Unknown screen documentation ID/);
    // Two searches and three reads share one catalog.
    assert.strictEqual(docsFetches.get("https://trmnl.com/framework"), catalogFetches + 1);
  }).pipe(Effect.provide(serve(noTerminus))),
);

it.effect("accepts zero dimensions and reports redacted device choices", () => {
  const pendingDevice = {
    ...device,
    id: 41,
    model_id: 2,
    playlist_id: null,
    label: "Pending",
    api_key: "second-secret",
    mac_address: "aa:bb:cc:dd:ee:ff",
    width: 0,
    height: 0,
  };
  const pendingModel = { ...model, id: 2, css: null, width: 0, height: 0 };

  return Effect.gen(function* () {
    const terminus = yield* Terminus;

    const choice = yield* Effect.flip(terminus.getDisplayContext({}));
    assert.match(choice.message, /"device_id":40/);
    assert.match(choice.message, /"device_id":41/);
    assert.notMatch(choice.message, /api_key|mac_address|second-secret|aa:bb/i);

    const { context } = yield* terminus.getDisplayContext({ device_id: 41 });
    assert.strictEqual(context.device.width, 0);
    assert.strictEqual(context.model.height, 0);
    assert.deepStrictEqual(context.model.css, { classes: {}, variables: [] });
    assert.deepStrictEqual(context.framework.screen_variables, {});
  }).pipe(
    Effect.provide(
      terminusLayer(
        terminus(({ url }) => {
          if (url.pathname === "/api/devices") return json({ data: [device, pendingDevice] });
          if (url.pathname === "/api/models") return json({ data: [model, pendingModel] });
          return undefined;
        }),
      ),
    ),
  );
});

it.effect("refreshes once after Terminus reports an expired JWT", () => {
  let deviceRequests = 0;

  return Effect.gen(function* () {
    const terminus = yield* Terminus;
    const { context } = yield* terminus.getDisplayContext({});
    assert.strictEqual(context.device.id, 40);
    assert.strictEqual(deviceRequests, 2);
  }).pipe(
    Effect.provide(
      terminusLayer(({ url, authorization }) => {
        if (url.pathname === "/login") {
          return json({ access_token: "old", refresh_token: "refresh-1" });
        }
        if (url.pathname === "/api/jwt") {
          assert.strictEqual(authorization, "old");
          return json({ access_token: "new", refresh_token: "refresh-2" });
        }
        if (url.pathname === "/api/devices") {
          deviceRequests += 1;
          return authorization === "old"
            ? json({ error: "expired JWT access token" }, 400)
            : json({ data: [device] });
        }
        if (url.pathname === "/api/models") return json({ data: [model] });
        if (url.pathname === "/api/playlists") return json({ data: [playlist] });
        return new Response(null, { status: 404 });
      }),
    ),
  );
});

it.effect("rejects rendered images outside the configured Terminus origin", () =>
  Effect.gen(function* () {
    const terminus = yield* Terminus;
    const error = yield* Effect.flip(terminus.getScreenImage({ screen_id: 10 }));
    assert.match(error.message, /unsafe screen image URL/);
  }).pipe(
    Effect.provide(
      terminusLayer(
        terminus(({ url }) =>
          url.pathname === "/api/screens/10"
            ? json({ data: { ...screen, uri: "https://attacker.test/image.png" } })
            : undefined,
        ),
      ),
    ),
  ),
);

it.effect("stops reading an image past 10 MiB that declares no length", () => {
  const mebibyte = new Uint8Array(1024 * 1024);
  let sent = 0;

  return Effect.gen(function* () {
    const terminus = yield* Terminus;
    const error = yield* Effect.flip(terminus.getScreenImage({ screen_id: 10 }));
    assert.match(error.message, /exceeds the 10 MiB limit/);
    assert.isBelow(sent, 20);
  }).pipe(
    Effect.provide(
      terminusLayer((request) => {
        if (request.url.pathname !== "/uploads/screen.png") return terminus()(request);
        // Endless, so only a reader that stops can finish.
        const body = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            sent += 1;
            controller.enqueue(mebibyte);
          },
        });
        return new Response(body, { headers: { "Content-Type": "image/png" } });
      }),
    ),
  );
});

it.effect("reports a TRMNL failure and fetches again on the next search", () => {
  let failures = 1;

  return Effect.gen(function* () {
    const docs = yield* ScreenDocs;
    const failed = yield* Effect.flip(docs.search({}));
    assert.match(failed.message, /TRMNL documentation request failed \(HTTP 500\)/);
    // The failure is not cached.
    assert.ok((yield* docs.search({})).docs.length > 0);
  }).pipe(
    Effect.provide(
      ScreenDocs.layer.pipe(
        Layer.provide(
          fakeHttp((request) =>
            request.url.href === "https://trmnl.com/framework" && failures-- > 0
              ? new Response(null, { status: 500 })
              : (trmnlDocs(request) ?? assert.fail(`Unexpected request to ${request.url.href}`)),
          ),
        ),
      ),
    ),
  );
});

function terminusLayer(respond: Parameters<typeof fakeHttp>[0]) {
  return Terminus.layer.pipe(Layer.provide(fakeHttp(respond)), Layer.provide(configured()));
}
