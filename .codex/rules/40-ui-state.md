---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx"]
---
# UI/State
- **Security**: NO `innerHTML`. DOM text nodes/attributes ONLY.
- **Truth**: Strict derivation from durable projections. No heuristic edge invention.
- **SSE**: Infinite stream. Client manages disconnect/reconnect via `Last-Event-ID`. NO auto-close on terminal events.
- **Controls**: Export needs `workspaceRef` snapshot. Pre-approve priv commands reject HTTP 409. Terminal runs reject 409 on command queue.