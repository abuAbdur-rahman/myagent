# Agent Latency — TTFT Research

Date: 2026-10-14. Scope: read-only research for implementing agent. No code changed.

## Objective

Explain 2-min time-to-first-token on OpenRouter `cohere/north-mini-code:free`, fresh chat, always slow, no tool log, streaming fast once started. Target SLO: p95 <10s except when thinking + tool_call involved.

## Repro

- Model: `cohere/north-mini-code:free` via OpenRouter.
- Effort: unknown (likely `none`/unset).
- Fresh single-message chat still ~2min. Dots spinner only, no `ToolStart`/`ToolResult`. Streaming after first token fast.

## Findings

### 1. Two round-trips per message when tools on (highest)

- `src/lib/store.tsx:765` hardcodes `enableTools:true`.
- `src-tauri/src/llm.rs:230-231` routes to `run_agentic()` not direct `stream_completion()`.
- `llm.rs:303-321`: `stream:false` + full `history + tools`, `await post_completion()` waits full JSON.
- `llm.rs:328-330` break, then `llm.rs:402` second `stream_completion()` for tokens.
- TTFT = full non-stream completion + stream TTFT. Fresh chat pays it.

### 2. Silent stall by design

- `ToolStart` at `llm.rs:360-364` only after `post_completion` returns.
- `stream_completion llm.rs:468-476` forwards only `delta.content`, drops reasoning deltas.
- UI: dots spinner `MessageList.tsx:227-232`, no thinking heartbeat, no TTFT log.

### 3. Model amplifies it: north-mini-code reasons heavily

- MoE 30B total / 3B active, 256K ctx / 64K out, Apache-2.0, agentic coder for OpenCode/SWE-agent. Single Cohere free provider on OpenRouter, rate-limited.
- Supports `tools`, `tool_choice`, `reasoning`, interleaved reasoning+tool. Flags: `supportsReasoningEffort:yes`, `thinkingFormat:openrouter`.
- Independent test (DataLLM Lab 2026-07-10, free tier): ~30k reasoning tokens/answer, 4-5x next model, avg 54s/task, worst 146s. Small active size traded for long reasoning.
- Sources: `openrouter.ai/cohere/north-mini-code:free`, `cohere.com/blog/north-mini-code`, pi.dev flags.

### 4. Effort unknown still reasons

- `catalog.ts:30-36` has no cohere/north pattern. `lookupEfforts()` null unless catalog says otherwise.
- `store.tsx:586-592`: `supported==null` passes stored value through; `none`/unset returns null, `llm.rs:73-79` sends no `reasoning` param. Model still reasons intrinsically.
- Composer default `none` (`Composer.tsx:188`), stored `localStorage:reasoningEffort` unknown.

### 5. Why 2min exceeds 60s read_timeout

- `lib.rs:108-114` `connect_timeout:10s, read_timeout:60s`. `read_timeout` is idle gap, not total deadline. OpenRouter keeps alive during queue/reasoning, total can exceed 60s.
- No total TTFT deadline, no `max_tokens` on agentic calls (title path sets `max_tokens:24` at `llm.rs:188`, agentic path does not).

### 6. Ruled out

- Not history: fresh chat slow. Unbounded `history store.tsx:887,929-930` + `SELECT * db.ts:145-151` is debt but not this 2min.
- Not tool exec: `tools::execute tools.rs:366` never reached without `tool_calls`.

## SLO interpretation

- Plain chat with no visible thinking/tool must be p95 <10s. Current path violates by construction.
- Carve-out applies only when UI shows thinking/tool progress. Today 2min shows neither, counts against SLO.
- Metric: frontend `streamTurn start` to first `Delta`. Segment by `model, effort, enable_tools, history_tokens`. For thinking/tool turns require `time-to-first-progress <10s` (Delta or Thinking/ToolStart), not full completion.

## Spec for implementing agent

1. Stream-first: `stream_completion(stream:true, tools attached)` first. Only on streamed `tool_calls` enter `run_agentic` loop. Fallback minimal: default `enableTools:false`, UI toggle, `max_iterations:2-3` via `api.ts:76` (supported, never passed, `llm.rs:301` defaults 8).
2. Per-model default: `:free` models `enableTools:false`, `max_iterations:1`, explicit `max_tokens`/`max_completion_tokens` cap.
3. Forward reasoning stream as `Thinking` event + heartbeat before `post_completion`; log `invoke→headers`, `headers→first-byte`, `first-byte→done`, `history_len`, `body_bytes`, `model`, `effort`, `iterations`, `usage.reasoning_tokens`.
4. Total TTFT timeout ~30s with abort message suggesting `none/low` effort or another model. Keep 60s idle timeout separate.
5. Out of scope: history capping, virtualization, Markdown per-token re-parse (`store.tsx:771-776`, `MessageList.tsx:321-323,363-382`, `Markdown.tsx:94-113`), vault cache, SQLite transactions.

## Verify (no fix)

1. Temp logs around `get_api_key`, `post_completion send→headers→json`, `stream first-byte`, frontend start→first delta.
2. Fresh chat short prompt: `enable_tools:true` vs `false`; `effort:none` vs current; check OpenRouter model activity at same time.
3. Expect sharp TTFT drop with `enable_tools:false`.

## Open questions

- Exact stored `reasoningEffort`?
- Accept `:free` as SLO-exempt or pin interactive default away from `:free`?
- TTFT SLO window and measurement point agreed?
