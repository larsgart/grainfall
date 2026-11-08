#!/bin/bash
# Run Grainfall in a temporary Quickshell window without touching the live shell.
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/grainfall-dev.XXXXXX")
trap 'rm -rf -- "$runtime_dir"' EXIT

mkdir -p "$runtime_dir/Commons"
cp -a /usr/share/omarchy/shell/Commons/. "$runtime_dir/Commons/"
cp "$project_dir/Engine.js" "$project_dir/Grainfall.qml" "$runtime_dir/"
cp -a "$project_dir/i18n" "$runtime_dir/i18n"
cp "$project_dir/dev/shell.qml" "$runtime_dir/shell.qml"

GRAINFALL_STATE_FILE="$runtime_dir/grainfall.ini" quickshell -p "$runtime_dir"
