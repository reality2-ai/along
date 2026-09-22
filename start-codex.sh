#!/usr/bin/env bash
# Compatibility shortcut; all launcher behavior lives in start-ai.sh.
set -euo pipefail
launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$launcher_dir/start-ai.sh" codex "$@"
