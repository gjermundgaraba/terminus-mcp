import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { ScreenDoc } from "../src/docs.js";
import type {
  DisplayContext,
  FrameworkContext,
  SavedPlaylist,
  Screen,
} from "../src/terminus/contracts.js";

const environment = {
  TERMINUS_URL: required("TERMINUS_URL"),
  TERMINUS_LOGIN: required("TERMINUS_LOGIN"),
  TERMINUS_PASSWORD: required("TERMINUS_PASSWORD"),
};

const mcp = new Client({ name: "terminus-mcp-live-test", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.mjs"],
  cwd: process.cwd(),
  env: environment,
});
let screenId: number | undefined;
let playlistId: number | undefined;

try {
  await mcp.connect(transport);

  const { context } = await call<{ context: DisplayContext }>("get_display_context", {});
  const { device, model, framework } = context;
  const deviceId = device.id;
  const modelId = model.id;
  const originalPlaylistId = device.playlist_id;
  assert.notEqual(
    originalPlaylistId,
    null,
    "The live device needs an existing playlist for a no-op assignment test",
  );

  await call("list_screens", { model_id: modelId });
  await call("list_playlists", {});
  const { docs: entryPoints } = await call<{ docs: ScreenDoc[] }>("search_screen_docs", {});
  assert.ok(entryPoints.some(({ id }) => id === "terminus:screen-authoring"));
  await call("read_screen_doc", { doc_id: "terminus:screen-authoring" });
  const { docs: structureDocs } = await call<{ docs: ScreenDoc[] }>("search_screen_docs", {
    query: "structure",
  });
  const structureDoc = structureDocs[0];
  assert.ok(structureDoc);
  assert.match(structureDoc.id, /^framework:\d+\.\d+:structure$/);
  await call("read_screen_doc", { doc_id: structureDoc.id });

  const suffix = Date.now().toString(36);
  const name = `terminus-mcp-verify-${suffix}`;
  const { screen: created } = await call<{ screen: Screen }>("create_screen", {
    model_id: modelId,
    name,
    label: "Terminus MCP verification",
    html: verificationHtml(framework),
  });
  screenId = created.id;

  await call("get_screen_image", { screen_id: screenId });
  await call("update_screen", {
    screen_id: screenId,
    label: "Terminus MCP verification updated",
    html: verificationHtml(framework, true),
  });

  const saved = await call<SavedPlaylist>("save_playlist", {
    name,
    label: "Terminus MCP verification",
    mode: "manual",
    screen_ids: [screenId],
  });
  assert.equal(saved.action, "created");
  playlistId = saved.playlist.id;

  const updated = await call<SavedPlaylist>("save_playlist", {
    playlist_id: playlistId,
    name,
    label: "Terminus MCP verification updated",
    mode: "automatic",
    screen_ids: [screenId],
  });
  assert.equal(updated.action, "updated");

  await call("assign_playlist", {
    device_id: deviceId,
    playlist_id: originalPlaylistId,
  });

  process.stderr.write("Live verification passed for all ten MCP tools.\n");
} finally {
  await mcp.close().catch(() => undefined);
  await cleanup(playlistId, screenId);
}

async function call<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await mcp.callTool({ name, arguments: args });
  if (result.isError) {
    const text = result.content.find((item) => item.type === "text");
    throw new Error(text?.type === "text" ? text.text : `${name} failed`);
  }
  assert.ok(result.structuredContent, `${name} returned no structured content`);
  return result.structuredContent as T;
}

async function cleanup(
  temporaryPlaylistId: number | undefined,
  temporaryScreenId: number | undefined,
): Promise<void> {
  if (temporaryPlaylistId === undefined && temporaryScreenId === undefined) return;

  const baseUrl = new URL(environment.TERMINUS_URL);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  const login = await fetch(new URL("login", baseUrl), {
    method: "POST",
    redirect: "manual",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      login: environment.TERMINUS_LOGIN,
      password: environment.TERMINUS_PASSWORD,
    }),
  });
  assert.ok(login.ok, `Cleanup login failed with HTTP ${login.status}`);
  const body = (await login.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") {
    throw new Error("Cleanup login returned no token");
  }
  const token = body.access_token;

  for (const target of [
    temporaryPlaylistId && { collection: "api/playlists", id: temporaryPlaylistId },
    temporaryScreenId && { collection: "api/screens", id: temporaryScreenId },
  ]) {
    if (!target) continue;
    const response = await fetch(new URL(`${target.collection}/${target.id}`, baseUrl), {
      method: "DELETE",
      redirect: "manual",
      headers: { Accept: "application/json", Authorization: token },
    });
    assert.ok(
      response.ok,
      `Cleanup failed for ${target.collection}/${target.id} with HTTP ${response.status}`,
    );

    const verification = await fetch(new URL(target.collection, baseUrl), {
      redirect: "manual",
      headers: { Accept: "application/json", Authorization: token },
    });
    assert.ok(verification.ok, `Cleanup verification failed with HTTP ${verification.status}`);
    const listing = (await verification.json()) as { data?: Array<{ id?: unknown }> };
    assert.ok(
      Array.isArray(listing.data) && !listing.data.some(({ id }) => id === target.id),
      `Temporary object ${target.id} still exists`,
    );
  }
}

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

function required(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
