import ultracite from "ultracite/oxfmt";
import type { OxfmtConfig } from "vite-plus/fmt";

export default {
  ...ultracite,
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), "AGENTS.md"],
} satisfies OxfmtConfig;
