#!/bin/sh
# Install published native UR. Usage: sh install.sh [latest|stable|1.86.0]
set -eu
target=${1:-latest}
repository=https://github.com/Maitham16/UR
if [ "$target" = latest ] || [ "$target" = stable ]; then
  release_url=$(curl --fail --silent --show-error --location --output /dev/null --write-out '%{url_effective}' "$repository/releases/latest")
  version=${release_url##*/v}
else version=${target#v}; fi
if [ ${#version} -gt 100 ] || ! printf '%s\n' "$version" | LC_ALL=C grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$'; then echo 'Invalid release version' >&2; exit 1; fi
case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) echo 'Unsupported OS; use install.ps1 for Windows' >&2; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo 'Unsupported CPU architecture' >&2; exit 1;; esac
if [ "$platform" = linux ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then echo 'Linux native releases require glibc. musl is not yet supported.' >&2; exit 1; fi
platform=$platform-$arch
file=ur-$version-$platform.tar.gz
versions=${XDG_DATA_HOME:-"$HOME/.local/share"}/ur/versions
bin=$HOME/.local/bin
mkdir -p "$versions" "$bin"
lock=$versions/.install-lock
if ! mkdir "$lock" 2>/dev/null; then echo "Another installation is active. If no installer is running, remove $lock and retry." >&2; exit 1; fi
printf '%s\n' "$$" > "$lock/owner.pid"
staging=$(mktemp -d "$versions/.bootstrap.XXXXXXXX") || { rm -f "$lock/owner.pid"; rmdir "$lock"; exit 1; }
temporary=$bin/.ur-install-$$
trap 'rm -rf "$staging"; rm -f "$lock/owner.pid"; rmdir "$lock"; rm -f "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
release=$versions/$version-$platform
cached=0
verified_release() {
  [ -f "$1/resources/manifest.json" ] && [ -x "$1/ur" ] &&
    [ "$("$1/ur" --version 2>/dev/null)" = "$version (UR-Nexus)" ] &&
    "$1/ur" --ur-native-self-test >/dev/null 2>&1
}
if [ -L "$bin/ur" ]; then
  active=$(readlink "$bin/ur")
  case "$active" in
    "$versions/$version-$platform/ur"|"$versions/$version-$platform"-repair-*/ur)
      case "$active" in *'/../'*|*'/./'*) ;; *)
        if verified_release "${active%/ur}"; then release=${active%/ur}; cached=1; fi;;
      esac;;
  esac
fi
if [ "$cached" -eq 0 ] && verified_release "$release"; then cached=1; fi
if [ "$cached" -eq 0 ]; then
url=$repository/releases/download/v$version
curl --fail --silent --show-error --location "$url/SHA256SUMS" -o "$staging/SHA256SUMS"
checksum=$(awk -v file="$file" '$2 == file && length($1) == 64 {print $1}' "$staging/SHA256SUMS")
case "$checksum" in ''|*[!a-f0-9]*|*'
'*) echo 'Missing or invalid checksum for this platform' >&2; exit 1;; esac
curl --fail --silent --show-error --location "$url/$file" -o "$staging/archive.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$staging/archive.tar.gz" | awk '{print $1}'); else actual=$(shasum -a 256 "$staging/archive.tar.gz" | awk '{print $1}'); fi
[ "$checksum" = "$actual" ] || { echo 'Release checksum mismatch' >&2; exit 1; }
tar -tzf "$staging/archive.tar.gz" > "$staging/entries"
while IFS= read -r entry; do
  case "$entry" in /*|*../*|../*|*\\*|*'//'*|*/./*|*'/..'|*':*') echo 'Unsafe release archive' >&2; exit 1;; esac
  case "$entry" in ur|resources|resources/*) ;; *) echo 'Unexpected release archive entry' >&2; exit 1;; esac
done < "$staging/entries"
if tar -tvzf "$staging/archive.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit !bad}'; then echo 'Release contains unsupported file types' >&2; exit 1; fi
mkdir "$staging/release"
tar -xzf "$staging/archive.tar.gz" -C "$staging/release"
chmod 755 "$staging/release/ur"
[ -f "$staging/release/resources/manifest.json" ] || { echo 'Release resources are missing' >&2; exit 1; }
[ "$("$staging/release/ur" --version)" = "$version (UR-Nexus)" ] || { echo 'Downloaded executable failed version check' >&2; exit 1; }
"$staging/release/ur" --ur-native-self-test > /dev/null
  if [ -e "$release" ]; then release=$versions/$version-$platform-repair-${staging##*.bootstrap.}; fi
  mv "$staging/release" "$release"
fi
ln -s "$release/ur" "$temporary"
[ ! -d "$bin/ur" ] || { echo 'Launcher path is a directory; move it aside and retry.' >&2; exit 1; }
mv -f "$temporary" "$bin/ur"
echo "Installed UR-Nexus $version at $bin/ur"
case :${PATH:-}: in *:"$bin":*) ;; *) echo "Add $bin to your PATH, then open a new terminal.";; esac
