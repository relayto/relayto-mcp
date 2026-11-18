#!/usr/bin/env bash
# share-file.sh: make local files reachable at a temporary public URL, so RELAYTO can fetch them
# with uploadWorkspaceFile({sourceUrl}). Binary files (a rendered thumbnail, a cover) can't be
# sent reliably as contentBase64: the bytes are retyped through the conversation and come out
# corrupted; big text files (a 100 KB stylesheet) cost as much. A sourceUrl upload is byte-exact.
#
#   url=$(share-file.sh start <file>)               the public URL of that one file
#   base=$(share-file.sh start <dir> [<list>])      the public base URL of the folder, ending in "/":
#                                                   <base><relative path> serves each file. <list> is a
#                                                   file of relative paths, one a line, to share only
#                                                   those; without it every file but dot-folders
#   share-file.sh stop                              stops the tunnel and the local server, removes the copy
#
# A Cloudflare quick tunnel (cloudflared, no account needed) in front of a local server bound to
# 127.0.0.1 that serves a temp copy of only what was named. It stops by itself after 10 minutes.
# Verify the uploads afterwards: download the CDN URLs and compare checksums with the local files.
set -euo pipefail
STATE="${TMPDIR:-/tmp}/relayto-share-file"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

stop() {
  [ -d "$STATE" ] || return 0
  if [ -f "$STATE/timer.pid" ]; then
    pkill -P "$(cat "$STATE/timer.pid")" 2>/dev/null || true   # its sleep
    kill "$(cat "$STATE/timer.pid")" 2>/dev/null || true
  fi
  for p in tunnel http; do
    [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null || true
  done
  rm -rf "$STATE"
}

case "${1:-}" in
  start)
    src="${2:?usage: share-file.sh start <file> | <dir> [<list>]}"
    list="${3:-}"
    [ -e "$src" ] || { echo "no such file or folder: $src" >&2; exit 2; }
    [ -z "$list" ] || [ -f "$list" ] || { echo "no such list: $list" >&2; exit 2; }
    command -v cloudflared >/dev/null || { echo "cloudflared is not installed (brew install cloudflared)" >&2; exit 2; }
    stop
    mkdir -p "$STATE/www"
    token="$(date +%s)-$$"
    echo "$token" > "$STATE/token"
    if [ -d "$src" ]; then
      # A folder: copy the listed files (or all but dot-folders) keeping their relative paths.
      if [ -n "$list" ]; then
        while IFS= read -r rel || [ -n "$rel" ]; do
          rel="${rel%$'\r'}"; rel="${rel#./}"
          [ -z "$rel" ] && continue
          case "$rel" in /*|*..*) echo "skipped (not a relative path inside the folder): $rel" >&2; continue ;; esac
          [ -f "$src/$rel" ] || { echo "listed but missing: $rel" >&2; stop; exit 2; }
          mkdir -p "$STATE/www/$(dirname "$rel")"
          cp "$src/$rel" "$STATE/www/$rel"
        done < "$list"
      else
        (cd "$src" && find . -type f ! -path '*/.*' -print) | while IFS= read -r rel; do
          rel="${rel#./}"; mkdir -p "$STATE/www/$(dirname "$rel")"; cp "$src/$rel" "$STATE/www/$rel"
        done
      fi
      name="$(cd "$STATE/www" && find . -type f | head -1)"; name="${name#./}"
      [ -n "$name" ] || { echo "nothing to share in $src" >&2; stop; exit 2; }
      base=1
    else
      name="$(basename "$src")"
      cp "$src" "$STATE/www/$name"
      base=""
    fi
    port=$(( 20000 + RANDOM % 20000 ))
    # Every background process gets its own stdin/stdout, so "url=$(share-file.sh start f)" returns.
    (cd "$STATE/www" && exec python3 -I -m http.server "$port" --bind 127.0.0.1) >/dev/null 2>&1 < /dev/null &
    echo $! > "$STATE/http.pid"
    cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$port" > "$STATE/tunnel.log" 2>&1 < /dev/null &
    echo $! > "$STATE/tunnel.pid"
    # Auto-stop after 10 minutes, but only this share (the token), never a later one.
    (sleep 600; [ "$(cat "$STATE/token" 2>/dev/null)" = "$token" ] && bash "$SELF" stop) >/dev/null 2>&1 < /dev/null &
    echo $! > "$STATE/timer.pid"
    url=""
    for _ in $(seq 1 40); do
      url=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$STATE/tunnel.log" | head -1 || true)
      [ -n "$url" ] && break
      sleep 1
    done
    [ -n "$url" ] || { echo "tunnel did not start; see $STATE/tunnel.log" >&2; stop; exit 1; }
    # A new quick-tunnel hostname takes a while to resolve; wait until the file really answers.
    for _ in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "$url/$name" 2>/dev/null || true)
      if [ "$code" = "200" ]; then if [ -n "$base" ]; then echo "$url/"; else echo "$url/$name"; fi; exit 0; fi
      sleep 2
    done
    echo "tunnel started but $url/$name does not answer" >&2
    stop
    exit 1
    ;;
  stop)
    stop
    echo "stopped"
    ;;
  *)
    echo "usage: share-file.sh start <file> | start <dir> [<list>] | stop" >&2
    exit 2
    ;;
esac
