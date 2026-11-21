#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -n "${CONTAINER_BIN:-}" ]]; then
  container_bin="$CONTAINER_BIN"
elif [[ "$(uname -s)" == "Linux" ]]; then
  container_bin=podman
else
  container_bin=docker
fi
for runtime in node python golang rust ruby; do
  "$container_bin" build \
    -f "$root/deploy/sandbox/Containerfile.$runtime" \
    -t "localhost/dotty-sandbox-$runtime:latest" \
    "$root/deploy/sandbox"
done
