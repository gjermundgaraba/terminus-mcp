# terminus-mcp

An MCP server for agents that create and publish content to a
[Terminus](https://github.com/usetrmnl/terminus) instance.

The tools are [effect-actions](https://github.com/gjermundgaraba/effect-actions)
actions on [Effect](https://effect.website) v4, served over stdio or Streamable
HTTP. It needs Node.js 24.11 or newer.

## Status

The curated publishing API is implemented and verified against Terminus
`0.77.0`. See [docs/design.md](docs/design.md) for the API boundary and security
model.

The server exposes these tools:

- `get_display_context`, `list_screens`, `get_screen_image`, and
  `list_playlists` for Terminus discovery;
- `search_screen_docs` and `read_screen_doc` for agent-readable authoring and
  TRMNL Framework documentation;
- `create_screen` and `update_screen` for complete HTML/CSS screens;
- `save_playlist` for complete ordered playlist replacement;
- `assign_playlist` for the single allowed device mutation;
- `list_extensions`, `get_extension`, `create_extension`, `update_extension`,
  `create_extension_exchange`, and `update_extension_exchange` for extensions,
  which Terminus rebuilds into screens on a schedule from fetched or supplied
  data;
- `delete_screen`, `delete_playlist`, `delete_extension`, and
  `delete_extension_exchange`, which cannot be undone.

It deliberately does not expose authentication, firmware endpoints, model
mutation, device deletion, raw device credentials, exchange header values, or a
generic API proxy.

Extension exchanges make the Terminus server fetch URLs an agent chooses, so
run Terminus with its outbound network restricted; see
[docs/design.md](docs/design.md#extension-exchanges).

## Installation

Register the server with your MCP host:

```json
{
  "mcpServers": {
    "terminus": {
      "command": "npx",
      "args": ["-y", "terminus-mcp"],
      "env": {
        "TERMINUS_URL": "http://terminus.example:2300",
        "TERMINUS_LOGIN": "you@example.com",
        "TERMINUS_PASSWORD": "..."
      }
    }
  }
}
```

Or run the public container image:

```sh
docker run --rm -p 127.0.0.1:8002:8002 \
  -e MCP_HOST=0.0.0.0 \
  -e TERMINUS_URL -e TERMINUS_LOGIN -e TERMINUS_PASSWORD \
  ghcr.io/gjermundgaraba/terminus-mcp:latest
```

See [Configuration](#configuration) for the environment variables, the note on
credential handling, and the network the HTTP endpoint needs.

## Development

Development uses [Vite+](https://viteplus.dev) (`npm install -g vite-plus`):

```sh
git clone https://github.com/gjermundgaraba/terminus-mcp.git
cd terminus-mcp
vp install
vp run ready
```

Run the development server over stdio:

```sh
vp run dev
```

Or run its Streamable HTTP endpoint:

```sh
vp run dev:http
```

Build and run the compiled server:

```sh
vp pack
vp run start
# or
MCP_HOST=0.0.0.0 vp run start:http
```

Standard output is reserved for MCP messages. Diagnostics use standard error.

## Configuration

The MCP host must provide:

- `TERMINUS_URL`: Base URL of one Terminus instance.
- `TERMINUS_LOGIN`: Login email for the Terminus account.
- `TERMINUS_PASSWORD`: Login password for the Terminus account.

`TERMINUS_URL` must use HTTP or HTTPS and must not contain credentials.

The HTTP entrypoint additionally accepts:

- `MCP_HOST`: Listen address; defaults to `127.0.0.1`.
- `MCP_PORT`: Listen port from 1 to 65535; defaults to `8002`.
- `MCP_ALLOWED_ORIGINS`: Optional comma-separated exact origins, such as
  `https://ui.example.com`, a browser may call `/mcp` from. A request carrying
  any other `Origin` is refused with 403; one without `Origin`, as MCP clients
  outside a browser send, is served. An entry that is not an exact origin, such
  as one with a trailing slash or a path, stops the server at startup.

Credentials will never be accepted as MCP tool arguments, returned in tool
results, or intentionally written to logs. Inject them with the MCP host's
secret-management facility instead of committing them to its configuration.

For remote MCP clients, use `http://<host>:8002/mcp`. It speaks MCP
`2026-07-28` only; a host on an earlier revision runs the stdio server, which
also speaks `2025-11-25` and `2025-06-18`. `/healthz` provides a container
health check. The HTTP endpoint has no application-level authentication and
must remain on an access-controlled internal network.

## Verification

`vp run ready` runs formatting, linting, strict type checks, the tests, and a
production build. The tests call the tools through an in-memory MCP client
against a fake Terminus, and build the server to call it over stdio as an MCP
host would.

To verify against a configured Terminus instance:

```sh
vp run verify:live
```

The live check calls every action in process against the Terminus in
`TERMINUS_URL`, `TERMINUS_LOGIN` and `TERMINUS_PASSWORD`. It creates a
temporary screen, playlist, and unscheduled extension, with an exchange that
fetches the Terminus health check, and assigns the device's existing playlist
back to itself. It deletes the temporary objects with the delete tools, or
directly if the run fails first.

## License

[MIT](LICENSE)
