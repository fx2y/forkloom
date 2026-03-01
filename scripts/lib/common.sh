#!/usr/bin/env bash
set -euo pipefail

repo_root() {
  git rev-parse --show-toplevel
}

cd_repo_root() {
  cd "$(repo_root)"
}

ensure_dir() {
  mkdir -p "$1"
}

mark_path() {
  local task_name="$1"
  local safe_name
  safe_name="${task_name//:/__}"
  printf '%s/.cache/mise-marks/%s.ok\n' "$(repo_root)" "$safe_name"
}

write_mark() {
  local task_name="$1"
  local marker
  marker="$(mark_path "$task_name")"
  ensure_dir "$(dirname "$marker")"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$marker"
}

require_cmds() {
  local missing=0
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "missing command: $cmd" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

optional_cmds_status() {
  local cmd
  for cmd in "$@"; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd=ok"
    else
      echo "$cmd=missing"
    fi
  done
}

write_json() {
  local output_path="$1"
  local json_payload="$2"
  ensure_dir "$(dirname "$output_path")"
  printf '%s\n' "$json_payload" > "$output_path"
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local output_path="$3"
  local curl_opts="${4:--fsS}"
  local tries="${5:-60}"
  local i
  for (( i=1; i<=tries; i++ )); do
    if curl ${curl_opts} "$url" > "$output_path" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "$name healthcheck failed ($url)" >&2
  return 1
}

wait_for_url_stable() {
  local name="$1"
  local url="$2"
  local output_path="$3"
  local curl_opts="${4:--fsS}"
  local tries="${5:-120}"
  local stable_hits="${6:-3}"
  local sleep_sec="${7:-1}"
  local consecutive=0
  local i
  for (( i=1; i<=tries; i++ )); do
    if curl ${curl_opts} "$url" > "$output_path" 2>/dev/null; then
      consecutive=$((consecutive + 1))
      if [[ "$consecutive" -ge "$stable_hits" ]]; then
        return 0
      fi
    else
      consecutive=0
    fi
    sleep "$sleep_sec"
  done
  echo "$name healthcheck stability failed ($url, streak=$consecutive/$stable_hits)" >&2
  return 1
}

append_line() {
  local output_path="$1"
  local line="$2"
  ensure_dir "$(dirname "$output_path")"
  printf '%s\n' "$line" >> "$output_path"
}
