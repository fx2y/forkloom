#!/usr/bin/env bash
set -euo pipefail

assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "expected file missing: $path" >&2
    exit 1
  fi
}

assert_dir_exists() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "expected directory missing: $path" >&2
    exit 1
  fi
}

assert_nonempty() {
  local value="$1"
  local label="$2"
  if [[ -z "$value" ]]; then
    echo "expected non-empty value for: $label" >&2
    exit 1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! rg -q "$pattern" "$file"; then
    echo "pattern not found in $file: $pattern" >&2
    exit 1
  fi
}
