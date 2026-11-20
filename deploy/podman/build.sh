#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
container_bin="${PODMAN_BIN:-podman}"
for runtime in node python golang rust ruby; do
  "$container_bin" build \
    -f "$root/deploy/podman/Containerfile.$runtime" \
    -t "localhost/dotty-sandbox-$runtime:latest" \
    "$root/deploy/podman"
done
