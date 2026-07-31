import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "vite-plus/test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startHttpServer } from "../src/http.js";

test("serves MCP over HTTP with health and origin guards", async () => {
  const server = startHttpServer({
    TERMINUS_URL: "https://terminus.example.test",
    TERMINUS_LOGIN: "agent@example.test",
    TERMINUS_PASSWORD: "secret",
    MCP_HOST: "127.0.0.1",
    MCP_PORT: "0",
  });
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new Client({ name: "terminus-mcp-http-test", version: "1.0.0" });

  try {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const rejected = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: "https://attacker.test" },
    });
    assert.equal(rejected.status, 403);

    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const guide = await client.callTool({
      name: "read_screen_doc",
      arguments: { doc_id: "terminus:screen-authoring" },
    });
    assert.match(JSON.stringify(guide), /complete HTML document/);
  } finally {
    await client.close().catch(() => undefined);
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
});

test("rejects an invalid HTTP port", () => {
  assert.throws(
    () =>
      startHttpServer({
        MCP_PORT: "70000",
      }),
    /MCP_PORT/,
  );
});
