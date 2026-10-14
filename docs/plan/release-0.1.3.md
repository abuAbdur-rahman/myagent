# Release 0.1.3 — "Trust the turn"

Theme: see what the model is doing, and nothing runs without asking.

## Scope (from `docs/features.md` / `docs/later.md`)

| ID | Feature | Size | Notes |
|---|---|---|---|
| H1+H2 | Test harness + SSE fixtures | S | Folded into A3: Rust unit tests over recorded fixtures; `cargo test` in CI |
| A3 | SSE parser | M | Buffer/split, `\r\n`, comment lines, `[DONE]`, typed events incl. `Reasoning`, `Usage` |
| A6 | Reasoning display | S | Collapsed thinking block above answer, "Thought N s" when done; stored, never re-sent |
| C5 | Real usage | S | Store usage chunk per assistant message; footer tokens real, chars/4 labelled estimate |
| A5 | Finish reasons | S | `length`/`error`/`interrupted` states + Continue button |
| A7 | Error UI | S | Banner per class (key/model/rate-limit/network/provider) + Retry, raw code in details |
| D4 | Permission engine | M | Rust `decide()`; deny > ask > allow; no `*` allow rule |
| D5 | Approval UI | M | Inline card (tool, command, cwd); Allow once / Always / Deny; loop awaits answer |
| D7 | Gated shell | M | `run_powershell` through D4+D5; 60s timeout, per-segment rules, kill on stop |
| D16 | Question tool | M | `ask_user` with 2-4 options + custom text; loop awaits answer, returns as tool result |
Deferred to 0.1.4: A4 retry (needs A3+A7 anyway — reconsider), C7/C8/C9 compaction, D3 doom-loop guard, E2 secret refusal.

## Order

1. A3 (+H1/H2 fixtures) — everything stream-related builds on it.
2. A6, C5, A5, A7 — visibility slice, each behind its own fixture.
3. D4 (pure Rust, unit-tested), D5 (UI + loop await), D7 (wire shell through both).

## Exit checks

- `cargo test` green; every new parser/loop state has a fixture.
- Reasoning fixture renders a thinking block; non-reasoning model shows none.
- `length` finish shows Continue; 429 shows rate-limit banner (no retry yet — A4 deferred, banner says so).
- Shell tool with no rule pauses on an approval card; Deny returns to the model; "Always" stores a prefix rule, never `*`.
- Full gate clean (tsc, clippy, fallow, build), live mock-server pass, tag `v0.1.3`.
