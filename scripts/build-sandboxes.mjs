#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const container = process.env.PODMAN_BIN?.trim() || "podman";
const runtimes = process.argv.slice(2);
const selected = runtimes.length ? runtimes : ["node", "python", "golang", "rust", "ruby"];

for (const runtime of selected) {
  const file = path.join(root, "deploy", "podman", `Containerfile.${runtime}`);
  console.log(`Building dotty-sandbox-${runtime} with ${container}...`);
  const result = spawnSync(
    container,
    ["build", "-f", file, "-t", `localhost/dotty-sandbox-${runtime}:latest`, path.join(root, "deploy", "podman")],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
