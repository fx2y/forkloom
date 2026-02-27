# Orchestration & Task DAG Details

## Task Configuration (Mise)
Tasks are defined in `.mise.toml` pointing to `mise-tasks/` scripts. 

### DAG Enforcement
We use `sources` and `outputs` to skip tasks if artifacts are fresh.

```toml
[tasks."check:unit"]
run = "bash ./mise-tasks/check/unit"
sources = ["src/**/*.ts", "tests/unit/**/*.ts"]
outputs = [".cache/mise-marks/check__unit.ok"]
```

## CI Phase Sequentiality
Decision `D6` addresses a limitation where `mise run check test:int` might skip subsequent tasks if one fails or if execution is parallelized incorrectly in specific shell environments.

```toml
[tasks."ci:force"]
run = [
  "mise run --force check",
  "mise run --force test:int",
  "mise run --force golden",
  "mise run --force fault",
  "mise run --force bench"
]
```
*Force flag ensures clean-state validation in CI/CD environment.*

## SeaweedFS Health (C6)
Standard health checks (2xx) fail on SeaweedFS S3 root. We use reachability (curl exit code).

```bash
# Correct probe
curl -sS "${S3_URL}" > /dev/null
```
