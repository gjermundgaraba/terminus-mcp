# Changelog

## Unreleased

Built on Effect `4.0.6` and `@gjermundgaraba/effect-actions` `0.21.0`.

### Breaking changes

- Requires Node `26.12` or later, where it ran on any Node `26`.

## 0.4.0

Built on Effect `4.0.6` and `@gjermundgaraba/effect-actions` `0.20.0`. Supports Terminus `0.78.0`. `0.77.0` still works: the endpoints and fields the tools use are unchanged.

### Breaking changes

- Requires Node `26` or later, where it ran on Node `24.11.0` and later.

### Changes

- `save_playlist` describes its `mode`. On Terminus `0.78.0` a `manual` playlist stays on its current screen until the device's button moves it; `automatic` moves on every refresh, as both modes did on `0.77.0`.

## 0.3.4

Built on Effect `4.0.5` and `@gjermundgaraba/effect-actions` `0.18.2`.

### Changes

- The container image runs Node `26.12.0` on Debian trixie, where it ran Node 24 on bookworm. The npm package still runs on Node `24.11` or later, and CI tests that floor beside `26.12.0`.
- The tools, their schemas and the MCP revisions served are as in `0.3.3`.

## 0.3.3

Built on Effect `4.0.4` and `@gjermundgaraba/effect-actions` `0.15.0`.

### Changes

- The HTTP endpoint tells a `2026-07-28` client its tool list does not change, with `listChanged: false` in `server/discover`, and refuses `subscriptions/listen` as method not found: the tools are fixed at startup. A `2025-11-25` or `2025-06-18` session's `initialize` still advertises `listChanged: true`, as Effect leaves those revisions unchanged; no change is ever sent.
- The README says what the HTTP endpoint serves: MCP `2026-07-28`, `2025-11-25` and `2025-06-18`, with a session for a 2025 client until it ends it or the server stops. The `0.2.0` entry's "`2026-07-28` only" stopped being true in `0.3.1`, built on effect-actions `0.13.0`, as effect-actions `0.12.0` added the 2025 revisions over HTTP.

## 0.3.2

Built on Effect `4.0.4` and `@gjermundgaraba/effect-actions` `0.14.0`.

### Changes

- An npm install installs one `effect`. `@effect/platform-node` takes `@effect/platform-node-shared` by caret, and Effect `4.0.4`'s requires `effect` `^4.0.4`, so an install of `0.3.1` or earlier since then put a second `effect` under it. The package now depends on `@effect/platform-node-shared` at its own `effect` version.
- A width or height's `minimum: 0` is back beside the safe-integer `maximum` instead of in an `allOf`, and an id's `exclusiveMinimum: 0` replaces the safe-integer `minimum`, as Effect `4.0.4` tightens colliding bounds in place. The values a tool accepts are unchanged.

## 0.3.1

Built on Effect `4.0.3` and `@gjermundgaraba/effect-actions` `0.13.0`.

### Changes

- An integer parameter's JSON Schema carries the safe-integer range, as Effect `4.0.3`'s `Schema.Int` advertises it. A width or height's `minimum: 0` moves into an `allOf`; an id's `exclusiveMinimum: 0` stays beside the range. The values a tool accepts are unchanged.

## 0.3.0

Supports Terminus `0.77.0`, with deletion and extensions: twenty tools, up from ten.

### Breaking changes

**Terminus `0.77.0` is the supported release.** `get_screen_image` reads the one screen through `GET /api/screens/:id`, which Terminus added in `0.73.0`, instead of listing every screen.

- Migrate: upgrade Terminus to `0.77.0`.

### Changes

- `delete_screen` deletes a screen and removes it from every playlist; `delete_playlist` deletes a playlist and unassigns it from every device. Neither can be undone.
- Extensions: `list_extensions`, `get_extension`, `create_extension`, `update_extension` and `delete_extension`, with `create_extension_exchange`, `update_extension_exchange` and `delete_extension_exchange` for the URLs Terminus fetches their data from. Exchange header values are never returned. Exchanges make the Terminus server fetch URLs an agent chooses; restrict its outbound network.
- A Terminus validation failure names each field it refused. A refusal's detail is cut to 500 characters instead of being dropped when long, and a refusal that is not JSON no longer echoes its body.
- `create_screen` and `update_screen` accept `mode: "text"`, the default, beside `dither`.

## 0.2.0

Rebuilt on Effect 4.0.2 and `@gjermundgaraba/effect-actions` 0.11.0, in place of the MCP SDK and zod. The ten tools keep their names, inputs and results.

### Breaking changes

**The HTTP endpoint speaks MCP `2026-07-28` only.** It is stateless: every request stands alone. The stdio server also speaks `2025-11-25` and `2025-06-18`.

- Migrate: connect a host on an earlier revision over stdio, or through a client that negotiates `2026-07-28`.

**`MCP_ALLOWED_ORIGINS` replaces `MCP_ALLOWED_HOSTS`, and the `Host` header is no longer checked.** It lists the exact origins a browser may call `/mcp` from, none by default. A request with any other `Origin` gets a 403; one without `Origin`, as MCP clients outside a browser send, is served. An entry that is not an exact origin stops the server at startup.

- Migrate: drop `MCP_ALLOWED_HOSTS`; list browser origins, such as `https://ui.example.com`, in `MCP_ALLOWED_ORIGINS`.

**`MCP_PORT` must be from 1 to 65535**, and a request body may be at most 8 MiB.

### Changes

- Each Terminus call has 60 seconds, including any token renewal and its retry.
- No outbound request follows a redirect.
- A screen image or documentation download stops reading once it passes its size limit, whether or not it declares a `Content-Length`.
- The documentation catalog is cached for an hour; a failed build is not.
- Tool inputs are trimmed and validated by Effect Schema, and an invalid setting stops the server at startup.

## 0.1.0

Initial release.
