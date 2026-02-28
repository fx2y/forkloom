---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx"]
---
# UI & State Rules
- Security: NO dynamic `innerHTML`. Render DOM text nodes/attributes ONLY.
- Truth: Durable projections (WILL-RUN, files, approval) + append-only `ActorEvent` source-of-truth. NO runtime guesses.
- SSE: Infinite stream. Client owns disconnect + cursor replay via `Last-Event-ID`. NO auto-close.
- Controls: Export valid ONLY after `workspaceRef` snapshot. Pre-approve priv commands reject HTTP 409.