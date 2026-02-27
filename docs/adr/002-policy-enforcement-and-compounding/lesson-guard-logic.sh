#!/usr/bin/env bash
# mise-tasks/check/lesson-guard logic

set -eo pipefail

echo ">>> Validating Lesson-Guard Policy (Compounding Doctrine v2)"

# Every code change must have a corresponding rule or test delta.
CHANGES=$(git diff --name-only HEAD | grep -vE "^(AGENTS.md|.codex/rules/|tests/)" || true)

if [ -n "$CHANGES" ]; then
    echo "Found code changes without rule/test updates:"
    echo "$CHANGES"
    
    # Check if there is ANY change in rules or tests to justify the code change
    HAS_RULE_DELTA=$(git diff --name-only HEAD | grep -E "^(AGENTS.md|.codex/rules/|tests/)" || true)
    
    if [ -z "$HAS_RULE_DELTA" ]; then
        echo "FAIL: PR violates Doctrine v2. No .codex/rules/ or tests/ change detected."
        exit 1
    fi
fi

echo "PASS: Policy compounding verified."
