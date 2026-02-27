# forkloom C0

`forkloom` ships a mise-first C0 stack with 4 services (`postgres`, `seaweedfs`, `pi`, `api`) and frozen v0 nouns.

## Invariants

- v0 nouns frozen: `Message`, `Artifact`, `Workflow`, `Skill`, `Extension` (+ `ArtifactRef` pointer)
- v1 run namespace is additive only: `RunSpec`, `RunState`, `RunEvent` under `contracts/v1`
- Artifact identity is immutable `sha256`; bytes stored once in CAS layout `cas/aa/<sha256>`
- Orchestration is `mise` only; secrets are `fnox` only; `.env*` is forbidden
- Durability proof requires SQL unique guard plus DBOS live crash/recover test
- PI protocol gate runs real RPC process with deterministic mock-provider fallback by default

## Ports

- `api`: `8080`
- `postgres`: `5432`
- `seaweed s3`: `8333`
- `seaweed master`: `9333`
- `pi rpc`: stdio process in `pi` container (no host TCP port)

## Bootstrap

```bash
mise trust
mise install
MISE_EXPERIMENTAL=1 mise prep
MISE_EXPERIMENTAL=1 mise run bootstrap
```

## One Command Dev

```bash
MISE_EXPERIMENTAL=1 mise run svc
```

## Quick Artifact Demo

```bash
curl -fsS http://localhost:8080/health | jq .
curl -fsS -F file=@README.md http://localhost:8080/artifacts | tee /tmp/artifact.json
SHA=$(jq -r .sha256 /tmp/artifact.json)
curl -fsS http://localhost:8080/artifacts/$SHA > /tmp/artifact.bin
python3 - <<'PY'
import hashlib
print(hashlib.sha256(open('/tmp/artifact.bin','rb').read()).hexdigest())
PY
curl -fsS http://localhost:8080/artifacts/$SHA/meta | jq .
```

## API v0

- `POST /artifacts` multipart (`file`) or raw bytes body
- `GET /artifacts/:sha256` stream bytes
- `GET /artifacts/:sha256/meta` fetch metadata noun
- `POST /artifacts/:sha256/link` append parent/meta only
- `GET /health` dependency map (`pg/s3/pi/api`)

## Data Layout

- Object bytes: `s3://agentos/cas/aa/<sha256>`
- Metadata rows: Postgres `artifact` + `artifact_alias`
- Migrations: `apps/api/migrations/*.sql` (rerunnable)
- Contracts: `contracts/v0/*.schema.json` + `contracts/v0/examples/*.json`

## Verification

```bash
MISE_EXPERIMENTAL=1 mise run bootstrap:doctor
MISE_EXPERIMENTAL=1 mise run check:contract
MISE_EXPERIMENTAL=1 mise run check:unit
MISE_EXPERIMENTAL=1 mise run test:int
MISE_EXPERIMENTAL=1 mise run test:sys
MISE_EXPERIMENTAL=1 mise run golden
MISE_EXPERIMENTAL=1 mise run fault
MISE_EXPERIMENTAL=1 mise run bench
```

Force fresh CI phases:

```bash
MISE_EXPERIMENTAL=1 mise run ci:force
```
