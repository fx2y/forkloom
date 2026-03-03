# forkloom AGENT Policy
**Law**: `mise`+`fnox` ONLY. NO `.env`/`make`/`npm`. `MISE_EXPERIMENTAL=1`.

## 1. Arch & Boundaries
- **Wire**: `/runs/:id/*` ONLY. BANNED: top-level nouns (`/extensions|/packages|/themes|/reload|/docs|/skills`).
- **Extension API**: Floor FROZEN (`registerTool/registerCommand/registerProvider/appendEntry/on/hasUI/ui`). NO inflation.
- **Flagships**: Ship as standard extensions. NO core special-cases.
- **Logic**: Pure TS modules. HTTP/shell isolated. Single hash/canon source in `@forkloom/shared`.

## 2. Resource & Compute Law
- **Lifecycle**: Reload is transactional (unloadAll->clearRegistries->loadDiscovered) + rollback. Residue = fatal.
- **Packages**: Pure `pi/packages` modules. Resolver identity+pin law frozen. Settings merge: identity-based project-wins, deterministic dedupe.
- **Registry/Hooks**: Deterministic first-wins collisions + warning. Sorted inventory.
- **Filters**: Declarative narrowing ONLY (`undefined`=all, `[]`=none, `!`=exclude, `+`=include, `-`=exact exclude). NO runtime if-branches.
- **Themes/Providers**: Theme schema strict/fail-loud. Watch active file ONLY. Provider overrides extension-owned.
- **Sandbox**: `skill_exec` via `RunnerBackend` ONLY. NO host bash. L3 reads jailed (`realpath`/`lstat`). L1 registry prefix bytes ONLY.

## 3. State & Durability
- **Storage**: CAS absolute. Reserve-first SQL -> blob store -> rollback.
- **DBOS**: Replay determinism. 1 JSON `recordStepLedger` row/step. NO local handles.
- **UI**: 100% `innerHTML`-free. Headless UI hard-fails (gate behind `hasUI`). Reducer-owned truth. Infinite SSE client cursor.

## 4. Ops, Verification & Gates
- **DAG**: `.mise.toml` absolute. Unlisted lane = non-existent. Non-exec `mise-tasks/`.
- **Probes**: Bounded stability polling (`wait_for_url`/`waitFor`) MANDATORY. NO single-shot curl. Bounded startup reconcile.
- **Gates**: `ci:force` sequential. NO manual UI checks. Strict-real e2e operator. NO mock claims.
- **Proofs**: Real DBOS crash demands real SIGKILL+recovery (0 diffs). Non-vacuous close latch (booleans+reqs). Dynamic-output proofs required.