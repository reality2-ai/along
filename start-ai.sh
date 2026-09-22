#!/usr/bin/env bash
# Keep one project agent in a tmux server owned by the lingering user manager.
set -euo pipefail
launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
launcher="$launcher_dir/start-ai.sh"
project_dir="$launcher_dir"
# Scope sockets and locks to this checkout, even when another project uses tmux.
project_checksum=$(printf '%s' "$project_dir" | sha256sum)
project_key="ai-${project_checksum:0:16}"

usage() {
    cat <<EOF
Usage: ${0##*/} [codex|claude] [conversation-id | --pick | --new | --handoff | --no-handoff | --status]
With no arguments, choose an agent interactively.
Project: $project_dir
Default: import the other agent's checkpoint if available; otherwise resume normally.
--new      Start a fresh conversation when creating a session.
--pick     Choose a conversation when creating a session.
--handoff  Require the other agent's checkpoint.
--no-handoff  Resume normally without importing a checkpoint.
--status   Show session, remembered conversation, permissions, and login status.
After exit: R resume, P picker, N new, L switch account, H import handoff, Q close.
Detach: Ctrl+B, then D. Reconnect by running the launcher again.
Automatic permissions are enabled for both agents.
Logout persistence requires user lingering; it does not cover reboot.
EOF
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
if (( $# == 0 )); then
    if [[ ! -t 0 ]]; then usage >&2; exit 2; fi
    printf 'Choose agent: [C] Codex  [A] Claude Code  [Q] Quit\n> '
    IFS= read -r selection
    case "$selection" in
        c|C|codex) set -- codex ;;
        a|A|claude) set -- claude ;;
        q|Q) exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
fi
engine=$1
shift
case "$engine" in
    codex)
        label=Codex
        session="$project_key-codex"
        tmux_command=(tmux -L "$session")
        permission_flag=--dangerously-bypass-approvals-and-sandbox
        ;;
    claude)
        label='Claude Code'
        session="$project_key-claude"
        tmux_command=(tmux -L "$session")
        permission_flag=--dangerously-skip-permissions
        ;;
    *) usage >&2; exit 2 ;;
esac
state_dir="$launcher_dir/.start-$engine-state"

login_status() {
    if [[ "$engine" == codex ]]; then codex login status; else claude auth status --text; fi
}

switch_account() {
    if [[ "$engine" == codex ]]; then
        codex logout && codex login
    else
        claude auth logout && claude auth login
    fi
}

remember() {
    printf '%s\n' "$1" > "$state_dir/conversation.tmp"
    mv -- "$state_dir/conversation.tmp" "$state_dir/conversation"
}

saved_id() {
    if [[ -f "$state_dir/conversation" ]]; then
        cat "$state_dir/conversation"
    fi
}

pane_state() {
    tmux set-option -p -t "$TMUX_PANE" @ai-state "$1"
}

save_checkpoint() {
    [[ -f "$launcher_dir/agent-handoff.py" ]] || return 0
    tmux capture-pane -p -J -S -2000 -t "$TMUX_PANE" |
        python3 "$launcher_dir/agent-handoff.py" snapshot "$engine" "$project_dir" "${selected:-}"
}

checkpoint_loop() {
    [[ -f "$launcher_dir/agent-handoff.py" ]] || return 0
    while sleep 20; do
        save_checkpoint || true
    done
}

