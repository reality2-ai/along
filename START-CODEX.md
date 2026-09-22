# R2 Codex launcher

When creating a session, the launcher imports the other agent's checkpoint by
default if one exists. Use `--no-handoff` for normal resume without importing it.
Explicit conversation IDs, `--pick`, and `--new` override this default.


Run `./start-ai.sh codex` from this directory, or invoke it by its full path.
It reconnects to the existing project session. If there is none, it resumes the
remembered conversation, or opens the project conversation picker on first use.

- `./start-ai.sh codex --status` reports the pane state, last exit code, saved
  conversation, and stored Codex authentication method. It does not check quota
  or prove that authentication will succeed against the service.
- `./start-ai.sh codex --pick` opens the picker when creating a session.
- `./start-ai.sh codex --handoff` continues from Claude Code's local checkpoint.
  See [switching agents](docs/AI_LAUNCHER.md) for the quota-exhaustion workflow.
- `./start-ai.sh codex <conversation-id>` selects and remembers that conversation
  when creating a session. Existing sessions are reattached without interruption.
- Detach with **Ctrl+B, then D**. Run the launcher again to reconnect.

After exiting Codex, the pane stays open and displays the exit code:

- **R** starts Codex again with the same conversation.
- **P** opens the project conversation picker.
- **N** starts a new conversation. You can also use `./start-ai.sh codex --new`
  when creating a session.
- **L** runs `codex logout`, then `codex login`. Complete the account change,
  then press **R**. A failed login leaves the menu open.
- **Q** closes the pane. The remembered conversation remains available next time.
- **H** imports Claude Code's checkpoint and continues the task in Codex.

For an account change, exit Codex first, choose **L**, complete login, then choose
**R**. You can also change accounts from another terminal while Codex is stopped.

The launcher stores the explicit conversation ID, or the exact ID in Codex's
exit message, in the private `.start-codex-state` directory alongside the script.
It records exit timestamps and codes there too, but no credentials. Recent
terminal output is saved separately in private `.agent-handoff/` checkpoints.
If a picker-selected session crashes before printing its resume
message, the launcher cannot discover its ID; use **P** to select it again.
The remembered ID on disk is the last known ID, which may predate such a crash.

New sessions use the `r2-codex` tmux socket inside a systemd user scope. User
lingering must be enabled to survive the last logout. This does not keep processes
running through shutdown or reboot; rerun the launcher afterward. Legacy sessions
are reattached, and gain these features only after being closed and recreated.

Run `python3 launcher-tests/recovery.py` to test using an isolated tmux server,
temporary state, and a fake Codex command. It requires access to the systemd user
manager and does not launch a real agent or change authentication.
