# R2 Claude Code launcher

When creating a session, the launcher imports the other agent's checkpoint by
default if one exists. Use `--no-handoff` for normal resume without importing it.
Explicit conversation IDs, `--pick`, and `--new` override this default.


Run `./start-ai.sh claude`. It reconnects to its existing session, or resumes the
remembered conversation. On first use it opens Claude's conversation picker.
Use `./start-ai.sh claude --new` to start fresh.

- `--status`: pane state, last exit, remembered conversation, permissions, and
  configured authentication. This does not verify remaining quota.
- `--pick`: choose a conversation when creating a session.
- `<conversation-id>`: resume that conversation when creating a session.
- `--handoff`: continue from Codex's local checkpoint; see [handoffs](docs/AI_LAUNCHER.md).

Automatic permissions are enabled with `--dangerously-skip-permissions`.
The launcher uses the `r2-standard/` repository and a separate `r2-claude` tmux
socket/session, so it does not attach to a Codex session.

Detach with **Ctrl+B, then D**. After Claude exits, its exit code and recovery
menu stay visible: **R** resume, **P** picker, **N** new conversation, **L** switch
account, **H** import Codex's handoff, **Q** close the pane. Account switching runs
`claude auth logout` followed by `claude auth login`; after login choose **R**.

The launcher passes an additional, invocation-scoped settings file containing a
SessionStart hook. The hook records the actual conversation UUID as soon as Claude
starts or resumes, including subsequent session changes. It does not edit your
global or project Claude settings. State and exit timestamps/codes live privately
in `.start-claude-state/`. If hooks are disabled by your configuration, automatic
ID tracking is unavailable; the exit screen reports this and preserves the last
known ID. Explicit IDs still select the requested conversation for the current run.

New sessions run under the lingering systemd user manager to survive logout.
Reboot still ends the processes; run the launcher again to resume afterward.

Repository check: `python3 -m unittest discover -s test -p test_launcher.py -v`.
It uses stub agents and tmux commands. The optional handoff helper and its separate
upstream tests are not included here; see [launcher scope](docs/AI_LAUNCHER.md).
