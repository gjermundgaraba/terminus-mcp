import { spawnSync } from "node:child_process";

import type { TestProject } from "vite-plus/test/node";

/** The stdio test runs the built server, so every run, a watch rerun too, builds it first. */
export default function setup(project: TestProject) {
  const build = () => {
    const { status, stdout, stderr } = spawnSync("vp", ["pack"], { encoding: "utf8" });
    if (status !== 0) throw new Error(`vp pack failed:\n${stdout}${stderr}`);
  };
  build();
  project.onTestsRerun(build);
}
