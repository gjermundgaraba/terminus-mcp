# Contributing

## Release

Record each change a consumer notices under `## Unreleased` at the top of
[CHANGELOG.md](CHANGELOG.md), in the change that makes it: every breaking change and how a
consumer migrates. To release: set `version` in `package.json`, rename `## Unreleased` to the
version, commit as `Prepare <version>`, tag `v<version>`, and push the commit and tag.

The tag runs `.github/workflows/npm.yml`, which checks that the tag matches `version`, runs
`vp run ready`, and publishes. It authenticates as the package's npm trusted publisher (this
repository and that workflow file, set under the package's npm settings), so there is no registry
token, and npm attaches provenance. `prepublishOnly` builds; `files` ships `dist` and the
authoring guide.

Every push to `main` also publishes the container image, as `latest` and `sha-<commit>`.
