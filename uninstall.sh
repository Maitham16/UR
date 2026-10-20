#!/bin/sh
# Remove native application files; preserve ~/.ur configuration and history.
set -eu
bin=$HOME/.local/bin/ur
data=${XDG_DATA_HOME:-"$HOME/.local/share"}/ur
if [ -L "$bin" ]; then
  case "$(readlink "$bin")" in "$data"/versions/*/ur) rm "$bin";; *) echo 'UR launcher is owned by another installation; leaving it unchanged.' >&2; exit 1;; esac
fi
echo 'Native launcher removed. Configuration, sessions and version directories are preserved.'
echo "After closing every UR process, remove application versions with: rm -rf '$data/versions'"
