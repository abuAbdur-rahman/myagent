# Release v0.1.4 — live loop, safe loop, surviving context

Scope chosen by user from `docs/features.md`: A4, D2, D3, D13, C8+C9.

## A4. Retry with backoff
- Rust pre-stream only: retry on 429, 5xx, network errors, max 3 attempts,
  exponential backoff with jitter, honor `Retry-After`. Never retry 400,
  never retry once a token arrived. `Retrying (2/3)` event surfaces in UI.
- Done: 429-then-success fixture; 400 no-retry; mid-stream death no-retry.

## D2. Streaming tool loop
- `sse.rs` accumulates `ToolCallDelta` keyed by index into complete calls;
  loop executes after finish reason `tool_calls`. UI shows "running" as soon
  as the tool name arrives (tool log entry already supports it).
- Done: split-argument fixtures assemble to valid JSON; two-tool turn shows
  both results.

## D3. Step cap and doom-loop guard
- Max 25 tool steps per turn. Same tool + same args 3x in a row stops the
  loop and asks the user (via `ask_user` card) how to proceed.
- Done: looping mock model halted, card shown.

## D13. Output cap and spill files
- Tool output to model capped at ~32KB; full output written to
  `spill/<chat>/<id>.txt` with `[truncated, full output at path]` marker.
  Model re-reads slices via shell until D8 lands. Spill deleted with chat.
- Done: large output capped in context, recoverable from disk.

## C8+C9. Real compaction, manual + auto
- Replace slice-last-4 with a same-model summary (goal, decisions, files
  touched, open tasks) stored as a special message with the covered range;
  `context compacted` marker in transcript. Auto at ~80% of context, manual
  via the existing Compact button, setting to disable auto. Between turns only.
- Done: post-compaction model answers about an early decision; threshold
  crossing compacts exactly once.

## Order
A4, D13, D3, D2, C8+C9. Gate per slice: clippy + cargo test + tsc + fallow.
