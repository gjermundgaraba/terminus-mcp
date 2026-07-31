# terminus-mcp

An MCP server for agents that create and publish content to a
[Terminus](https://github.com/usetrmnl/terminus) instance.

The project targets version 2 of the official
[Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
and Node.js 24.2 or newer.

## Status

The curated publishing API is implemented and verified against Terminus
`0.67.0`. See [docs/design.md](docs/design.md) for the API boundary and security
model.

The server exposes ten tools:

- `get_display_context`, `list_screens`, `get_screen_image`, and
  `list_playlists` for Terminus discovery;
- `search_screen_docs` and `read_screen_doc` for agent-readable authoring and
  TRMNL Framework documentation;
- `create_screen` and `update_screen` for complete HTML/CSS screens;
- `save_playlist` for complete ordered playlist replacement;
- `assign_playlist` for the single allowed device mutation.

It deliberately does not expose authentication, firmware endpoints, deletion,
model mutation, raw device credentials, or a generic API proxy.

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

See [Configuration](#configuration) for the environment variables and the
note on credential handling.

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

Or run its native Streamable HTTP endpoint:

```sh
MCP_HOST=0.0.0.0 MCP_PORT=8002 vp run dev:http
```

Build and run the compiled server:

```sh
vp pack
vp run start
# or
MCP_HOST=0.0.0.0 MCP_PORT=8002 vp run start:http
```

Standard output is reserved for MCP messages. Diagnostics use standard error.

## Configuration

The MCP host must provide:

- `TERMINUS_URL`: Base URL of one Terminus instance.
- `TERMINUS_LOGIN`: Login email for the Terminus account.
- `TERMINUS_PASSWORD`: Login password for the Terminus account.

The HTTP entrypoint additionally accepts:

- `MCP_HOST`: Listen address; defaults to `127.0.0.1`.
- `MCP_PORT`: Listen port; defaults to `8002`.
- `MCP_ALLOWED_HOSTS`: Optional comma-separated additional `Host` and `Origin`
  hostnames. `terminus-mcp` and loopback names are allowed by default.

Credentials will never be accepted as MCP tool arguments, returned in tool
results, or intentionally written to logs. Inject them with the MCP host's
secret-management facility instead of committing them to its configuration.

For remote MCP clients, use `http://<host>:8002/mcp`. `/healthz` provides a
container health check. The HTTP endpoint has no application-level
authentication and must remain on an access-controlled internal network.

## Verification

`vp run ready` runs formatting, linting, strict type checks, protocol-level
tests through the official MCP client, and a production build.

To verify against a configured Terminus instance:

```sh
vp run verify:live
```

The live check exercises all ten tools. It creates a temporary screen and
playlist, assigns the device's existing playlist back to itself, and deletes
the temporary objects before exiting.

## License

[MIT](LICENSE)
