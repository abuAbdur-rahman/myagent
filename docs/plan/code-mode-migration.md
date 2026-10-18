# myagent: Code-Mode Tool Migration

Oct 17, 2026 · @Abu Abdirrahman

## Summary and decision

Migrate in three phases and stop as soon as the token savings are enough: first cap and filter tool output, then hand the model result handles and load tool definitions on demand, and only then add a sandboxed `execute_js` tool. Phases 0 and 1 need no sandbox and should capture most of the saving for a chat agent like myagent.

Vendor-reported gains for code mode on multi-step workflows are large: Anthropic's Drive-to-Salesforce example drops from about 150,000 to about 2,000 tokens (98.7%), and StackOne measured about 14K raw tokens reduced to a \~500-token summary (96%). These come from workflows that move big data between tools. Expect less for a chat assistant, and measure your own baseline before Phase 2.

| Phase | What changes | Needs sandbox | Effort (my estimate) | Main risk |
| --- | --- | --- | --- | --- |
| 0. Output controls | `max_chars`, `head`/`tail`, `grep`, `limit` on existing tools | No | Days | Model must learn to use the options |
| 1. Handles and on-demand tools | Big results saved to files, model gets summary + handle; tool definitions fetched by search | No | 1 to 2 weeks | Handle lifetime and cleanup |
| 2. Code mode | One `execute_js` tool; tools exposed as async functions inside a sandbox | Yes | 3 to 5 weeks | Security, approvals UX, Windows build of the engine |

**Recommendation:** ship Phase 0 now, Phase 1 next, and gate Phase 2 on a measured trigger: more than 10K intermediate tokens per turn on a regular basis, which is the threshold StackOne suggests for choosing code mode over direct calls.

## Current state

myagent passes every tool result straight through the model, so large outputs cost tokens twice: once when read, again when the model copies data into the next call. This section is written from your chat logs and agent reports, not from the repo, so treat file-level details as assumptions to confirm.

- **Stack:** Tauri + Rust backend, React frontend. The agentic loop lives in `llm.rs` (`run_agentic`).
- **Tools the model sees today:** `get_time`, `run_powershell`, `save_artifact`, `web_search`, `web_fetch`, `remember`, `recall_memory`, `todo_write`, `todo_set`, `ask_user`.
- **Loop:** each iteration streams one model step. After the double-answer fix, the last no-tool iteration is the answer.

| Tool | Where tokens leak | Fix layer |
| --- | --- | --- |
| `web_fetch` | Whole page as text, even when one fact is needed | Phase 0 limits and extraction, Phase 1 handles |
| `web_search` | Full result list with snippets on every call | Phase 0 `max_results` and fields |
| `run_powershell` | Raw stdout, including long listings and logs | Phase 0 `head`/`tail`/`grep`, Phase 1 handles |
| `recall_memory` | Returns all matches | Phase 0 limit |
| All tools | Every tool definition is sent every turn | Phase 1 on-demand definitions |
| Multi-tool chains | Each intermediate result passes through the model | Phase 2 code mode |

## Target design

Three layers sit between the model and your tools, and each one can ship on its own.

- **Phase 0:** output controls on the tools that already exist.
- **Phase 1:** results become handles; tool definitions load on demand.
- **Phase 2:** one sandboxed `execute_js` tool that calls the Phase 0 tools.

The model only sees summaries and handles. Phase 2 calls the same Phase 0 tools, so caps and approvals apply to scripts too.

## Phase 0: output controls on existing tools

Give the model the same levers a shell user has, so it can ask for less instead of reading everything. Every option is optional and has a safe default cap, so old prompts keep working.

| Tool | Add | Default cap | Notes |
| --- | --- | --- | --- |
| `web_fetch` | `max_chars`, `start`, `selector` or `grep`, `format` (`text` or `markdown`) | 8,000 chars | Return `truncated: true` and the total length so the model knows more exists |
| `web_search` | `max_results`, `fields` (`title`, `url`, `snippet`) | 5 results | Drop duplicate domains and tracking parameters |
| `run_powershell` | `head`, `tail`, `grep` (regex), `max_chars` | 6,000 chars | Apply the filter in Rust, after the command finishes |
| `recall_memory` | `limit`, `query` | 10 items | Already small; do it for consistency |

