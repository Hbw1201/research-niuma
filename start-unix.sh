#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec node "$ROOT/bin/relay-lab.mjs" start --workspace "${1:-$ROOT/workspace}" --open
