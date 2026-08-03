import assert from "node:assert/strict";
import { test } from "vite-plus/test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { ScreenDocs, type ScreenDoc } from "../src/docs.js";
import { createServer } from "../src/server.js";
import { TerminusClient } from "../src/terminus/client.js";
import type { DisplayContext } from "../src/terminus/contracts.js";

const model = {
  id: 1,
  default_palette_id: null,
  name: "trmnl-og-1bit",
  label: "TRMNL OG (1-bit)",
  description: null,
  kind: "display",
  mime_type: "image/png",
  colors: 2,
  bit_depth: 1,
  rotation: 0,
  offset_x: 0,
  offset_y: 0,
  scale_factor: 1,
  css: {
    classes: {
      size: "screen--md",
      device: "screen--ogv2",
      density: "screen--density-1x",
    },
    variables: [
      ["--screen-w", "800px"],
      ["--screen-h", "480px"],
    ],
  },
  width: 800,
  height: 480,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const screen = {
  id: 10,
  model_id: 1,
  label: "Test screen",
  name: "test-screen",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  filename: "screen.png",
  mime_type: "image/png",
  bit_depth: 1,
  width: 800,
  height: 480,
  size: 4,
  uri: "/uploads/screen.png",
};

const playlist = {
  id: 20,
  name: "main",
  label: "Main",
  current_item_id: 30,
  mode: "automatic",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  items: [
    {
      id: 30,
      screen_id: 10,
      position: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

const device = {
  id: 40,
  model_id: 1,
  playlist_id: 20,
  label: "Desk",
  mac_address: "e0:72:a1:2f:bc:fc",
  api_key: "must-never-leave-client",
  firmware_version: "1.6.0",
  wifi_band: 2.4,
  wifi_signal: -52,
  battery_charge: 87,
  battery_voltage: 4.1,
  charging: false,
  refresh_rate: 900,
  image_cached: true,
  synced_at: "2026-01-01T00:00:00Z",
  width: 800,
  height: 480,
};

test("exposes the curated tools and redacts device credentials", async () => {
  let loginCalls = 0;
  let playlistPatchCalls = 0;
  let screenCreateCalls = 0;
  let screenPatchCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("Authorization");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    if (url.pathname === "/login") {
      loginCalls += 1;
      assert.deepEqual(body, { login: "agent@example.test", password: "secret" });
      return json({ access_token: "access", refresh_token: "refresh" });
    }
    if (url.pathname === "/uploads/screen.png") {
      assert.equal(authorization, null);
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
      });
    }

    assert.equal(authorization, "access");
    if (url.pathname === "/api/devices" && method === "GET") {
      return json({ data: [device] });
    }
    if (url.pathname === "/api/models") return json({ data: [model] });
    if (url.pathname === "/api/screens" && method === "GET") {
      return json({ data: [screen] });
    }
    if (url.pathname === "/api/playlists" && method === "GET") {
      return json({ data: [playlist] });
    }
    if (url.pathname === "/api/screens" && method === "POST") {
      screenCreateCalls += 1;
      assert.deepEqual(body, {
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
      screenPatchCalls += 1;
      assert.deepEqual(body, {
        screen: { label: "Updated", content: "<h1>Updated</h1>" },
      });
      return json({ data: { ...screen, label: "Updated" } });
    }
    if (url.pathname === "/api/playlists" && method === "POST") {
      assert.deepEqual(body, {
        playlist: {
          name: "agent",
          label: "Agent",
          mode: "manual",
          items: [{ screen_id: 10 }],
        },
      });
      return json({ data: { ...playlist, id: 21, name: "agent", label: "Agent" } });
    }
    if (url.pathname === "/api/playlists/20" && method === "PATCH") {
      playlistPatchCalls += 1;
      if (playlistPatchCalls === 1) {
        assert.deepEqual(body, {
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
            items: [{ ...playlist.items[0], id: 31 }],
          },
        });
      }

      assert.deepEqual(body, {
        playlist: { name: "main", label: "Main updated", current_item_id: 31 },
      });
      return json({
        data: {
          ...playlist,
          label: "Main updated",
          current_item_id: 31,
          mode: "manual",
          items: [{ ...playlist.items[0], id: 31 }],
        },
      });
    }
    if (url.pathname === "/api/devices/40" && method === "PATCH") {
      assert.deepEqual(body, { device: { playlist_id: 20 } });
      return json({ data: device });
    }

    return new Response("not found", { status: 404 });
  };

  const { mcp, close } = await connectedClient(fetcher);
  try {
    const listed = await mcp.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [
      "assign_playlist",
      "create_screen",
      "get_display_context",
      "get_screen_image",
      "list_playlists",
      "list_screens",
      "read_screen_doc",
      "save_playlist",
      "search_screen_docs",
      "update_screen",
    ]);
    const createScreenTool = listed.tools.find(({ name }) => name === "create_screen");
    assert.match(JSON.stringify(createScreenTool?.inputSchema), /Use dither for photos/);
    const updateScreenTool = listed.tools.find(({ name }) => name === "update_screen");
    assert.doesNotMatch(JSON.stringify(updateScreenTool?.inputSchema), /model_id|"name"/);

    const context = await mcp.callTool({
      name: "get_display_context",
      arguments: {},
    });
    const serialized = JSON.stringify(context);
    const display = structured<{ context: DisplayContext }>(context).context;
    assert.doesNotMatch(serialized, /api_key|mac_address|must-never|e0:72/i);
    assert.equal(display.device.label, "Desk");
    assert.deepEqual(display.framework.screen_classes, [
      "screen",
      "screen--md",
      "screen--ogv2",
      "screen--density-1x",
      "screen--1bit",
      "screen--landscape",
    ]);
    assert.deepEqual(display.framework.screen_variables, {
      "--screen-w": "800px",
      "--screen-h": "480px",
    });

    const docs = await mcp.callTool({
      name: "search_screen_docs",
      arguments: {},
    });
    const docsContent = structured<{ docs: ScreenDoc[] }>(docs);
    assert.ok(docsContent.docs.some(({ id }) => id === "terminus:screen-authoring"));

    const guide = await mcp.callTool({
      name: "read_screen_doc",
      arguments: { doc_id: "terminus:screen-authoring" },
    });
    assert.match(structured<{ markdown: string }>(guide).markdown, /complete HTML document/);

    const frameworkDocs = await mcp.callTool({
      name: "search_screen_docs",
      arguments: { query: "structure" },
    });
    const frameworkDocsContent = structured<{ docs: ScreenDoc[] }>(frameworkDocs);
    assert.deepEqual(
      frameworkDocsContent.docs.map(({ id }) => id),
      ["framework:3.1:structure"],
    );
    const frameworkDoc = await mcp.callTool({
      name: "read_screen_doc",
      arguments: { doc_id: "framework:3.1:structure" },
    });
    assert.equal(structured<{ markdown: string }>(frameworkDoc).markdown, "# Structure");

    const image = await mcp.callTool({
      name: "get_screen_image",
      arguments: { screen_id: 10 },
    });
    assert.equal(image.content[1]?.type, "image");

    await mcp.callTool({
      name: "create_screen",
      arguments: {
        model_id: 1,
        label: "Created",
        name: "created",
        html: "<h1>Created</h1>",
      },
    });
    const stalePlaylist = await mcp.callTool({
      name: "create_screen",
      arguments: {
        model_id: 1,
        label: "Orphan",
        name: "orphan",
        html: "<h1>Orphan</h1>",
        playlist_id: 999,
      },
    });
    assert.equal(stalePlaylist.isError, true);
    assert.match(JSON.stringify(stalePlaylist), /Playlist 999 was not found/);
    assert.equal(screenCreateCalls, 1);
    await mcp.callTool({
      name: "update_screen",
      arguments: {
        screen_id: 10,
        label: "Updated",
        html: "<h1>Updated</h1>",
      },
    });
    const identityUpdate = await mcp.callTool({
      name: "update_screen",
      arguments: {
        screen_id: 10,
        model_id: 2,
        name: "different-screen",
        html: "<h1>Wrong target</h1>",
      },
    });
    assert.equal(identityUpdate.isError, true);
    assert.equal(screenPatchCalls, 1);
    await mcp.callTool({
      name: "save_playlist",
      arguments: {
        name: "agent",
        label: "Agent",
        mode: "manual",
        screen_ids: [10],
      },
    });
    const updatedPlaylist = await mcp.callTool({
      name: "save_playlist",
      arguments: {
        playlist_id: 20,
        name: "main",
        label: "Main updated",
        mode: "manual",
        screen_ids: [10],
      },
    });
    assert.equal(
      structured<{ playlist: typeof playlist }>(updatedPlaylist).playlist.current_item_id,
      31,
    );
    assert.equal(playlistPatchCalls, 2);
    const assigned = await mcp.callTool({
      name: "assign_playlist",
      arguments: { device_id: 40, playlist_id: 20 },
    });
    assert.doesNotMatch(JSON.stringify(assigned), /api_key|mac_address|must-never/i);
    assert.equal(loginCalls, 1);
  } finally {
    await close();
  }
});

test("accepts zero dimensions and reports redacted device choices", async () => {
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
  const fetcher: typeof fetch = async (input) => {
    const url = requestUrl(input);
    if (url.pathname === "/login") {
      return json({ access_token: "access", refresh_token: "refresh" });
    }
    if (url.pathname === "/api/devices") return json({ data: [device, pendingDevice] });
    if (url.pathname === "/api/models") return json({ data: [model, pendingModel] });
    if (url.pathname === "/api/playlists") return json({ data: [playlist] });
    assert.fail(`Unexpected request to ${url.href}`);
  };

  const client = new TerminusClient({
    baseUrl: "https://terminus.example.test",
    login: "agent@example.test",
    password: "secret",
    fetcher,
  });
  await assert.rejects(
    () => client.getDisplayContext(),
    (error: Error) => {
      assert.match(error.message, /"device_id":40/);
      assert.match(error.message, /"device_id":41/);
      assert.doesNotMatch(error.message, /api_key|mac_address|second-secret|aa:bb/i);
      return true;
    },
  );

  const context = await client.getDisplayContext(41);
  assert.equal(context.device.width, 0);
  assert.equal(context.model.height, 0);
  assert.deepEqual(context.model.css, { classes: {}, variables: [] });
  assert.deepEqual(context.framework.screen_variables, {});
});

test("refreshes once after Terminus reports an expired JWT", async () => {
  let deviceRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const authorization = new Headers(init?.headers).get("Authorization");

    if (url.pathname === "/login") {
      return json({ access_token: "old", refresh_token: "refresh-1" });
    }
    if (url.pathname === "/api/jwt") {
      assert.equal(authorization, "old");
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
  };

  const client = new TerminusClient({
    baseUrl: "https://terminus.example.test",
    login: "agent@example.test",
    password: "secret",
    fetcher,
  });
  const context = await client.getDisplayContext();
  assert.equal(context.device.id, 40);
  assert.equal(deviceRequests, 2);
});

test("rejects rendered images outside the configured Terminus origin", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = requestUrl(input);
    if (url.pathname === "/login") {
      return json({ access_token: "access", refresh_token: "refresh" });
    }
    if (url.pathname === "/api/screens") {
      return json({ data: [{ ...screen, uri: "https://attacker.test/image.png" }] });
    }
    assert.fail(`Unexpected request to ${url.href}`);
  };

  const client = new TerminusClient({
    baseUrl: "https://terminus.example.test",
    login: "agent@example.test",
    password: "secret",
    fetcher,
  });
  await assert.rejects(() => client.getScreenImage(10), /unsafe screen image URL/);
});

