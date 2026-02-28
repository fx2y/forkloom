# forkloom C1

`forkloom` ships a mise-first C1 stack with 5 default services (`postgres`, `seaweedfs`, `pi`, `api`, `web`) plus an optional `worker` profile and frozen v0 nouns.

## Invariants

- v0 nouns frozen: `Message`, `Artifact`, `Workflow`, `Skill`, `Extension` (+ `ArtifactRef` pointer)
- v1 run namespace is additive only: `RunSpec`, `RunState`, `RunEvent` under `contracts/v1`
- Artifact identity is immutable `sha256`; bytes stored once in CAS layout `cas/aa/<sha256>`
- Orchestration is `mise` only; secrets are `fnox` only; `.env*` is forbidden
- Durability proof requires SQL unique guard plus DBOS live crash/recover test
- PI protocol gate runs a real `pi --mode rpc` process; the API falls back to a local mock provider unless the caller exports `PI_RPC_STRICT_REAL=1`
- Compose mounts host `~/.pi/agent` into `api`/`pi`/`worker`, so persisted `pi auth` state is visible inside containers

## Ports

- `api`: `8080`
- `web`: `5173`
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

Open `http://127.0.0.1:5173` for the inbox/thread actor UI plus the run lab (`WILL-RUN`, files, approve/steer/abort).

Optional worker seam:

```bash
MISE_EXPERIMENTAL=1 mise run svc:worker
```

Strict real PI (fail if local `pi` auth/model state is unusable):

```bash
PI_RPC_STRICT_REAL=1 MISE_EXPERIMENTAL=1 mise run svc
curl -fsS localhost:8080/health | jq .
```

Strict-real prerequisite: host `~/.pi/agent/auth.json` and `~/.pi/agent/settings.json` must exist; `bootstrap:doctor` now also verifies `PI_RPC_STRICT_REAL=1` reaches compose `api` and `worker` and that both mount `~/.pi/agent` read-only. `PI_PROVIDER`/`PI_MODEL` come from `fnox`; strict-real itself is a caller override and must not be silently reset by `mise`.

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

## Actor API v1

- `POST /actors` create or upsert an actor mailbox executor
- `GET /actors` list actor states
- `GET /actors/:actorId` fetch one actor state
- `POST /actors/:actorId/messages` enqueue a mailbox message
- `GET /actors/:actorId/events` stream append-only actor events over SSE (`Last-Event-ID` or `?since=<seq>`)

## Thread UI

- `web` proxies `/actors`, `/artifacts`, `/runs`, `/health` to `api`
- inbox list is actor-backed; each thread pane replays append-only `ActorEvent` SSE from `/actors/:actorId/events`
- truthful send policy: idle thread => `prompt`, streaming thread => `followUp`, explicit interrupt => `steer`
- `@actor` routing stays client-side and still resolves onto the same actor API surface
- trace drawer and artifact/session strip are reducer-derived, not hand-authored summaries

## Run UI

- run lab renders persisted `WILL-RUN` preview, durable files, and live trace for `/runs*`
- approve only appears while `approval.state=pending`; prompt/followUp/steer/abort map 1:1 onto `POST /runs/:runId/commands`
- files refresh from `GET /runs/:runId/files` after `workspace_updated`; export calls `POST /runs/:runId/files/export`

## Run API Smoke

```bash
curl -fsS -F file=@README.md http://localhost:8080/artifacts | tee /tmp/run-artifact.json
SHA=$(jq -r .sha256 /tmp/run-artifact.json)
RUN_ID=$(node -e 'const {createRunId}=require("./packages/shared/dist/index.js"); console.log(createRunId())' 2>/dev/null || python3 - <<'PY'
import random, time
alphabet="0123456789ABCDEFGHJKMNPQRSTVWXYZ"
now=int(time.time()*1000)
head=""
for _ in range(10):
    head=alphabet[now % 32] + head
    now//=32
tail="".join(alphabet[random.randrange(32)] for _ in range(16))
print(head + tail)
PY
)
curl -fsS http://localhost:8080/runs \
  -H 'content-type: application/json' \
  -d "{\"runId\":\"$RUN_ID\",\"scope\":\"team\",\"userMsg\":\"reply with one concise line\",\"attachments\":[{\"sha256\":\"$SHA\"}]}" | jq .
curl -N http://localhost:8080/runs/$RUN_ID/events
```

Spec-05 CY1 freeze: run remains the only public owner for preview/files/commands, so future sandbox control stays under `/runs*`; no `/sandbox*` HTTP surface is reserved today.

## Actor API Smoke

```bash
curl -fsS http://localhost:8080/actors \
  -H 'content-type: application/json' \
  -d '{"actorId":"actor-smoke","name":"ops"}' | jq .
curl -fsS http://localhost:8080/actors/actor-smoke/messages \
  -H 'content-type: application/json' \
  -d '{"kind":"prompt","text":"reply with one concise line","attachments":[]}' | jq .
curl -N http://localhost:8080/actors/actor-smoke/events
```

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
MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-functional
MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-files
MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-sse
MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-durability
MISE_EXPERIMENTAL=1 mise run test:int:actor-durability
MISE_EXPERIMENTAL=1 mise run test:int:actor-functional
MISE_EXPERIMENTAL=1 mise run test:int:actor-sse
MISE_EXPERIMENTAL=1 mise run test:sys
MISE_EXPERIMENTAL=1 mise run golden
MISE_EXPERIMENTAL=1 mise run fault
MISE_EXPERIMENTAL=1 mise run bench
```

Force fresh CI phases:

```bash
MISE_EXPERIMENTAL=1 mise run ci:force
```