**Rules for every tool result**

1. Never silently truncate. Include `{ shown, total, truncated }` in the result.
2. When truncating, tell the model how to get the rest ("call again with `start: 8000`").
3. Cap by default, expand on request. A cap the model can raise is better than no cap.
4. Strip noise in Rust before counting: ANSI colour codes, repeated blank lines, HTML boilerplate.

**Tool descriptions matter.** Add one line to each description such as "Use `grep` to find one fact instead of reading the whole page." Without that line the model rarely uses the new options.

**Done when:** the median `web_fetch` and `run_powershell` result is under 2,000 tokens and no tool can return more than the default cap unless the model asks.

## Phase 1: result handles and on-demand tool definitions

Stop pushing big results through the model. Store them on disk and give the model a short summary plus a handle it can query.

**Result handles**

- When a result exceeds the cap (for example 4,000 chars), save it under the app data folder as `results/<turn-id>/<n>.txt` and return `{ handle: "r_7f3a", bytes, lines, preview: "first 500 chars" }`.
- Add one tool, `read_result(handle, grep?, head?, tail?, start?, max_chars?)`. This is the grep-and-pipe behaviour you wanted, built from plain Rust with no sandbox.
- Handles live for the chat session. Delete the folder when the chat is deleted, and sweep anything older than 7 days on startup.
- The model never sees file paths outside `results/`. `read_result` rejects anything else.

**On-demand tool definitions**

Send only a small core set every turn (`web_search`, `web_fetch`, `run_powershell`, `read_result`, `search_tools`) and let the model find the rest.

- `search_tools(query)` returns up to 5 matching tool names with one-line descriptions.
- Calling a tool that was not loaded yet loads its full definition for the rest of the turn.
- This matters most once you add MCP servers. Anthropic notes that loading every definition up front can cost hundreds of thousands of tokens at large tool counts. With about 10 built-in tools you save little today, so build this when external MCP tools arrive.

**Persistence and the DeepSeek rule.** Handles are stored in the message history as part of the tool result, so the model can refer to an earlier handle in a later turn. Keep `reasoning_content` replay unchanged.

**Done when:** a 200 KB page fetch adds under 1,000 tokens to context, and the model can still answer a question about a detail from it by calling `read_result` with `grep`.

## Phase 2: code mode with a Rust-embedded sandbox

Use QuickJS through `rquickjs`, in process, with a memory limit, a time limit and no built-in system access. Svix moved from V8 (`deno_core`) to QuickJS-NG via `rquickjs` in December 2025 and cut response time from 11.0 ± 7.0 ms to 1.0 ± 0.7 ms, because most scripts run once and V8 spent about 90% of its time on setup.

