# ADR 008: Skills OS Orchestration & Runtime Doctrine

## 1. Governance & Boundary Law
- **Orchestration Law**: `mise` + `fnox` ONLY. ZERO `.env` usage. `MISE_EXPERIMENTAL=1` is absolute. DAG lanes define reality; if it's not in `.mise.toml`, it does not exist.
- **Wire Strictness**: Top-level `/skills` nouns and `kind=skill` are **BANNED**. API extension happens strictly under `/runs/:runId/skills` and `/runs/:runId/skills/preview`.
- **Command Invocation**: Explicit activation remains text-only via `/skill:<kebab-name>` within existing `prompt|followUp|steer` payloads. Keep public command-kind lattice stable and contract-safe.

## 2. Registry (L1) & Activation (L2) 
- **Ownership**: `SkillService` is the solitary owner of manifest/index/preview semantics. Prevents parser/fs leakage into run/http seams. Instantiated once at bootstrap.
- **Startup Perf (L1)**: Startup index reads bounded prefix bytes ONLY (`readPrefixBytes`). Full SKILL body startup reads are an architectural failure. Caching via stat+hash. Performance gate `skills-perf` demands 1k cold/warm latency compliance with 1 full read strictly.
- **Collision Rules**: Deterministic first-wins by discovery directory and precedence (`org > workspace > user > package > global`).
- **Normalization Strategy**: Hyphenated frontmatter keys (e.g., `disable-model-invocation`) map to camelCase internally exactly once. v0 `Skill` schemas remain thin, mapping to richer, normalized internal types.
- **XML Projection**: Escaped `<available_skills>` is injected directly via `buildRunPromptMessage`, aggressively filtering `disable-model-invocation: true`. 

## 3. L3 Jailed Compute & Durability Substrate
- **Jailed IO**: L3 reads (via `read-skill-file`) mandate strict `realpath`/`lstat` jail execution against `references/*` and `assets/*`. Symlink and path escapes fail fast.
- **Compute Substrate**: Skill execution (`skillExec`) happens exclusively within the `run-sandbox` `RunnerBackend` (containerized `bash -lc`). Host shell execution is a P0 regression.
- **Parser Integrity**: Argv tokenizing requires shell-aware quote/escape parsers. Naive whitespace splits destroy user intent and reproducibility.
- **Durability Seam**: Every `skill_exec` writes CAS artifacts (stdout, stderr, out/* delta) and emits EXACTLY ONE JSON-serializable `recordStepLedger` row. No parallel tables. Stale out/* files are aggressively excluded via delta hashing.

## 4. UI Rendering & Run Lab State
- **State Sovereignty**: Run Lab list/preview state is strictly reducer-owned. Picker `menuVisible=false` filters accurately while explicit text-only `/skill:` paths bypass the menu filter entirely.
- **Render Safety**: ZERO `innerHTML` execution in UI. Pure text-node updates are mandatory; XSS-safe rendering is blocking.
- **WILL-RUN Introspection**: Preview routes (`POST /runs/:runId/skills/preview`) are pure Read-Only WILL-RUN introspection. Mutating ledgers or invoking bash during a preview breaks contract.

## 5. Packs & Composable Output
- **Packs Rule**: `contract-review`, `invoice-extract`, `meeting-to-actions`, `policy-qa` remain terse orchestrations. Terse SKILL + tiny script.
- **Dynamic Output Proof**: Packs must emit typed CAS artifacts relying on arguments. Static outputs make the `skills-validate` lane vacuous. Zero no-mock chat-only skills.

## 6. Execution Gates & Close Latch
- **Gate Lattice**: Code merges require a pristine DAG execution: `skills-validate` -> `skills-perf` -> `skills-checklist` -> `golden:skills`.
- **Non-Vacuous Closure**: Latch demands verifiable boolean truth indexes: `req_full_cover_miss=0`, `task_all_done=1`, and positive indices for `validate_proof_ok`, `pack_proof_ok`, `skill_live_ok`. Status string checks alone are insufficient and circular.

## Walkthrough: End-to-End Jailed Execution
```typescript
// 1. L1 Discovery
const prefix = await fs.promises.open(skillPath, 'r').then(fh => fh.read(Buffer.alloc(4096), 0, 4096, 0)); 
const frontmatter = parsePrefixHyphenated(prefix);

// 2. Queue & Activation
const cmd = parseCommand(payload.text); // text: "/skill:policy-qa region=us"
const runState = await getRunState(runId);
const activated = await skillService.activateL2(runState, cmd.skillName);

// 3. Jailed Resolution & Compute (RunnerBackend)
const jailedPath = resolveSkillPath(activated.dir, 'script.sh'); 
const argv = shellQuoteTokenizer(cmd.args);
const { stdout, stderr, files } = await executeSkillPlanDurably(runId, jailedPath, argv);

// 4. Ledger Write
await recordStepLedger({ runId, stepName: 'skill_exec', output: { stdoutCAS, stderrCAS, filesCAS } });
```
