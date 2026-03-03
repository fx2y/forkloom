---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx"]
---
# UI & State Law
- **Security**: ZERO `innerHTML`. Text nodes/attrs ONLY. Scope guards enforce.
- **Truth**: Strict derivation from durable SSE streams. Reducer-owned skill state.
- **UX**: UI picker filters `menuVisible=false`. Explicit text `/skill:<name>` works.
- **SSE**: Infinite. Client owns `Last-Event-ID` cursor. NO auto-close.