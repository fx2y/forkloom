---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx"]
---
# UI & State Rules
- Truth: Reducer + append-only `ActorEvent` is source-of-truth. `ActorState.status` insufficient.
- SSE: Infinite actor streams. Client owns disconnect via `Last-Event-ID`. No auto-close.
- UX: Open-ended `/actors*` surface. UI wording "thread" is presentation only.
- Payloads: Images sent on `prompt` ONLY. `followUp`/`steer` carry text+refs.
- Security: No dynamic `innerHTML`. Render via DOM text nodes.
- Vite: Web dev relies on proxy for `/runs`/`/artifacts`/`/health`. No CORS churn.