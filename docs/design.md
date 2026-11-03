# Design

## Decision

The first release will be a curated content-publishing interface, not a one-to-one proxy for the Terminus API.

It will cover screen creation, playlist management, extensions, safe discovery, and two narrow device mutations: assigning a playlist, and setting when a display refreshes and sleeps. A host may also opt into defining display models. Authentication remains an internal implementation detail.

This design targets Terminus `0.79.0`. Terminus marks its server API as evolving, so compatibility with a release is tested rather than assumed.

References:

- [Terminus API](https://github.com/usetrmnl/terminus/blob/0.79.0/doc/api.adoc)
- [Terminus routes](https://github.com/usetrmnl/terminus/blob/0.79.0/config/routes.rb)
- [Terminus HTML sanitizer](https://github.com/usetrmnl/terminus/blob/0.79.0/config/sanitize.yml)
- [effect-actions](https://github.com/gjermundgaraba/effect-actions)

## Goals

An agent should be able to:

1. Discover a display's model, dimensions, capabilities, current playlist, and whether newer firmware is available for it.
2. Find and read the relevant TRMNL screen-authoring documentation.
3. Discover existing screens and inspect their rendered images.
4. Create or replace a screen from complete HTML and CSS.
5. Create or replace an ordered playlist and assign it to a device.
6. Create extensions that Terminus rebuilds into screens on a schedule, from static data, fetched data, or data the agent supplies.
7. Set how often a display asks for its next screen, and when it sleeps.
8. When the host allows it, define a model for hardware Terminus does not know.

The server should be safe to run as a local stdio process or a Streamable HTTP service on an access-controlled network, with Terminus credentials provided by its runtime.

## API coverage

| Terminus API | Initial coverage | Notes |
| --- | --- | --- |
| Authentication | Internal | Login and JWT refresh are never MCP tools. |
| Models | Read; create and update when the host opts in | Supplies rendering dimensions and display capabilities. Only models created in Terminus can be changed. |
| Devices | Restricted read and write | Redacted status, `playlist_id` assignment, and label, refresh rate, and sleep window only. |
| Screens | List, create, update, and delete | Includes retrieval of the rendered image. |
| Playlists | List, create, update, and delete | Supports ordered screen membership. |
| Extensions | List, create, update, and delete | Includes their exchanges, without header values. |
| Firmware | Read-only | Only the newest version for a device's model, in the display context. |

## MCP tools

### Discovery

| Tool | Purpose |
| --- | --- |
| `get_display_context` | Return a redacted device, its model, its current playlist, and the newest firmware for its model. |
| `search_screen_docs` | Find the local authoring guide and official TRMNL Framework documentation. |
| `read_screen_doc` | Read a document selected by its server-issued documentation ID. |
| `list_screens` | Return screen metadata for selection and filtering. |
| `get_screen_image` | Return a rendered screen image to a multimodal agent. |
| `list_playlists` | Return playlists and their ordered screen membership. |
| `list_extensions` | Return extensions, with their templates, data, schedules, and targets. |
| `get_extension` | Return one extension and its exchanges' fetched data and errors. |

### Content and publication

| Tool | Purpose |
| --- | --- |
| `create_screen` | Render complete HTML/CSS for a model, optionally adding it to a playlist. |
| `update_screen` | Replace an existing screen's rendered content. |
| `save_playlist` | Create or replace a playlist and its complete ordered screen list. |
| `assign_playlist` | Set only the `playlist_id` of a device. |
| `update_display_settings` | Set only the label, `refresh_rate`, and sleep window of a device. |

### Extensions

| Tool | Purpose |
| --- | --- |
| `create_extension` | Create an extension from a Liquid template, data, schedule, and targets. |
| `update_extension` | Change an extension's given fields, keeping its models and devices. |
| `create_extension_exchange` | Add URLs for Terminus to fetch an extension's data from. |
| `update_extension_exchange` | Change an exchange's given fields. |

### Models, when `TERMINUS_MODEL_TOOLS` is true

| Tool | Purpose |
| --- | --- |
| `create_model` | Define a model's size, bit depth, colors, image type, rotation, offsets, palette, and Framework CSS. |
| `update_model` | Change the given fields of a model of kind `terminus`. |

### Deletion

| Tool | Purpose |
| --- | --- |
| `delete_screen` | Delete one screen by ID, removing it from every playlist that holds it. |
| `delete_playlist` | Delete one playlist by ID, unassigning it from every device that uses it. |
| `delete_extension` | Delete one extension by ID, with its exchanges and schedule. |
| `delete_extension_exchange` | Delete one exchange by its extension's ID and its own. |

Tool results return structured data, with its JSON as their text. `get_screen_image` also returns the rendered image as an image block, so a multimodal agent sees it. A Terminus failure is a declared `TerminusError`, and a documentation failure a `DocsError`, each with a message for the agent. Mutating tools must have accurate MCP read-only/destructive annotations, but those annotations are advisory and are not a security boundary.

## Explicit exclusions

### Firmware-facing API

Do not expose:

- `GET /api/display`
- `GET /api/setup`
- `POST /api/log`

Those endpoints exist for device firmware. Exposing them would let an agent impersonate a device or inject device telemetry without helping the content workflow.

### Administrative mutations

Do not expose firmware, model deletion, or full device CRUD. These operations can:

- install untrusted firmware or make a device unavailable;
- alter image conversion for every screen associated with a model;
- change device identity, firmware flags, commands, or other operational configuration;
- delete a physical device's server-side registration.

Read-only model data remains necessary for screen rendering.

Creating and changing models is the opt-in exception, for hardware Terminus does not know. A model sets image conversion for every screen of every device that uses it, so the server lists `create_model` and `update_model` only when its host sets `TERMINUS_MODEL_TOOLS`. `update_model` refuses a model whose kind is not `terminus`: Terminus's model sync from TRMNL upserts every model TRMNL lists by name, so a change to one of them would not last, and a created model whose name TRMNL uses is overwritten the same way. Deleting a model also deletes every device and screen that uses it, so there is no `delete_model`.

A device's label, refresh rate, and sleep window are the exception: they decide when content shows, which is part of publishing it, and `update_display_settings` changes nothing else. Its image timeout, a firmware download limit, stays excluded.

Firmware is read only to tell whether a newer version exists for a device's model. Uploading firmware and setting a device's `firmware_update` flag stay excluded.

### Generic API proxy

Do not provide a tool such as `terminus_request(method, path, body)`. It would bypass the curated capability boundary and make every future Terminus endpoint implicitly available to agents.

### Unsupported UI features

Do not scrape the Terminus UI or access its database to automate Designs, palettes, users, device-log reads, or extension builds, previews, imports, and clones. These can be added if Terminus publishes supported server API endpoints for them.

## Deletion

Every content resource the server can create can also be deleted: screens, playlists, extensions, and exchanges. Device, model, and firmware deletion stay excluded as administrative mutations, though the opt-in model tools can create a model.

Each deletion is its own tool, taking one ID and marked destructive. Deletion must never be hidden inside an upsert or generic mutation tool, and a tool must not delete more than the one resource it names; Terminus's own cascades are the only side effects:

- Deleting a screen deletes its items from every playlist.
- Deleting a playlist deletes its items and clears `playlist_id` on every device and model that used it, so those devices stop rotating it.
- Deleting an extension deletes its exchanges, its model and device targets, and its schedule. The screens it built are kept, and no longer updated.

Deletion cannot be undone: Terminus keeps no copy of a deleted resource.

## Security model

### Credentials and authentication

The MCP process receives the Terminus URL, login, and password through its environment. It exchanges them for a short-lived access token and refresh token, keeps tokens in memory, and refreshes them internally. Each Terminus call has 60 seconds, including any token renewal and its retry.

The server must:

- never expose authentication as a tool;
- never return or log credentials or tokens;
- verify TLS certificates by default;
- support one configured Terminus instance per MCP process;
- reject unexpected cross-origin URLs returned by Terminus.

Terminus currently has broad account permissions rather than scoped API service accounts. The MCP tool surface is therefore the effective least-privilege boundary.

### MCP callers

The server does not authenticate its callers. Over stdio, the caller is the host that launched the process. The HTTP endpoint has no application-level authentication and must stay on an access-controlled internal network.

The endpoint refuses a request whose `Origin` is not one of the exact origins in `MCP_ALLOWED_ORIGINS`, none by default, so a browser page elsewhere cannot call it.

`TERMINUS_URL` may not contain credentials; only its origin and path are used, so they would otherwise be dropped silently.

Documentation tools accept server-issued IDs rather than arbitrary URLs. Every documentation URL is a constant or is built from a slug of `[a-z0-9_-]`, so Markdown is fetched only over HTTPS from TRMNL's origins, without Terminus credentials, redirects, or caller-supplied query parameters. Responses have content-type, timeout, and size limits. The catalog is cached for an hour. Search needs TRMNL reachable, since the catalog is built from its pages, but `read_screen_doc` reads the authoring guide without it.

Every download, a document or a screen image, stops reading once it passes its size limit, whether or not it declares a `Content-Length`.

No outbound request follows a redirect: the process's one HTTP client answers with the redirect itself.

### Device data

Raw device responses contain `api_key` and `mac_address`. Both must be removed before returning data to an agent because either can participate in device API authentication.

Safe device output is limited to fields useful for selection and diagnostics, such as:

- ID and label;
- model and playlist IDs;
- firmware version, and whether Terminus offers it updates;
- battery, charging, Wi-Fi, and synchronization status;
- display dimensions, refresh rate, and sleep window.

### Untrusted screen content

Terminus renders supplied HTML in a headless browser and permits scripts and external resources. Its URI screen modes also download caller-supplied URLs. Agent-generated screen content can therefore cause outbound requests from the Terminus renderer.

The tools do not expose the `uri` or `preprocessed` screen modes. This reduces the obvious remote-download surface but does not make arbitrary HTML safe. Terminus must run with renderer egress and network access restricted so it cannot reach sensitive internal services.

MCP-side string matching is not considered a sufficient HTML or SSRF defense.

### Extension exchanges

An exchange makes the Terminus server, not its renderer, fetch caller-supplied URLs with caller-supplied headers and bodies: when it is created or updated, and on every build of a `poll` extension. This is a deliberate server-side outbound-request surface. Terminus must run with its egress restricted so it cannot reach sensitive internal services, as for the renderer.

Exchange headers are where credentials for a data source live, including ones an operator entered in the Terminus UI, so the tools return header names and never their values. Exchange URLs and bodies, and extension `data`, can also carry credentials an operator put there; they are returned, because an agent cannot write or correct a template without them.

The data an exchange fetched is returned whole by `get_extension`, without a size limit beyond the call's timeout.

## Terminus API constraints

- Screen listings contain rendered-image metadata, not the original HTML. Updating a screen requires complete replacement content.
- There is no non-persistent server API preview. Rendering creates or updates a real screen.
- Playlist updates replace their item collection. The tool must make that replacement explicit and avoid presenting it as an additive update.
- `GET /api/screens/:id` answers a missing screen with HTTP 200 and a 404 problem as its body.
- A `manual` playlist stays on its current screen until the device's button moves it; before `0.78.0` every refresh advanced it, as for `automatic`.
- A device patch for a missing device fails with HTTP 500, not 404.
- Sleep times are the Terminus server's local time, returned as `HH:MM:SS`. Terminus refuses a sleep start without a stop, and while a device is asleep it serves Terminus's sleep screen without moving the playlist.
- There is no scoped token or service-account API in Terminus `0.79.0`.
- Extension and exchange reads answer a missing resource like screens do; patches and deletes answer it with HTTP 404, as a playlist delete does from `0.79.0`; before, it answered with empty `data`. A missing extension's exchange list is empty.
- An extension patch clears the models and devices it omits, checks a schedule's `interval` and `unit` only together, and refuses an empty `extension`. `update_extension` reads the extension first and sends its current models, devices, and schedule unless the input replaces them.
- The API cannot build an extension's screens or preview them; they appear only on its schedule.
- `GET /api/extensions` lists extensions directly in `data`, not each wrapped in its own `data` as the API documentation shows.
- Terminus rate-limits by client IP, except from loopback and private networks: 300 requests in 5 minutes, then HTTP 503. Login is limited to 5 attempts a minute per account, and a request without a `User-Agent` is refused.

The MCP server will not create a shadow database for missing source HTML. Callers that need durable editable source should keep it in their own project.
