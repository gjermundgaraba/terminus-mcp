import { defineConfig } from "vite-plus";

import fmt from "./oxfmt.config.js";
import lint from "./oxlint.config.js";

export default defineConfig({
  fmt,
  lint,
  pack: {
    deps: {
      resolveDepSubpath: true,
    },
    entry: ["src/index.ts", "src/http.ts"],
    platform: "node",
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    globalSetup: ["tests/build.ts"],
  },
});
