import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { McpSchema } from "effect/ai";

/** A JSON-RPC message from the server; a reply carries its request's `id`. */
const Reply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Int),
    result: Schema.optionalKey(Schema.Unknown),
  })
);

const decodeReply = Schema.decodeUnknownSync(Reply);
const decodeToolResult = Schema.decodeUnknownSync(McpSchema.CallToolResult);

const call = (
  id: number,
  name: string,
  args: { readonly [key: string]: Schema.Json }
) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("stdio", () => {
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

    const exited = once(server, "exit");

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

    const replies = new Map<number, unknown>();

    for await (const line of createInterface({ input: server.stdout })) {
      const reply = decodeReply(line);

      if (reply.id !== undefined) {
        replies.set(reply.id, reply.result);
      }
    }

    assert.deepStrictEqual(await exited, [0, null]);

    const toolReply = (id: number) => {
      const { content, isError } = decodeToolResult(replies.get(id));
      const [first] = content;
      assert.ok(first?.type === "text", `Reply ${id} starts with text`);

      return { isError, text: first.text };
    };

    // The guide resolves from dist.
    assert.match(toolReply(2).text, /complete HTML document/u);
    // A write reaches Terminus.
    const write = toolReply(3);
    assert.strictEqual(write.isError, true);
    assert.match(write.text, /Unable to reach Terminus/u);
  });
});