| Engine | Time limit | Memory limit | Fit for myagent |
| --- | --- | --- | --- |
| [`rquickjs`](https://lib.rs/crates/rquickjs) (QuickJS) | Interrupt handler; can overshoot slightly | `set_memory_limit` built in | **Recommended.** Small, fast start, no system or web APIs unless you add them |
| `deno_core` (V8) | No native limit | Exceeding the heap limit crashed Svix's process | Too heavy for short snippets; unsafe failure mode |
| Boa (pure Rust) | Not verified | Not verified | Svix is watching it as a future option; revisit later |
| Javy + Wasmtime | Epoch interruption | Wasm linear memory | Extra ring of defence; large dependency tree. Add only if you run untrusted code |
| Node or Bun subprocess | Kill the process | OS limits | Needs a runtime installed on the user's PC; weaker fit for a local-first app |

**Windows risk:** the `rquickjs` page lists the `x86_64-pc-windows-msvc` target as experimental and shows version 0.8.1 from November 2024. Build a spike on your Windows toolchain before committing, and check crates.io for a newer release.

**What the model sees: two tools instead of many**

1. `search_tools(query)` returns matching tool names and TypeScript-style signatures.
2. `execute_js(code)` runs the script and returns whatever the script logs or returns.

**What the script sees**

```js
// Plain ES2020. No TypeScript: QuickJS cannot run it.
const page = await tools.web_fetch({ url, max_chars: 200000 });
const hits = page.text.split('\n').filter(l => /TIOBE/.test(l)).slice(0, 5);
return hits;               // only this goes back to the model
```

- A global `tools` object with one async function per allowed tool. Each call goes over a channel to Rust, which runs the real tool and returns JSON.
- `console.log` is captured and capped (for example 4,000 chars). `return` value is serialised and capped the same way.
- Nothing else exists: no `fetch`, no `require`, no file access. Cloudflare's Code Mode works the same way: the only path out is the injected bindings, and secrets stay with the host, never in the script.
- Run each snippet in a fresh runtime on a blocking thread. Suggested limits to benchmark: 32 MB memory, 20 s wall clock, 50 tool calls, 200 KB total returned.

**Errors must be useful.** Return `{ error, tool, line, message }` so the model can fix its own code. StackOne notes generic sandbox errors make agents stall.

**Use code mode selectively.** A single tool call does not need it. Let the model decide: direct calls for one-shot lookups, `execute_js` for loops, joins and filtering across several results.

## Security model

The script can only do what its injected `tools` can do, so the security work is deciding which tools it gets and how approvals work. Agent-written code needs sandboxing, resource limits and monitoring, which Anthropic lists as the main cost of code mode.

| Control | Rule |
| --- | --- |
| Capabilities | The script gets only the tools enabled for this chat. No ambient `fetch`, filesystem or process access |
| Dangerous tools | `run_powershell` stays approval-gated inside the sandbox, exactly as it is today. A script cannot bypass an approval prompt |
| Approvals UX | Show the script and the list of tools it called, not just the code. Approve per tool call, not per script, so the existing approval card keeps working |
| Secrets | API keys stay in Rust. The script never sees them (same pattern as Cloudflare and StackOne) |
| Limits | Memory cap, wall-clock deadline, tool-call count, output size. Hitting a limit returns a structured error, never a crash |
| Prompt injection | Page text returned by `web_fetch` is data. Mark it as untrusted in the tool result and never let a script `eval` or run strings taken from tool output |
| Audit | Log every tool call a script makes with arguments and result size, shown in the tool card |
| Isolation level | In-process QuickJS is enough for the model's own code. Add a Wasm or subprocess ring only if you ever run code from other people |

**Rules**

1. A script cannot call `execute_js` recursively.
2. Tool permissions are checked in Rust at call time, not when the script starts.
3. Deny by default: a new tool is not visible to scripts until you list it.

## Agent loop and UI integration

`execute_js` is one more tool inside the existing loop, so none of the fixes from the double-answer work change. One tool call can run many inner tool calls, and the loop still ends on the first iteration that has no tool calls.

1. **Tool registry:** add `execute_js`, `search_tools` and `read_result` next to the current tools. Keep every old tool callable directly.
2. **Dispatch:** `execute_js` starts a QuickJS runtime on a blocking thread. Each `tools.x(...)` call sends a message to the async side, which runs the real tool through the same code path as a direct call (same approvals, same output caps).
3. **Result:** the script's returned value and captured logs become the tool result for that loop iteration. Intermediate tool results are stored as handles, never added to the model's history.
4. **History:** push the assistant message (with `reasoning_content` for DeepSeek) and one `tool` message, as today.
5. **Stop rule:** unchanged. Final no-tool iteration is the answer; no extra completion afterwards.

**UI**

- Show one tool card for `execute_js` with the script in a collapsible block, and nested rows for each inner call (name, arguments, result size, duration).
- Approvals appear on the inner call that needs them, with the script visible above it.
- Stream the card state: running, waiting for approval, done, failed with the structured error.
- Keep each loop step in its own message, as recommended in the double-answer fix, so inner tool rows cannot mix into the answer text.

**Prompting.** Add a short system-prompt section: when to use `execute_js` (loops, filtering, joining several results), when not to (one lookup), and the rules (plain JavaScript, return a small summary, never print whole pages).

## Testing, metrics and rollout

Measure first, ship each phase behind a setting, and keep the previous behaviour one toggle away.

**Baseline (before any change).** Log per turn: input tokens, output tokens, tokens in tool results, number of model requests, tool calls, and latency. Run 10 fixed prompts: a web research question, a PowerShell listing, a multi-page comparison, a plain chat message, and a follow-up that reuses earlier results.

| Metric | Target after Phase 0 | Target after Phase 1 | Target after Phase 2 |
| --- | --- | --- | --- |
| Median tokens in tool results per turn | under 2,000 | under 1,000 | under 500 on chained tasks |
| Model requests per turn | tool rounds + 1 | tool rounds + 1 | tool rounds + 1 |
| Answer quality on the 10 prompts | no drop | no drop | no drop |
| Tool error rate | no rise | no rise | under 10% script failures after the first retry |

**Checklist**

- [ ] Capture the baseline on the 10 prompts
- [ ] Phase 0: add caps and filters, with a `truncated` field in every result
- [ ] Phase 0: unit tests for truncation, `grep`, ANSI stripping
- [ ] Phase 1: result store, `read_result`, cleanup on chat delete
- [ ] Phase 1: `search_tools` once external MCP tools exist
- [ ] Phase 2 spike: build `rquickjs` on Windows, run a script with memory and time limits
- [ ] Phase 2: `execute_js`, `tools` bindings, structured errors, nested tool cards
- [ ] Phase 2: fake-model loop test (one `execute_js` call, then text) asserts exactly 2 model requests
- [ ] Hostile-script tests: infinite loop, memory bomb, huge output, recursive `execute_js`, attempts to reach `fetch` or the filesystem
- [ ] Settings toggle "Code mode (experimental)", off by default for one release

**Rollout.** Ship Phases 0 and 1 to everyone after the baseline comparison. Ship Phase 2 off by default, turn it on for your own use for a week, read the logged scripts, then decide the default.

## Risks, open questions and sources

**Risks**

- **Gains may be small for chat.** The big numbers are vendor-reported and come from multi-tool data pipelines. Phase 0 and 1 may be enough.
- **Model skill.** Weaker or free models may write poor JavaScript. Keep direct tool calls available and test on your cheapest model.
- **Windows build.** The `rquickjs` page marks the MSVC target experimental. The spike decides if Phase 2 is viable.
- **Approval fatigue.** A script that calls `run_powershell` ten times means ten prompts. Consider a per-script approval that lists all commands up front, only for read-only ones.
- **Debuggability.** Hidden intermediate data is harder to inspect. The logged inner calls and stored handles are the answer.

**Open questions**

- Which models do you use most? This decides how much code-writing skill to assume.
- Do you plan to add external MCP servers soon? If yes, build on-demand tool definitions in Phase 1; if not, skip them for now.
- Should scripts be allowed to call `ask_user` and `save_artifact`, or only read-style tools?

**Sources (pages opened)**

- [Code execution with MCP, Anthropic Engineering](https://www.anthropic.com/engineering/code-execution-with-mcp): token example, progressive disclosure, sandbox costs
- [Code Mode, Cloudflare](https://blog.cloudflare.com/code-mode/): tools as a TypeScript API, bindings as the only way out
- [MCP code mode architecture, StackOne](https://stackone.com/blog/mcp-code-mode-agent-context-architecture): search and execute tools, 96% reduction, 10K-token routing rule
- [Improving JavaScript Webhook Transformations, Svix](https://www.svix.com/blog/improving-transformations/): QuickJS-NG via `rquickjs` versus V8
- [rquickjs on lib.rs](https://lib.rs/crates/rquickjs): features, version, platform notes
- [Code Mode dual-sandbox proposal, Labby issue 168](https://github.com/dinglebear-ai/labby/issues/168): Wasmtime as a second ring
- [What is a composite MCP server, Gravitee](https://www.gravitee.io/blog/what-is-a-composite-mcp-server) and [MCP server composition patterns, Fast.io](https://fast.io/resources/mcp-server-composition-patterns/): why "composed MCP" is a different idea

As of 2026-10-17. Vendor benchmarks are the vendors' own figures.
