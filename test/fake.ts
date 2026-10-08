import { assert } from "@effect/vitest";
import * as Testing from "@gjermundgaraba/effect-actions/Testing";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { routes } from "../src/http.js";
import { services } from "../src/server.js";

export interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

/** An HttpClient answering every request with `respond`, as Terminus or TRMNL would. */
export const fakeHttp = (respond: (request: Sent) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          respond({
            method: request.method,
            url,
            authorization: request.headers.authorization,
            body:
              request.body._tag === "Uint8Array"
                ? JSON.parse(new TextDecoder().decode(request.body.body))
                : undefined,
          }),
        ),
      ),
    ),
  );

export const terminusEnvironment = {
  TERMINUS_URL: "https://terminus.example.test",
  TERMINUS_LOGIN: "agent@example.test",
  TERMINUS_PASSWORD: "secret",
};

/** Configuration from `environment` beside the Terminus account's. */
export const configured = (environment: Record<string, string> = {}) =>
  ConfigProvider.layer(ConfigProvider.fromEnvRecord({ ...terminusEnvironment, ...environment }));

/** The server's services over one fake HttpClient: Terminus at its origin, TRMNL at theirs. */
export const fakeServices = (respond: (request: Sent) => Response) =>
  Layer.provide(
    services,
    fakeHttp((request) => trmnlDocs(request) ?? respond(request)),
  );

/** The HTTP routes in memory over `respond`, configured with `environment`. */
export const serve = (
  respond: (request: Sent) => Response,
  environment: Record<string, string> = {},
) =>
  Testing.layer(routes).pipe(
    Layer.provide(fakeServices(respond)),
    Layer.provide(configured(environment)),
  );

/** One MCP request to the served routes, with `headers`, answered with the response as sent. */
export const send = (
  method: string,
  params?: Testing.McpParams,
  headers: Record<string, string> = {},
) => HttpClient.execute(Testing.mcpRequest(method, params, { headers }));

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const png = new Uint8Array([137, 80, 78, 71]);

/**
 * A Terminus holding `device`, `model`, `screen` and `playlist`, which `routes` may extend or
 * override. Every API request must carry the token its one login issued.
 */
export const terminus =
  (routes: (request: Sent) => Response | undefined = () => undefined) =>
  (request: Sent): Response => {
    const { method, url, authorization, body } = request;
    if (url.pathname === "/login") {
      assert.deepStrictEqual(body, { login: "agent@example.test", password: "secret" });
      return json({ access_token: "access", refresh_token: "refresh" });
    }
    if (url.pathname === "/uploads/screen.png") {
      assert.strictEqual(authorization, undefined);
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    }

    assert.strictEqual(authorization, "access");
    const answer = routes(request);
    if (answer) return answer;
    if (method === "GET") {
      switch (url.pathname) {
        case "/api/devices":
          return json({ data: [device] });
        case "/api/models":
          return json({ data: [model] });
        case "/api/screens":
          return json({ data: [screen] });
        case "/api/playlists":
          return json({ data: [playlist] });
      }
    }
    return assert.fail(`Unexpected Terminus request: ${method} ${url.href}`);
  };

const text = (body: string, contentType: string) =>
  new Response(body, { headers: { "Content-Type": contentType } });

/** How often each TRMNL documentation URL was fetched, in this test file. */
export const docsFetches = new Map<string, number>();

/** TRMNL's documentation pages, or undefined for a request to another host. */
export function trmnlDocs({ url }: Sent): Response | undefined {
  if (url.hostname !== "trmnl.com" && url.hostname !== "docs.trmnl.com") return undefined;
  docsFetches.set(url.href, (docsFetches.get(url.href) ?? 0) + 1);

  switch (url.href) {
    case "https://trmnl.com/framework":
      return text(
        '<a href="/framework/docs/3.0">3.0</a><a href="/framework/docs/3.1">3.1</a>',
        "text/html",
      );
    case "https://docs.trmnl.com/go/llms.txt":
      return text(
        "- [Screen Templating](https://docs.trmnl.com/go/private-plugins/templates.md): Build screens.",
        "text/markdown",
      );
    case "https://trmnl.com/framework/docs/3.1":
      return text(
        '<a href="/framework/docs/3.1/structure">Structure</a>' +
          '<a href="/framework/docs/3.1/screen">Screen</a>' +
          '<a href="/framework/docs/3.1/layout">Layout</a>' +
          '<a href="/framework/docs/3.1/framework_runtime">Runtime</a>',
        "text/html",
      );
    case "https://trmnl.com/framework/examples":
      return text('<a href="/framework/examples/weather">Weather</a>', "text/html");
    case "https://trmnl.com/framework/docs/3.1/structure.md":
      return text("# Structure", "text/markdown");
  }
  return assert.fail(`Unexpected documentation request to ${url.href}`);
}

export const model = {
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

export const screen = {
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

export const playlist = {
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

export const device = {
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
