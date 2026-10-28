#!/usr/bin/env node

import { NodeRuntime, NodeStdio } from "@effect/platform-node";
import * as ActionCli from "@gjermundgaraba/effect-actions/ActionCli";
import * as ActionMcp from "@gjermundgaraba/effect-actions/ActionMcp";
import { Effect, Layer } from "effect";

import { noRedirectHttpClientLayer } from "./http-client.js";
import { actions, server, services } from "./server.js";

NodeRuntime.runMain(
  ActionMcp.runStdio(actions, server).pipe(
    Effect.provide([
      NodeStdio.layer,
      Layer.provide(services, noRedirectHttpClientLayer),
    ]),
    ActionCli.logToStderr
  )
);