run_pane() {
    local selected=${1:-} code choice captured run_dir
    local handoff=${2:-} handoff_prompt= checkpoint_pid=
    umask 077
    mkdir -p -- "$state_dir"
    cd -- "$project_dir"
    # Preserve the wrapper if Ctrl+C reaches it alongside Claude Code.
    trap ':' INT
    trap 'if [[ -n ${checkpoint_pid:-} ]]; then kill "$checkpoint_pid" 2>/dev/null || true; fi' EXIT
    while true; do
        pane_state starting
        handoff_prompt=
        if [[ "$handoff" == yes && -f "$launcher_dir/agent-handoff.py" ]]; then
            if ! handoff_prompt=$(python3 "$launcher_dir/agent-handoff.py" prompt "$engine"); then
                printf 'Handoff unavailable. Continuing with the normal session selection.\n'
            fi
            handoff=
        fi
        if [[ "$engine" == claude ]]; then
        run_dir=$(mktemp -d "$state_dir/.run-XXXXXXXX")
        python3 - "$launcher" "$run_dir" <<'CONFIG'
import json, pathlib, shlex, sys
launcher, directory = sys.argv[1:]
settings = {"hooks": {"SessionStart": [{"hooks": [{
    "type": "command", "timeout": 5,
    "command": shlex.join(["bash", launcher, "claude", "--record-session", directory])
}]}]}}
(pathlib.Path(directory) / "settings.json").write_text(json.dumps(settings))
CONFIG
        local command=(claude --dangerously-skip-permissions --settings "$run_dir/settings.json")
        if [[ "$selected" == --new ]]; then
            : # Claude starts a new conversation when --resume is absent.
        elif [[ -n "$selected" ]]; then
            command+=(--resume "$selected")
        elif [[ -z "$handoff_prompt" ]]; then
            command+=(--resume)
        fi
        [[ -z "$handoff_prompt" ]] || command+=("$handoff_prompt")
        else
        if [[ -n "$selected" && "$selected" != --new ]]; then remember "$selected"; fi
        local command=(codex resume "$permission_flag" --no-alt-screen -C "$project_dir")
        if [[ "$selected" == --new || ( -z "$selected" && -n "$handoff_prompt" ) ]]; then
            command=(codex "$permission_flag" --no-alt-screen -C "$project_dir")
        elif [[ -n "$selected" ]]; then
            command+=("$selected")
        fi
        [[ -z "$handoff_prompt" ]] || command+=("$handoff_prompt")
        fi
        # Clear old scrollback so a cancelled picker cannot capture an older ID.
        tmux clear-history -t "$TMUX_PANE"
        printf '\033[2J\033[H'
        pane_state running
        code=0
        checkpoint_loop &
        checkpoint_pid=$!
        "${command[@]}" || code=$?
        kill "$checkpoint_pid" 2>/dev/null || true
        wait "$checkpoint_pid" 2>/dev/null || true
        checkpoint_pid=
        pane_state stopped
        tmux set-option -p -t "$TMUX_PANE" @ai-exit "$code"
        printf '%s exit=%s\n' "$(date -Is)" "$code" >> "$state_dir/exits.log"
        if [[ "$engine" == claude ]]; then
        # The invocation-scoped SessionStart hook records the actual ID, even
        # when the picker, /clear, or /resume changes the active conversation.
        captured=
        [[ ! -f "$run_dir/conversation" ]] || captured=$(cat "$run_dir/conversation")
        if [[ -n "$captured" ]]; then
            selected=$captured
        else
            printf '\nSession ID was not confirmed by the hook. The saved ID remains unchanged.\n'
            [[ "$selected" != --new ]] || selected=
        fi
        # Remove only the temporary files created for this completed invocation.
        rm -f -- "$run_dir/settings.json" "$run_dir/conversation"
        rmdir -- "$run_dir"
        else
        # Codex prints its exact resume command on exit. Do not infer IDs from
        # global history, modification times, or another running conversation.
        captured=$(tmux capture-pane -p -J -S -80 -t "$TMUX_PANE" | python3 -c '
import re, sys
text = sys.stdin.read()
ids = re.findall(r"(?:^|\n)To continue this session, run\s+codex resume\s+([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})(?=\s|$)", text)
if ids: print(ids[-1])
')
        if [[ -n "$captured" ]]; then
            selected=$captured
            remember "$selected"
        fi
        [[ "$selected" != --new ]] || selected=
        fi
        printf '\n%s exited at %s with code %s.\n' "$label" "$(date -Is)" "$code"
        if [[ -n "$selected" ]]; then
            printf 'Conversation: %s\n' "$selected"
        else
            printf 'No conversation ID captured for this run. Use the picker or launch with an explicit ID.\n'
        fi
        save_checkpoint || printf 'Could not save the local handoff checkpoint.\n' >&2
        while true; do
            printf '\n[R] Resume  [P] Pick conversation  [N] New conversation  [L] Switch account  [H] Import handoff  [Q] Close session\n> '
            IFS= read -r choice || return 0
            case "$choice" in
                r|R) break ;;
                p|P) selected=; break ;;
                n|N) selected=--new; break ;;
                l|L)
                    # Interactive and only after Claude Code has stopped. Failed login
                    # leaves the recovery menu open instead of starting Claude Code.
                    if switch_account; then
                        printf 'Login complete. Choose R to resume.\n'
                    else
                        printf 'Login did not complete. Retry L when ready.\n'
                    fi
                    ;;
                h|H)
                    if [[ ! -f "$launcher_dir/agent-handoff.py" ]]; then
                        printf 'Handoff is unavailable: agent-handoff.py is not installed in this project.\n'
                        continue
                    fi
                    if python3 "$launcher_dir/agent-handoff.py" prompt "$engine" >/dev/null; then
                        handoff=yes
                        break
                    fi
                    ;;
                q|Q) return 0 ;;
            esac
        done
    done
}

