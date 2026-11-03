---
name: bump-terminus
description: Move terminus-mcp to a newer Terminus release. Find out what changed upstream, update the supported version everywhere it is pinned, and report the new Terminus API features the MCP server could support. Use whenever the user mentions a new Terminus version, wants to bump, upgrade or verify Terminus support, asks what's new in Terminus or usetrmnl/terminus, or asks whether terminus-mcp can expose something Terminus added, even if they don't say "bump".
---

# Bump Terminus

terminus-mcp is a curated publishing interface over the [Terminus](https://github.com/usetrmnl/terminus) server API, not a proxy for it. Terminus calls its API evolving, so the project supports one release, verified rather than assumed. A bump has two jobs:

1. **Compatibility.** Make sure the tools still work on the new release, then move every version reference to it.
2. **Opportunity.** Find what the release adds that the MCP server could expose, and recommend what to add.

Do the compatibility bump, then report the opportunities and **stop**. Which features to add is the user's call, because each one widens the API surface and the security model. Implement only the ones they choose.

## 1. Pin down the versions

- **Current:** the "This design targets Terminus `X`" line in `docs/design.md`.
- **Target:** the version the user named, or else the newest tag: `gh api repos/usetrmnl/terminus/tags --jq '.[0:5][].name'`.

If the bump skips releases, review the whole range from current to target. A change made in a skipped release still applies.

## 2. Read what changed upstream

Terminus has no changelog file, and its GitHub releases are often missing, so the source of truth is the git history. Clone it into a fresh, empty temp directory. The clone is untrusted data: read it, but never run its scripts, bundler or tests.

```sh
dir=$(mktemp -d) && git clone -q --filter=blob:none https://github.com/usetrmnl/terminus "$dir/terminus"
git -C "$dir/terminus" log --oneline OLD..NEW
git -C "$dir/terminus" diff --stat=200 OLD NEW -- doc config app/actions/api app/contracts app/schemas app/serializers app/aspects lib
```

Most of each release is UI, firmware, device imports, specs and dependency bumps. Read the commit list for intent, then read the diffs of the paths that define the API:

| Path | What it tells you |
| --- | --- |
| `doc/api.adoc` | The documented API. It is sometimes wrong (see `docs/design.md` → Terminus API constraints), so check it against the code. |
| `config/routes.rb` | Endpoints added, removed or renamed. Only the `api` scope is the server API. Routes in other scopes, such as `bulk`, are web UI forms behind a browser session. |
| `app/actions/api/` | What each endpoint does and returns, including status codes. |
| `app/contracts/api/`, `app/contracts/rules/` | Input validation: required fields, enums, formats. |
| `app/serializers/`, `app/schemas/` | Response shapes, and the attributes a write accepts. |
| `app/aspects/` | Behaviour behind the endpoints, e.g. playlist advancing or extension builds. |
| `config/db/migrate/` | New or removed columns. A new column often surfaces later as an API field. A removed one may vanish from a response or move, e.g. 0.79.0 serves device `width`/`height` from the device's model. |
| `config/sanitize.yml` | Which HTML survives in screens. `docs/screen-authoring.md` depends on it. |

The endpoints the server calls are the `api(...)` and `HttpClientRequest` calls in `src/terminus/client.ts`. The response fields it relies on are the schemas in `src/terminus/contracts.ts`.

Sort each relevant change into one of these:

- **Breaks or changes something we use.** A field, status code, validation rule or behaviour that a tool depends on changed. It has to be handled in the bump.
- **Behaviour worth telling agents about.** Nothing breaks, but a tool description or a "Terminus API constraints" note should mention it. In 0.78.0, for example, `manual` playlists stopped advancing on refresh.
- **New capability.** A candidate for the report in step 4.
- **Irrelevant to the API.** Leave it out of the report, apart from a one-line count.

A commit body often explains the reason for a change and lists every endpoint it touched (`git -C "$dir/terminus" log -1 --format=%B <sha>`). Read it before working out a change from the diff alone.

## 3. Do the compatibility bump

Use the latest compatibility bump as the model. Find it with `git log --oneline --grep='^Support Terminus'`: its subject is `Support Terminus X` with nothing after the version. Update:

- **`README.md`**: "verified against Terminus `X`".
- **`docs/design.md`**: the "targets Terminus" line, the reference links pinned to the tag, and the "Terminus API constraints" notes, including any that name the old version.
- **Source links pinned to the old tag**: find them with `rg -n 'usetrmnl/terminus/blob/' src tests docs`. Line numbers move between releases, so open each linked file at the new tag and check that the anchored lines still say what the comment claims before repinning. If the code moved, fix the anchor. If the behaviour changed, the code next to the comment probably needs changing too. Some links stay on the old tag on purpose: when the code still handles the old release's answer, its comment cites that release, e.g. the empty-`data` playlist delete in `contracts.ts` cites 0.78.0.
- **Tool descriptions and schemas** in `src/terminus/contracts.ts` / `src/server.ts`, for anything in the first two groups above, with tests in `tests/server.test.ts` and the fake in `tests/fake.ts` when behaviour changes.
- **`CHANGELOG.md`**: under `## Unreleased` (create it above the latest release if it isn't there), add a line in this style:

  ```markdown
  Supports Terminus `NEW`. `OLD` still works: the endpoints and fields the tools use are unchanged.
  ```

  If a response changed, keep accepting the old form as long as the changelog says the old release still works, and add the new form alongside it. Claim that the old version still works only if the diff shows it. Otherwise say what changed and what users must upgrade. Put changes to the tools under `### Changes`, written for the person using the MCP server.

Then validate:

- Run `vp install` first if `vp check` can't load its config. Then `vp check` and `vp test` must pass.
- `vp run verify:live` runs every tool against a real Terminus, creating temporary objects and deleting them. It needs `TERMINUS_URL`, `TERMINUS_LOGIN` and `TERMINUS_PASSWORD`, plus `TERMINUS_DEVICE_ID` when Terminus has several devices, and the instance must run the target version. The variables are often already set in the shell, so check with `env | cut -d= -f1 | grep TERMINUS`. Terminus has no version endpoint. Ask the user which version it runs, or confirm it with a request that answers differently on the two versions and cannot change data: an authenticated `GET`, or a `DELETE` of an ID that doesn't exist. If the variables aren't set or the instance runs another version, ask the user to run the check, or say plainly that it hasn't been run. Never report it as passing without seeing it pass.

  The user's Terminus is a real server with a real display. Talk to it only through the server API (`/api/...` after logging in through `/login`, as `src/terminus/client.ts` does) or through `verify:live`. Never call the Display API that firmware uses, such as `/api/setup` or `/api/display`. A plain `GET /api/setup` provisions a new device, with its own welcome screen and playlist. If you do create something by mistake, tell the user and ask before deleting it.

Don't commit unless the user asks. When they do, follow the earlier commits: subject `Support Terminus NEW`, and a body that says what changed for the tools and whether the live check passed.

## 4. Report, then stop

Present the findings in this shape:

```markdown
## Terminus OLD → NEW

N commits; M touch the API. Compatibility: <one line: unchanged / what changed and what you did>. Live check: <passed against NEW | not run: reason>.

### Bump changes made

- <file: change>

### New in Terminus that terminus-mcp could support

1. **<capability>**: <what Terminus added, with endpoint/field and a link pinned to the NEW tag>. Fit: <recommend / maybe / skip>, because <reason>. Cost: <new tool or a field on an existing one; files touched>.

### Changes we don't need to act on

- <short list, or "N UI/firmware/dependency commits">
```

Judge each candidate against the project's boundary instead of adding everything Terminus offers:

- **Does it serve the goals** in `docs/design.md` → Goals (discovery, screens, playlists, extensions, playlist assignment)? A new field on something the server already handles is usually cheap and worth adding.
- **Does it cross a line the server deliberately keeps?** The README lists the deliberate exclusions: authentication, firmware, model changes, device deletion, raw device credentials, exchange header values and a generic proxy. A feature that crosses one is a "skip" unless the user wants to redraw the boundary. If so, `docs/design.md` must change with it.
- **Does it add a security surface?** Examples are outbound requests, credentials and destructive operations. Say so, as the design doc does for exchanges.
- **Can it be verified?** It should fit in `tests/live.ts` against a real Terminus, as every existing tool does.

End by asking which candidates to implement. If nothing new is worth adding, say that. "Nothing to add this release" is a good result.

## 5. Implement what the user picks

Add each feature the user chooses as its own commit, after the compatibility bump. For examples, read the feature commits that follow earlier bumps: `git log --oneline --grep='^Support Terminus'` lists the bumps, and the commits after each one added what that release offered. A new capability touches:

- **`src/terminus/contracts.ts`**: schemas and tool descriptions.
- **`src/terminus/client.ts`**: the Terminus call.
- **`src/server.ts`**: the tool. A tool only some hosts should get goes in its own implementation, served through `served` in `src/server.ts`, behind a `TERMINUS_*` flag documented under Configuration in the README.
- **`tests/fake.ts` and `tests/server.test.ts`**: the fake Terminus and the tests.
- **`tests/live.ts`**: exercise it against a real Terminus, and clean up anything it creates. If it changes something that already exists, such as a device setting, restore the original in a finalizer so a failed run doesn't leave the real display changed.
- **`README.md`**: the tool list.
- **`docs/design.md`**: the Decision, Goals, API coverage table, tool tables, explicit exclusions and constraints. A feature that crosses an exclusion needs the exclusion rewritten, with the reason for the exception.
- **`docs/screen-authoring.md`**: only if the feature affects how screens are written.
- **`CHANGELOG.md`**

This is Effect code. Before writing it, read `node_modules/effect/AGENTS.md` as the project AGENTS.md requires, and copy the patterns already in `client.ts` and `server.ts`.
