import { spawnSync } from "node:child_process";

import type { TestProject } from "vite-plus/test/node";

const build = () => {
  const { status, stdout, stderr } = spawnSync("vp", ["pack"], {
    encoding: "utf-8",
  });

  if (status !== 0) {
    throw new Error(`vp pack failed:\n${stdout}${stderr}`);
  }
};

export default function setup(project: TestProject) {
  build();
  project.onTestsRerun(build);
}
