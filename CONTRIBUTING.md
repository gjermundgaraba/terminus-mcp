# Contributing

## Release

Note consumer-visible changes in [CHANGELOG.md](CHANGELOG.md). To release: bump `version` in
`package.json`, commit, tag `v<version>` and push the tag. `.github/workflows/npm.yml` builds and
publishes it through npm trusted publishing.

Every push to `main` also publishes the container image, as `latest` and `sha-<commit>`.
