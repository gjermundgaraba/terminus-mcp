#!/usr/bin/env node

import { createServer as createHttpServer, type Server } from "node:http";

import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer as createMcpServer } from "./server.js";
import { TerminusClient } from "./terminus/client.js";

const defaultAllowedHosts = ["localhost", "127.0.0.1", "[::1]", "terminus-mcp"];

export function startHttpServer(environment: NodeJS.ProcessEnv = process.env): Server {
  const host = environment.MCP_HOST || "127.0.0.1";
  const port = Number(environment.MCP_PORT ?? 8002);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer from 0 to 65535.");
  }

  const allowedHosts = [
    ...defaultAllowedHosts,
    ...(environment.MCP_ALLOWED_HOSTS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []),
  ];
  const validateHost = hostHeaderValidation(allowedHosts);
  const validateOrigin = originValidation(allowedHosts);
  const client = TerminusClient.fromEnv(environment);
  const handler = createMcpHandler(() => createMcpServer(client), {
    onerror: (error) => console.error(error.message),
  });
  const serveMcp = toNodeHandler(handler, {
    onerror: (error) => console.error(error.message),
  });

  const server = createHttpServer((request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/healthz") {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    void serveMcp(request as NodeIncomingMessageLike, response);
  });

  server.on("close", () => void handler.close());
  server.listen(port, host);
  return server;
}

if (import.meta.main) {
  const server = startHttpServer();
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.error(`Terminus MCP listening on http://${address.address}:${address.port}/mcp`);
    }
  });
}
