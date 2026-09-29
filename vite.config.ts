import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      // Resolve subpaths of dependencies without an `exports` map, so the output loads in Node unbundled.
      resolveDepSubpath: true,
    },
    entry: ["src/index.ts", "src/http.ts"],
    platform: "node",
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
