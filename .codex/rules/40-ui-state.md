---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx", "apps/api/src/pi/themes/**"]
---
# UI & Theme Law
- **Security**: ZERO `innerHTML`. Text nodes/attrs ONLY. Scope guards enforce.
- **Headless Guard**: Hard-fail on headless UI calls; ALL extension code must gate UI behind `hasUI`.
- **Truth**: Strict derivation from durable SSE streams. Reducer-owned skill state. NO auto-close SSE; infinite, client owns `Last-Event-ID`.
- **Themes**: Strict fail-loud schema. Watch scope is active file ONLY (NO global rescan).