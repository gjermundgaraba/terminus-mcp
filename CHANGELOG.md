# Changelog

## Unreleased

### Breaking changes

**Terminus `0.77.0` is the supported release.** `get_screen_image` reads the one screen through
`GET /api/screens/:id`, which Terminus added in `0.73.0`, instead of listing every screen.

- Migrate: upgrade Terminus to `0.77.0`.

### Changes

- `delete_screen` deletes a screen and removes it from every playlist; `delete_playlist` deletes a
  playlist and unassigns it from every device. Neither can be undone.
- Extensions: `list_extensions`, `get_extension`, `create_extension`, `update_extension` and
  `delete_extension`, with `create_extension_exchange`, `update_extension_exchange` and
  `delete_extension_exchange` for the URLs Terminus fetches their data from. Exchange header values
  are never returned. Exchanges make the Terminus server fetch URLs an agent chooses; restrict its
  outbound network.
- A Terminus validation failure names each field it refused. A refusal's detail is cut to 500
  characters instead of being dropped when long, and a refusal that is not JSON no longer echoes
  its body.
- `create_screen` and `update_screen` accept `mode: "text"`, the default, beside `dither`.

## 0.2.0

Rebuilt on Effect 4.0.2 and `@gjermundgaraba/effect-actions` 0.11.0, in place of the MCP SDK and
zod. The ten tools keep their names, inputs and results.

### Breaking changes

**The HTTP endpoint speaks MCP `2026-07-28` only.** It is stateless: every request stands alone.
The stdio server also speaks `2025-11-25` and `2025-06-18`.

- Migrate: connect a host on an earlier revision over stdio, or through a client that negotiates
  `2026-07-28`.

**`MCP_ALLOWED_ORIGINS` replaces `MCP_ALLOWED_HOSTS`, and the `Host` header is no longer checked.**
It lists the exact origins a browser may call `/mcp` from, none by default. A request with any
other `Origin` gets a 403; one without `Origin`, as MCP clients outside a browser send, is served.
An entry that is not an exact origin stops the server at startup.

- Migrate: drop `MCP_ALLOWED_HOSTS`; list browser origins, such as `https://ui.example.com`, in
  `MCP_ALLOWED_ORIGINS`.

**`MCP_PORT` must be from 1 to 65535**, and a request body may be at most 8 MiB.

### Changes

- Each Terminus call has 60 seconds, including any token renewal and its retry.
- No outbound request follows a redirect.
- A screen image or documentation download stops reading once it passes its size limit, whether or
  not it declares a `Content-Length`.
- The documentation catalog is cached for an hour; a failed build is not.
- Tool inputs are trimmed and validated by Effect Schema, and an invalid setting stops the server
  at startup.

## 0.1.0

Initial release.
