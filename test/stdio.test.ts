import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { assert, it } from "@effect/vitest";

interface Reply {
  readonly id?: number;
  readonly result?: {
    readonly isError?: boolean;
    readonly content?: ReadonlyArray<{ readonly text?: string }>;
  };
}

const call = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

it("serves the built server over stdio", async () => {
  const server = spawn(process.execPath, ["dist/index.mjs"], {
    env: {
      ...process.env,
      // Nothing listens here: a call that reaches Terminus fails as unreachable.
      TERMINUS_URL: "http://127.0.0.1:1",
      TERMINUS_LOGIN: "agent@example.test",
      TERMINUS_PASSWORD: "secret",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = new Promise<number | null>((resolve) => server.on("exit", resolve));

  for (const message of [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    call(2, "read_screen_doc", { doc_id: "terminus:screen-authoring" }),
    call(3, "create_screen", {
      model_id: 1,
      label: "Stdio",
      name: "stdio",
      html: "<h1>Stdio</h1>",
    }),
  ]) {
    server.stdin.write(`${JSON.stringify(message)}\n`);
  }
  server.stdin.end();

  const replies = new Map<number, Reply>();
  for await (const line of createInterface({ input: server.stdout })) {
    const reply = JSON.parse(line) as Reply;
    if (reply.id !== undefined) replies.set(reply.id, reply);
  }
  assert.strictEqual(await exited, 0);

  // The guide resolves from dist.
  assert.match(replies.get(2)?.result?.content?.[0]?.text ?? "", /complete HTML document/);
  // A write reaches Terminus.
  const write = replies.get(3)?.result;
  assert.strictEqual(write?.isError, true);
  assert.match(write?.content?.[0]?.text ?? "", /Unable to reach Terminus/);
});
