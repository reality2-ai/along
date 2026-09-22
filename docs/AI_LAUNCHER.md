# Portable AI launcher

Copy `start-ai.sh` into a project folder and run it there, or invoke it by its
path from another directory. The folder containing the script is the working
directory. No project-specific edits or Git repository are required.

```sh
./start-ai.sh                 # Choose Codex or Claude interactively
./start-ai.sh codex           # Reconnect to this folder's Codex session
./start-ai.sh claude          # Reconnect to this folder's Claude session
./start-ai.sh codex --status  # Show project path and session identity
./start-ai.sh codex --new     # Start fresh if there is no running session
```

Each canonical folder path produces a separate tmux socket/session name and
launch lock for each agent. Identically named folders in different locations
remain separate. An existing session is reattached, so `--new` does not replace
a running agent; use its recovery menu after the agent exits.

Remembered conversation IDs and logs live in `.start-codex-state/` and
`.start-claude-state/` beside the launcher. Copy only the script to initialise
another folder, rather than copying these state directories. Agent accounts,
configuration and underlying conversation storage remain managed by their CLIs
on the machine. The launcher isolates project sessions, not operating-system
permissions or account storage.

The script retains its existing automatic-permission mode. It requires Bash,
Python 3, tmux, sha256sum, flock, the selected agent CLI, and a systemd user manager
with lingering enabled. `agent-handoff.py` is optional; handoff commands require
that separate helper. Ordinary launching works without it.

Detach with **Ctrl+B, then D**. Run the same launcher again to reconnect. Moving
the project changes its session identity; it does not move or terminate an old
running session.

The launcher regression check uses stub agents and tmux commands, so it does not
start real conversations or interfere with existing sessions:

```sh
python3 -m unittest discover -s test -p test_launcher.py -v
```
