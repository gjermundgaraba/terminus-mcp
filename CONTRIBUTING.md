# Contributing

## Release

Note consumer-visible changes in [CHANGELOG.md](CHANGELOG.md). To release: bump `version` in `package.json`, commit, tag `v<version>` and push the tag. `.github/workflows/npm.yml` builds and publishes every package whose version npm does not have yet, through npm trusted publishing.

A new package's first version is published by hand with `vp pm publish`. Then trust the workflow to publish the next ones: `npm trust github <package> --repo <owner>/<repo> --file npm.yml`.

CI builds the container image on every run. Every push to `main` also publishes it, as `latest` and `sha-<commit>`.

## Dependencies

Dependabot keeps the SHA-pinned actions in `.github/workflows` current. It leaves npm dependencies alone on purpose: they move by hand, through the catalog in `pnpm-workspace.yaml`.
