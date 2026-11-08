#!/bin/bash
# Engine tests plus Omarchy's manifest validation.
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node "$project_dir/tests/engine.test.js"
omarchy plugin validate "$project_dir"
echo "manifest ok"
