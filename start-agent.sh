#!/usr/bin/env bash
# Compatibility shortcut for the original combined launcher name.
set -euo pipefail
launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$launcher_dir/start-ai.sh" "$@"
