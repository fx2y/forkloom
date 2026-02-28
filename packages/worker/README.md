# @forkloom/worker

Minimal ownership seam for optional runtime split.

- Current owner: durable run/actor background execution concerns that outgrow `apps/api`.
- Activation criterion: move only when API process ownership, scaling, or isolation pressure is proven by tests/ops pain.
- Until then, keep run logic in-process, land actor ticks in `apps/api`, and reuse the same service/port contracts.