test("screen docs reject invalid IDs and redirects", async () => {
  let requests = 0;
  const docs = new ScreenDocs(async () => {
    requests += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.test/instructions.md" },
    });
  });

  await assert.rejects(() => docs.read("https://attacker.test"), /Unknown/);
  assert.equal(requests, 0);
  await assert.rejects(() => docs.search(), /HTTP 302/);
  assert.equal(requests, 1);
});

async function connectedClient(fetcher: typeof fetch) {
  const server = createServer(
    new TerminusClient({
      baseUrl: "https://terminus.example.test",
      login: "agent@example.test",
      password: "secret",
      fetcher,
    }),
    new ScreenDocs(docsFetcher),
  );
  const mcp = new Client({ name: "terminus-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  return {
    mcp,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

const docsFetcher: typeof fetch = async (input) => {
  const url = requestUrl(input);
  if (url.href === "https://trmnl.com/framework") {
    return text(
      '<a href="/framework/docs/3.0">3.0</a><a href="/framework/docs/3.1">3.1</a>',
      "text/html",
    );
  }
  if (url.href === "https://docs.trmnl.com/go/llms.txt") {
    return text(
      "- [Screen Templating](https://docs.trmnl.com/go/private-plugins/templates.md): Build screens.",
      "text/markdown",
    );
  }
  if (url.href === "https://trmnl.com/framework/docs/3.1") {
    return text(
      '<a href="/framework/docs/3.1/structure">Structure</a>' +
        '<a href="/framework/docs/3.1/screen">Screen</a>' +
        '<a href="/framework/docs/3.1/layout">Layout</a>' +
        '<a href="/framework/docs/3.1/framework_runtime">Runtime</a>',
      "text/html",
    );
  }
  if (url.href === "https://trmnl.com/framework/examples") {
    return text('<a href="/framework/examples/weather">Weather</a>', "text/html");
  }
  if (url.href === "https://trmnl.com/framework/docs/3.1/structure.md") {
    return text("# Structure", "text/markdown");
  }
  assert.fail(`Unexpected documentation request to ${url.href}`);
};

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function text(body: string, contentType: string): Response {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

function structured<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  assert.ok(result.structuredContent);
  return result.structuredContent as T;
}
