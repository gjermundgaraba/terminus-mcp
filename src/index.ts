#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";
import { TerminusClient } from "./terminus/client.js";

const client = TerminusClient.fromEnv();

void serveStdio(() => createServer(client), {
  onerror: (error) => console.error(error.message),
});