# This hook is supplied only through this launcher's --settings argument.
# It validates the UUID and stores no transcript, prompt, or credentials.
if [[ ${1:-} == --record-session && $# == 2 ]]; then
    python3 -c '
import json, os, pathlib, sys, tempfile, uuid
state, run = map(pathlib.Path, sys.argv[1:])
if run.parent.resolve() != state.resolve() or not run.name.startswith(".run-"):
    raise SystemExit("Invalid launcher state directory")
data = json.load(sys.stdin)
if data.get("hook_event_name") != "SessionStart":
    raise SystemExit("Expected SessionStart")
value = str(uuid.UUID(data["session_id"])) + "\n"
os.umask(0o077)
for destination in (run / "conversation", state / "conversation"):
    fd, name = tempfile.mkstemp(dir=destination.parent, prefix=".session-")
    try:
        with os.fdopen(fd, "w") as output:
            output.write(value)
        os.replace(name, destination)
    finally:
        if os.path.exists(name): os.unlink(name)
' "$state_dir" "$2"
    exit
fi

# Internal entry point launched only as the tmux pane command.
if [[ ${1:-} == --run-pane && -n ${TMUX_PANE:-} ]]; then
    run_pane "${2:-}" "${3:-}"
    exit
fi
if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
if (( $# > 1 )) || [[ ${1:-} == -* && ${1:-} != --pick && ${1:-} != --new && ${1:-} != --handoff && ${1:-} != --no-handoff && ${1:-} != --status ]]; then
    usage >&2
    exit 2
fi
for dependency in tmux "$engine"; do
    command -v "$dependency" >/dev/null || { printf 'Required command not found: %s\n' "$dependency" >&2; exit 1; }
done

# Explicit conversation selection, --pick and --new take precedence over the
# default handoff. An ordinary first launch without a checkpoint still works.
source_engine=claude
[[ "$engine" != claude ]] || source_engine=codex
requested_handoff=false
if [[ ${1:-} == --handoff ]] ||
    { (( $# == 0 )) && [[ -f "$launcher_dir/.agent-handoff/$source_engine.md" ]]; }; then
    requested_handoff=true
fi
if $requested_handoff && [[ ! -f "$launcher_dir/agent-handoff.py" ]]; then
    printf 'Handoff is unavailable: agent-handoff.py is not installed in this project.\n' >&2
    exit 1
fi

existing=false
if "${tmux_command[@]}" has-session -t "=$session" 2>/dev/null; then
    existing=true
fi

if [[ ${1:-} == --status ]]; then
    printf 'Project: %s\nSession: %s\n' "$project_dir" "$session"
    if $existing; then
        printf 'tmux: running (%s)\n' "$label"
        "${tmux_command[@]}" list-panes -s -t "=$session" -F 'Pane #{pane_id}: state=#{@ai-state} dead=#{pane_dead} command=#{pane_current_command} pid=#{pane_pid} last_exit=#{@ai-exit}'
    else
        printf 'tmux: not running\n'
    fi
    printf 'Permissions: automatic (%s)\n' "$permission_flag"
    printf 'Remembered conversation: %s\n' "$(saved_id)"
    [[ ! -f "$state_dir/exits.log" ]] || tail -n 1 "$state_dir/exits.log"
    printf 'Authentication (stored configuration; does not verify quota):\n'
    login_status || true
    exit 0
fi

attach() {
    if [[ -n ${TMUX:-} ]] &&
        [[ ${TMUX%%,*} == "$("${tmux_command[@]}" display-message -p '#{socket_path}')" ]]; then
        exec "${tmux_command[@]}" switch-client -t "=$session"
    fi
    exec env -u TMUX "${tmux_command[@]}" attach-session -t "=$session"
}
if $existing; then
    if $requested_handoff; then
        printf 'Existing session: exit the agent if running, then choose H to import the handoff.\n'
        attach
    fi
    (( $# == 0 )) || printf 'Existing session found; selection argument ignored. Use its recovery menu after the agent exits.\n'
    attach
fi

for dependency in systemd-run loginctl flock python3; do
    command -v "$dependency" >/dev/null || { printf 'Required command not found: %s\n' "$dependency" >&2; exit 1; }
done
if [[ ! -d "$project_dir" ]]; then
    printf 'Project directory not found at: %s\n' "$project_dir" >&2
    exit 1
fi
if [[ $(loginctl show-user "$(id -u)" -p Linger --value) != yes ]]; then
    printf 'Logout persistence requires: loginctl enable-linger\n' >&2
    exit 1
fi
lock_dir=${XDG_RUNTIME_DIR:?XDG_RUNTIME_DIR is required for the user manager}
exec 9>"$lock_dir/$project_key-$engine-launch.lock"
flock 9
if "${tmux_command[@]}" has-session -t "=$session" 2>/dev/null; then
    exec 9>&-
    attach
fi
handoff=
if $requested_handoff; then
    # Fail before creating a pane if there is nothing to hand over.
    python3 "$launcher_dir/agent-handoff.py" prompt "$engine" >/dev/null
    handoff=yes
    selected=$(saved_id)
elif [[ ${1:-} == --no-handoff ]]; then
    selected=$(saved_id)
else
    selected=${1:-$(saved_id)}
fi
[[ "$selected" != --pick ]] || selected=
printf 'Creating tmux session %s. Detach with Ctrl+B, then D.\n' "$session"
# A dedicated socket prevents reusing a server owned by a login-session scope.
systemd-run --user --scope --quiet -- \
    "${tmux_command[@]}" new-session -d -s "$session" -c "$project_dir" \
    bash "$launcher" "$engine" --run-pane "$selected" "$handoff" 9>&-
exec 9>&-
attach
