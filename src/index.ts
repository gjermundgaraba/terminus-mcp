#!/usr/bin/env node

import { NodeRuntime, NodeStdio } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as ActionCli from "@gjermundgaraba/effect-actions/ActionCli";
import * as ActionMcp from "@gjermundgaraba/effect-actions/ActionMcp";

import { httpClientLayer } from "./http-client.js";
import { actions, server, services } from "./server.js";

ActionMcp.runStdio(actions, server).pipe(
  Effect.provide([NodeStdio.layer, Layer.provide(services, httpClientLayer)]),
  ActionCli.logToStderr,
  NodeRuntime.runMain,
);
