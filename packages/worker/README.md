# @forkloom/worker

Minimal ownership seam for optional runtime split.

- Current owner: durable run/actor background execution concerns that outgrow `apps/api`.
- Activation criterion: move only when API process ownership, scaling, or isolation pressure is proven by tests/ops pain.
- Timer and `agent2agent` mailbox kinds stay accepted at the contract/service edge now; they still execute only through DBOS actor ticks.
- Heartbeat loops, shared buses, and metrics daemons stay out until pressure is proven; future worker work should remain a transport/runtime move, not a domain rewrite.
- Until then, keep run logic in-process, land actor ticks in `apps/api`, and reuse the same service/port contracts.
