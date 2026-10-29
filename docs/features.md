# MyAgents: Feature Catalogue

One entry per feature. Grouped only where features share a concern. Priorities and order live in `later.md`; this file explains what each feature is and the simplest way to build it.

**Entry format:** Status (from the last audit) · Ref (how OpenCode / Claude / OpenWebUI do it) · Build (simplest version) · Done (testable check).

**Status:** Have, Partial, Missing, Unknown (verify in code first).

**Sources:** † = checked against public docs during research (OpenCode, OpenRouter, OpenWebUI, Claude Code, Tauri). Everything else is general product behavior, so verify before copying details. "Claude" means Claude Code and the Claude app. No Claude source exists in this repo.

**Rule for every entry:** no test, not done. Build the simplest version, nothing in "Not" until later.

---

# A. Chat core

## A1. Send pipeline
- **Status:** Have (non-streaming tools)
- **Ref:** All three: user message is stored, request sent, reply streamed into a new assistant message.
- **Build:** One function in Rust: `send(chat_id, text)`. Store user message, build context, call the provider, stream events to the UI by channel, store the final assistant message on completion or interruption.
- **Done:** A mock-provider test sends a message and gets a stored reply.

## A2. Stop / cancel
- **Status:** Have (0.3.3 verified: cancel token on every stream read and before each tool call; stopping keeps the partial text and marks the turn stopped; mid-stream stop test)
- **Ref:** † OpenRouter: cancel a stream by aborting the connection (supported providers only). Claude Code: Esc stops the turn.
- **Build:** A cancel token checked on every network read and before each tool call. On cancel, drop the HTTP body, keep partial text, mark the message `stopped`.
- **Not:** Killing a running child process gracefully (see D7).
- **Done:** Stopping mid-stream leaves partial text saved and no further tokens appear.

## A3. SSE parser
- **Status:** Have (0.1.3: `src-tauri/src/sse.rs` + fixtures, `cargo test` in CI)
- **Ref:** † OpenRouter sends keep-alive comment lines such as `: OPENROUTER PROCESSING`; parsing them as JSON throws. Stream ends with `data: [DONE]`. A usage chunk comes near the end.
- **Build:** Pure function over bytes: buffer, split on blank line, support `\r\n`, keep the incomplete tail, ignore comment lines and `[DONE]`, parse `data:` JSON, check top-level `error` first. Output typed events: `Text`, `Reasoning`, `ToolCallDelta`, `Usage`, `Finish`, `Error`.
- **Done:** Fixtures give identical events however the bytes are chopped (1 byte, random, whole).

## A4. Retry with backoff
- **Status:** Have (0.3.3 verified on the plain stream path: 429, 5xx and network errors met while opening the stream retry inside 10 attempts, counting the first, with jittered backoff and Retry-After; a 400 never retries, and anything after the response begins, including a body-read failure, is surfaced without retrying. Retries show a transient Retrying (n/10) toast. The agentic path can still re-issue one no-tools fallback request on a tools error. 0.6.0: an AgentRouter gateway content-blocked 400 is retried twice with backoff and then reported as an AgentRouter moderation block, not a model refusal)
- **Ref:** † OpenRouter: pre-stream errors are normal HTTP errors; mid-stream errors arrive as SSE with HTTP 200. Claude Code and OpenCode retry transient failures.
- **Build:** Retry only on 429, 5xx and network errors, and only if no token was received. Exponential backoff with jitter, max 10 attempts, honor `Retry-After`. Show "Retrying (2/10)" in the UI.
- **Not:** Provider fallbacks, circuit breakers.
- **Done:** 429-then-success fixture succeeds; 400 does not retry; mid-stream failure does not retry.

## A5. Truncation and finish reasons
- **Status:** Have (0.1.3: length note + Continue; no separate `interrupted` state yet)
- **Ref:** † `finish_reason: "length"` means the token limit was hit; `"error"` means mid-stream failure; some context errors are reported as `length`.
- **Build:** Map every finish reason to a message state: `complete`, `length`, `error`, `stopped`, `interrupted` (stream died without finish reason, partial text kept). `length` and `interrupted` show a Continue button that sends a short "continue" turn.
- **Done:** Each state has a fixture and a visible UI treatment.

## A6. Reasoning display
- **Status:** Have (0.1.3: thinking block, stored, never re-sent)
- **Ref:** † OpenRouter normalizes reasoning into `delta.reasoning`; some providers use `reasoning_content`. OpenWebUI shows thinking blocks, even editable. Claude shows a collapsed thinking block.
- **Build:** Accumulate reasoning separately from content. UI: collapsed block above the answer, open while streaming, "Thought for N s" when done. Store it on the message but do not send it back to the model.
- **Done:** Reasoning fixture renders in the block, and a non-reasoning model shows nothing.

## A7. Error UI
- **Status:** Have (0.1.3: 5 classes + Retry; class fixtures: mid-stream only)
- **Ref:** † OpenRouter returns structured errors (code, message). Both before and during streaming.
- **Build:** An error banner on the failed message with a human message, the raw code in a details toggle, and Retry. Distinguish: no API key, bad model, rate limit, network, provider error.
- **Done:** Each error class has one fixture and one visible message.

## A8. Queue messages while streaming
- **Status:** Missing
- **Ref:** † OpenCode v2 queues or steers prompts while a session is busy and runs them at the next safe boundary.
- **Build:** While streaming, Enter queues the message (shown as pending). It sends when the current turn ends. Cancel removes it.
- **Not:** Steering the running turn mid-flight.
- **Done:** Two quick sends produce two ordered turns.

## A9. Markdown rendering (assistant and user)
- **Status:** Partial (one Markdown component for both roles; marked renders markdown and HTML, DOMPurify sanitizes it, links open externally; the identical-render acceptance test is missing)
- **Ref:** All three render markdown for both sides. OpenWebUI and Claude store raw text and render on display.
- **Build:** Store raw markdown only. One renderer for both roles (`react-markdown`, `remark-gfm`, `remark-breaks`). No raw HTML. Links get `rel="noopener noreferrer"` and open externally. Throttle re-render during streaming.
- **Done:** The same markdown string renders identically for user and assistant bubbles.

## A10. Code blocks in messages
- **Status:** Partial (shiki highlighting, language label and Copy ship; highlighting runs on every content change, so the Build line's lazy highlight after streaming is unimplemented; the Copy-equals-fenced-source acceptance test is missing. 0.4.1: fence aliases moved to `lib/languages.ts`, `script`/`airtable-script`/`airscript`/`apps-script`/`gs` route to javascript, and `airtable`/`airtable-formula` render through a new TextMate grammar proven in the same JS regex engine the composer uses; the header shows the fence as the author wrote it)
- **Ref:** Claude and OpenWebUI: language label, copy button, syntax highlighting; OpenWebUI also allows editable code blocks.
- **Build:** Header with language and Copy; monospace; horizontal scroll; highlight lazily after streaming finishes. Copy copies raw text only.
- **Not:** Editable code blocks, run buttons.
- **Done:** Copy output equals the fenced source exactly.

## A11. Composer (input)
- **Status:** Partial (0.1.3: TipTap rich text, Enter sends, ArrowUp history; 0.3.4: Shift-Enter starts a new block, so the block markdown shortcuts format after existing text; 0.4.1: a pasted block-looking paste is inserted as a fenced code block with a guessed language, and Undo restores the raw paste at the same position; the composer acceptance list is still unverified; 0.6.0: the hold-to-talk mic sits beside Send)
- **Ref:** Claude Code: multiline input, history with Up arrow, Esc Esc for rewind. Claude app: rich input with shortcuts.
- **Build:** Rich-text editor serializing to markdown. Single focus ring on the container. Clear immediately on send. History on ArrowUp at doc start, ArrowDown at doc end. Lists continue with Shift+Enter. "```lang" plus Space or Shift+Enter makes a code block. Enter sends outside code blocks.
- **Done:** The acceptance list from the composer spec passes.

## A12. Message actions
- **Status:** Have (destructive edit. 0.4.1: thumbs up/down set and clear a stored rating with `aria-pressed`; the rating is exported as data)
- **Ref:** † OpenWebUI edits and regenerates by adding branches; Claude shows `< 2/3 >` version switchers.
- **Build:** Copy, Regenerate, Edit (user messages). Edit and Regenerate create new branches (see B2). Delete only on explicit confirm.
- **Done:** Edit never removes the old version.

## A13. Auto titles
- **Status:** Have (0.2.1: AI title hardened — bigger token budget, string-or-parts content, DB-authoritative guard, clean fallback. 0.5.0: markdown is stripped before storage and again on read so old rows render. 0.5.1: generated titles keep double underscores such as __init__)
- **Ref:** † OpenWebUI generates titles (and tags) with a task model, without bumping the chat's activity time.
- **Build:** After the first assistant reply, ask a cheap model for a 3-6 word title. Fall back to the first line of the user message. Never block the UI.
- **Not:** Tags and follow-up suggestions (see B7).
- **Done:** Title appears without delaying the reply; failure keeps the fallback.

## A14. Responses API fallback
- **Status:** Have (0.5.1: when a provider rejects `/v1/chat/completions` with the "use `/v1/responses`" marker, the adapter retries once against `/v1/responses` and remembers the `base_url|model` pair for the process; a restart re-probes once. Chat, tools, titles and summaries share the adapter. No setting, schema change or persisted marker. 0.7.0: AgentRouter tool turns no longer replay Azure resource-bound `responses_items` ids or encrypted reasoning; a cross-resource 400 retries once with the item-free body, and `reasoning.summary: "auto"` restores visible thinking)
- **Ref:** AgentRouter's GPT catalogue (`gpt-5.6-sol`, `gpt-6-astra`, `gpt-6.1-sol`) rejects Chat Completions; OpenAI's Responses API is the compatible shape.
- **Build:** Convert messages to `input[]`, flatten tools, send `store:false`, omit `temperature`, map `max_tokens` to `max_output_tokens`, and request a reasoning summary plus encrypted reasoning only when an effort is sent. Stream text, refusals, reasoning summaries, function calls, usage and finish reasons onto the existing events. Replay sanitized reasoning, message and function-call items only for direct OpenAI; for gateways and custom bases, synthesize the chat-shaped history so Azure resource-bound ids and ciphertext never cross a node. Retry once with an item-free body on a cross-resource error. Non-stream titles and summaries read `output[].content[].output_text`.
- **Not:** A per-connection API-mode setting, `previous_response_id` or stored responses, built-in OpenAI tools, a persistent marker, or a live AgentRouter test in CI.
- **Done:** AgentRouter GPT chat, tool call, title and summary work; OpenRouter and DeepSeek still use Chat Completions; a 401/403 stays an auth error; a second 400 surfaces without looping; a marker after visible bytes is not retried; partial tool calls never execute.

---

# B. Conversation data

## B1. Persistence
- **Status:** Have (verify schema)
- **Ref:** OpenWebUI stores chats in a database with per-chat metadata (title, tags, pinned).
- **Build:** SQLite: `chats`, `messages`, `projects`, `memories`, `settings`. Migrations from day one. WAL mode. One writer.
- **Done:** A migration test upgrades an old DB without data loss.

## B2. Message tree (branches)
- **Status:** Missing (what exists is a chat fork: `branchFrom` copies the whole conversation and regenerate/edit-resubmit replace the tail in place; there is no `parent_id` tree and no version switcher)
- **Ref:** † OpenWebUI stores messages as a tree with `parentId` and `childrenIds`; `history.currentId` points at the leaf of the active branch. Claude has version switchers. OpenCode can fork sessions.
- **Build:** Rows with `id`, `parent_id`, `role`, `content`, `created_at`; chat holds `current_leaf_id`. The visible thread is the path from root to leaf. Edit or regenerate inserts a sibling; switching a sibling selects its deepest last descendant.
- **Not:** Merge, diff between branches, full event log.
- **Done:** Path calculation, edit, regenerate and switch are all tested.

```ts
function path(leaf: Msg, byId: Map<string, Msg>) {
  const out: Msg[] = []
  for (let m: Msg | undefined = leaf; m; m = m.parentId ? byId.get(m.parentId) : undefined) out.push(m)
  return out.reverse()
}
```

## B3. Chat list / sidebar
- **Status:** Have (0.5.0: the All chats / Pinned / project dropdown was removed by owner request; the tag filter remains)
- **Ref:** † OpenWebUI sidebar groups by recency, tracks unread state, and does not bump a chat for being auto-titled.
- **Build:** List ordered by last user activity, grouped (Today, Yesterday, Earlier). Rename, delete with confirm. Virtualize if over 200 chats.
- **Not:** Unread dots.
- **Done:** Ordering is stable and tested.

## B4. Search
- **Status:** Missing (0.1.6 shipped FTS5 and a sidebar box; both were removed with the box in 0.5.0. The Ctrl+K palette switches chats by title.)
- **Ref:** † OpenWebUI searches titles, tags (`tag:name`) and message content, and exposes history search to models as tools.
- **Build:** SQLite FTS5 over message text; query returns chat id and snippet. Filters: pinned, project, date. A search box above the chat list.
- **Not:** Semantic search, agent-callable search.
- **Done:** Searching a known phrase returns the right chat with a snippet.

## B5. Pins
- **Status:** Have
- **Ref:** † OpenWebUI chats carry a `pinned` flag.
- **Build:** Boolean column; pinned section on top.
- **Done:** Pin survives restart.

## B6. Folders
- **Status:** Missing
- **Ref:** † OpenWebUI folders can nest and double as project workspaces with their own system prompt and files.
- **Build:** Single level first: `folders` table, `folder_id` on chat, collapsible group in the sidebar. MyAgents already has Projects (E3), so folders are for plain organization only.
- **Not:** Nesting, sharing.
- **Done:** Move a chat into a folder and back.

## B7. Tags
- **Status:** Partial (0.1.6: manual add/remove + sidebar filter)
- **Ref:** † OpenWebUI tags are keyword labels, searchable.
- **Build:** `chat_tags(chat_id, tag)`. Manual add/remove first; auto-suggest from the title model later.
- **Done:** Filtering by a tag returns only tagged chats.

## B8. Temporary chat
- **Status:** Missing
- **Ref:** OpenWebUI and Claude have an incognito mode: not saved, no history.
- **Build:** A `temporary` flag: messages held in memory, no DB rows, no memory writes, no title generation, gone on close. A clear badge in the UI.
- **Done:** After closing, nothing about it exists on disk.

## B9. Export
- **Status:** Have (0.5.0: whole-data JSON with three scopes - everything, chats + projects, memory. Single-chat JSON and Markdown from the chat header)
- **Ref:** † OpenWebUI exports chats as JSON including the tree, tags and pinned state.
- **Build:** Markdown (readable, active branch only) and JSON (lossless, all branches). Single chat and all chats.
- **Done:** JSON export re-imports to an identical chat.

## B10. Import
- **Status:** Have (0.5.0: whole-data merge in Settings -> Data, single-chat JSON from the chat header)
- **Ref:** † OpenWebUI imports its own JSON and can convert other platforms' exports.
- **Build:** Import MyAgents JSON only. Whole-data import keeps the original ids so importing the same file twice is a no-op; an id that already exists is skipped, never overwritten. Missing projects detach the chat; a project memory with no project is skipped. Single-chat import still generates new ids.
- **Not:** Other platforms' formats.
- **Done:** Round trip with B9 passes.

## B11. Delete data
- **Status:** Partial (0.1.6: delete-everything added, needs filesystem test. 0.3.5: chat and project documents are released as soon as no chat or project row points at them)
- **Ref:** † OpenWebUI lets you delete one chat or clear all history from settings.
- **Build:** Delete chat (including spill files and attachments for it). "Delete everything" removes DB, attachments, spill files, caches, then confirms. Memory included, with a warning.
- **Done:** A test against the real filesystem finds no leftover files.

---

# C. Models and context

## C1. Provider and API key storage
- **Status:** Partial (0.1.5: keys live in the Windows Credential Manager and never cross to the renderer, and a rejected key shows a hint; credential-storage acceptance tests are missing. 0.4.1: six kinds — OpenRouter, Agent Router, DeepSeek, Ollama Cloud, Ollama (local) and Custom — each with a default base URL; local Ollama stores no key at all; per-key masking and testing; a missing key blocks the send before the turn starts and names the page that fixes it. 0.6.0: up to ten keys per connection; Providers lists each key and can remove one key or all keys. 0.6.1: every request starts with the first key not cooling down; a quota-flavoured 429 or 402 marks the active key exhausted and moves to another key when one is available, otherwise reports the cooldown; a plain 429 keeps normal backoff; retrying a draft provider replaces its draft key)
- **Ref:** Claude Code and OpenCode read keys from config or environment; desktop apps use the OS keychain.
- **Build:** Store the key in the OS credential store (Windows Credential Manager), never in plain JSON or localStorage. Base URL configurable (OpenRouter default). "Test connection" button.
- **Done:** The key never appears in logs or exports.

## C2. Model picker
- **Status:** Have
- **Ref:** All three have a per-chat model selector.
- **Build:** Dropdown showing provider and model, remembering the last choice per chat, with a recent-models list.
- **Done:** Switching mid-chat applies to the next turn only.

## C3. Model catalogue and capabilities
- **Status:** Have (0.1.7: Rust-side fetch, 24h TTL cache, caps per model. 0.3.4: an absent supports_vision is unknown rather than blind, a known-family table answers when the provider reports no modality, a per-model override wins over both, and Settings → Models lists every configured provider. 0.4.1: the Models page is a capability table per connection; DeepSeek seeds `deepseek-chat` and `deepseek-reasoner` with an unknown window and no vision, and Ollama Cloud falls back from `/v1/models` to `/api/tags`. 0.5.0: DeepSeek seeds a cited context window instead of unknown. 0.6.0: the backend catalogue and picker caches are ten hours; Refresh on Models, saving/deleting a provider or a successful test invalidates. 0.6.1: Refresh bypasses the backend cache, empty lists are not cached, a request that finishes after invalidation cannot repopulate the cache, and stored entries are Zod-validated)
- **Ref:** † OpenRouter's models list includes context length and supported parameters.
- **Build:** Fetch, cache with a TTL, and read: context length, supports reasoning, supports tools. Disable UI that a model cannot use. Fall back to safe defaults when unknown, to a known-family table for image support, and to a per-model override when the user knows better.
- **Done:** A model without tool support never gets tools in its request.

## C4. Reasoning effort control
- **Status:** Have (0.1.7: caps-gated selector, mixed param shape, Rust re-gate. 0.4.1: hidden for DeepSeek, Ollama Cloud and local Ollama, whose request body carries no reasoning field)
- **Ref:** † OpenRouter accepts a `reasoning` request parameter with effort. Claude Code has effort levels and a thinking toggle.
- **Build:** Selector (off, minimal, low, medium, high) shown only for reasoning-capable models (C3). Maps to the provider parameter.
- **Done:** The request body contains the parameter only when supported.

## C5. Usage and cost
- **Status:** Have (0.1.7: include_usage on streams, fallback chain, tokens-only footer)
- **Ref:** † OpenRouter returns a final usage chunk (prompt and completion tokens).
- **Build:** Store real usage per assistant message. Footer shows tokens for the chat. Cost only if the catalogue has prices. Fall back to chars/4 labelled "estimate".
- **Done:** Usage from the fixture is stored and displayed.

## C6. Context meter
- **Status:** Have (0.1.7: stored usage + catalogue limit, warn at 80%, limit-estimated flag. 0.4.1: when the provider reports no window the percentage is null and the bar reads `Context unknown · N tokens used` instead of inventing a denominator)
- **Ref:** Claude Code `/context` shows context use.
- **Build:** Last prompt tokens divided by model context length (C3, C5). Warn at 80%.
- **Done:** Meter matches stored usage.

## C7. Prune old tool outputs
- **Status:** Have (0.1.7: older role:tool outputs replaced in send payload only, newest kept)
- **Ref:** † OpenCode first clears old tool outputs and keeps only the most recent chunk (about 40K tokens in its docs), skipping some important tools.
- **Build:** When building context, replace tool results older than N turns with "[output omitted, N bytes]". Stored messages stay intact. Pure function over the message list.
- **Done:** Pruned context is smaller, stored history unchanged.

## C8. Compaction summary
- **Status:** Have (0.1.7: structured template, same-model, range-bound, folds prior summary)
- **Ref:** † OpenCode runs a hidden agent that writes a summary when the context nears the limit; earlier messages remain stored, only the active context changes. Claude Code `/compact` does the same.
- **Build:** Context = system prompt + summary + recent messages. Summarize older messages with the same model using a fixed prompt (goal, decisions, files touched, open tasks). Store the summary as a special message with the range it covers. Show a "context compacted" marker.
- **Not:** Multiple summaries stacking, AI-picked pruning.
- **Done:** After compaction the model can answer a question about an early decision.

## C9. Compact trigger (manual and auto)
- **Status:** Have (0.1.7: /compact exact-match + menu, auto at 80% with latch and off switch)
- **Ref:** † OpenCode has auto and manual compaction, and an option to disable auto. Claude Code has `/compact` and auto-compact near the limit.
- **Build:** `/compact` command, plus auto at about 80% of context using real usage. A setting to turn auto off. Run between turns only.
- **Done:** Crossing the threshold triggers exactly one compaction.

## C10. Provider add recovery
- **Status:** Have (0.6.0: adding a provider persists the row and key first; a failed model check keeps the row and the dialog open with the step, HTTP status and raw provider message; Retry test, Keep provider and Delete. Only an insert or key-write failure rolls back. The active connection switches only after success. Ollama Cloud verifies with `GET https://ollama.com/api/balance` and lists models through `/v1/models` then `/api/tags`. 0.6.1: retrying a draft provider replaces its draft key instead of appending another)
- **Ref:** Provider setup should be a diagnostic, not a save gate; a transient network, 401, 404 or empty model list must not delete a valid row.
- **Build:** Save the row and key, verify non-destructively, keep the previous active connection until verification succeeds, format Tauri `AppError` objects with the existing `formatInvokeError`, and surface rollback failures instead of swallowing them. Keep the last test result on the provider card. A provider without `/models` can still be kept for chat-only use.
- **Not:** A provider that disappears unless the user deletes it or the database insert fails; treating an empty model list as proof the key is invalid.
- **Done:** A 401, 404, network timeout or empty model list leaves the row and dialog in place with the exact message; an insert or keyring failure is explicit; Ollama Cloud never calls `/api/me`; a successful add switches the active connection only after the check passes.

---

# D. Tools and agent loop

## D1. Tool-call loop
- **Status:** Have (0.1.5: mid-loop text retracted, identical pure calls collapsed; 0.3.6 verified: each call is stored on the message and its log stays visible after the turn ends and after reopening the chat. 0.4.1: calls the model writes as plain-text DSML markup are recovered by a chunk-safe scanner, run once even when the API also returns structured calls, and the envelope never reaches the stored text)
- **Ref:** † OpenCode and Claude Code: call the model, run its tool calls, return results, repeat until a final answer.
- **Build:** Loop with a step cap (D3). Each tool call is stored as a message part with input, output, status, duration.
- **Done:** A two-tool turn completes with both results visible.

## D2. Streaming tool loop
- **Status:** Missing
- **Ref:** † Stream tool-call arguments as deltas keyed by `index`; assemble before executing.
- **Build:** Accumulate `ToolCallDelta` events (A3) into complete calls; execute after the finish reason `tool_calls`. Show "running" state in the UI as soon as the name arrives.
- **Done:** Split argument fixtures assemble into valid JSON.

## D3. Step cap and doom-loop guard
- **Status:** Have (0.3.3 verified: max_iterations 25 clamped 1..32 with a no-tools fallback at the cap; the same tool with the same arguments three times in a row asks Keep going / Stop here)
- **Ref:** † OpenCode has a `doom_loop` permission that asks before repeating identical calls.
- **Build:** Max steps per turn (for example 25). If the same tool with the same arguments repeats 3 times, stop and ask the user.
- **Done:** A looping mock model is halted.

## D4. Permission engine
- **Status:** Have (0.1.3: `permissions.rs` decide + SQLite always-rules, rules UI pending; 0.3.6: `update_memory` default allow, `delete_memory` default ask, approval scoped to the memory row id rather than the tool name)
- **Ref:** † OpenCode: allow, ask, deny per tool with pattern rules; v2 denies if any resource denies, else asks if any asks. † A v1 bug let "Allow always" (stored as `*`) override denies. Claude Code uses the same three effects.
- **Build:** Rust function `decide(tool, target) -> Allow | Ask | Deny`, called inside every tool handler right before execution (never only in the frontend). Deny beats ask beats allow. "Always allow" stores a rule for that exact command prefix, never `*`. Rules in a settings file.
- **Not:** Per-agent profiles, rule-editor UI.
- **Done:** Deny beats a saved allow; unknown tools default to ask.

```rust
fn decide(rules: &[Rule], tool: &str, target: &str) -> Decision {
    let hits: Vec<_> = rules.iter().filter(|r| r.matches(tool, target)).collect();
    if hits.iter().any(|r| r.effect == Deny) { return Deny }
    if hits.iter().any(|r| r.effect == Ask) { return Ask }
    if hits.iter().any(|r| r.effect == Allow) { Allow } else { Ask }
}
```

## D5. Approval UI
- **Status:** Have (0.1.3: inline card once/always/deny; reload re-show pending)
- **Ref:** Claude Code and OpenCode prompts show the command and offer once, always, or deny.
- **Build:** Inline card in the chat: tool name, full command, working directory. Buttons: Allow once, Always allow this command, Deny (optional reason, returned to the model). The loop awaits the answer. Dismissing equals deny. Stop cancels the pending request.
- **Done:** The loop pauses until a button is pressed, and survives a UI reload by re-showing the card.

## D6. Permission modes
- **Status:** Missing
- **Ref:** † Claude Code cycles default, acceptEdits and plan with Shift+Tab; plan mode is read-only exploration before changes.
- **Build:** Modes in one setting: Ask (default), Accept edits (auto-allow file edits only, shell still asks), Plan (only read tools exposed), Sandbox (D22: `sandbox_run` and the jailed project file tools auto-allow after the M1 screen; host calls outside the project still ask, and `run_powershell` becomes inspection only). A mode badge near the composer.
- **Not:** Fully-automatic "yolo" mode. Sandbox mode is a UX shortcut; the container carries the boundary (D22).
- **Done:** In Plan mode, write and shell tools are not even sent to the model; in Sandbox mode a host call outside the project still asks and an explicit Deny rule beats auto-allow.

## D7. Shell tool
- **Status:** Partial (0.1.3: approval + per-segment rules + kill-on-stop; cwd still home, not project)
- **Ref:** † OpenCode parses bash with tree-sitter to apply per-command rules. Claude Code asks per command pattern.
- **Build:** `run_powershell` goes through D4 and D5. Timeout (default 60s), working directory fixed to the project, output captured and capped (D13), kill process tree on stop. Parse the command into segments (`;`, `&&`, `|`) and evaluate each, so `ls; rm x` cannot hide behind an allowed `ls`. In Sandbox mode (D6) the host shell is inspection only: reading state (time, disk, largest files, process and network state) is allowed, and anything that creates, updates or deletes files, or runs project code, is refused with a reason that points at the sandbox (D22).
- **Not:** Persistent shell sessions, PTY.
- **Done:** Compound commands are checked per segment; timeout kills the child.

## D8. Read file tool
- **Status:** Unknown
- **Ref:** † OpenCode `read` returns file contents or a directory listing, with size limits.
- **Build:** Path must resolve inside the project (canonicalize, reject `..` and symlink escapes). Line-range parameters, size cap, binary files refused. Default allow.
- **Done:** Path escape attempts are rejected.

## D9. List, glob and grep tools
- **Status:** Unknown
- **Ref:** † OpenCode uses ripgrep under the hood for grep, glob and list, and tells models to prefer grep over bash grep.
- **Build:** Shell out to bundled ripgrep, or use the `ignore` and `grep` crates. Respect `.gitignore`, cap results, project-bound paths. Default allow.
- **Done:** A search returns capped, relative paths.

## D10. Write and edit tools
- **Status:** Unknown
- **Ref:** † OpenCode requires reading a file before editing or overwriting it. Edit replaces an exact string.
- **Build:** Edit = exact match replace; fail if the match is zero or multiple. Refuse if the file was not read in this session or changed since. Write goes through D4 (mode `Accept edits` can auto-allow).
- **Not:** Patch-file format.
- **Done:** Stale or ambiguous edits fail with a clear message to the model.

## D11. Diff view
- **Status:** Missing
- **Ref:** OpenCode and Claude Code show a diff for edits.
- **Build:** Store before and after for each edit; render a unified diff in the tool card and in the approval card for edits.
- **Done:** The diff matches the file change.

## D12. Checkpoints / undo
- **Status:** Missing
- **Ref:** † Claude Code `/rewind` restores code, conversation, or both, but only tracks files edited through its own tools in the current session (not shell changes).
- **Build:** Before each edit/write, copy the original into a per-chat snapshot folder. "Undo this change" restores it. Rewinding the conversation just moves the branch leaf (B2).
- **Not:** Git integration as the undo mechanism (S1 stores one git snapshot per sandbox exec as recovery data, with no UI — see D22), tracking shell-made changes.
- **Done:** Undo restores bytes exactly.

## D13. Output cap and spill files
- **Status:** Have (0.1.4: capped at 32KB with the full output in `spill/<chat>/<id>.txt` and the path in the truncation notice)
- **Ref:** † Tools cap output sent to the model; OpenCode and Claude Code let the model re-read slices.
- **Build:** Cap at about 32KB. Write the full output to `spill/<chat>/<id>.txt` and append "[truncated, full output at path]". The model reads it with D8. Delete with the chat (B11).
- **Done:** Large output is capped in context but fully recoverable.

## D14. Web fetch
- **Status:** Have (0.2.0: `web_fetch`, https-only, SSRF guard + redirect re-check, htmd conversion, audit rows)
- **Ref:** † OpenCode `webfetch` reads web pages; default permission is allow in some setups, ask in safer templates.
- **Build:** Default ask. HTTP(S) only, block private, loopback and link-local addresses, resolve DNS before connecting and re-check after redirects (SSRF). Convert HTML to text, cap size, 15s timeout.
- **Done:** Requests to localhost and 169.254.x.x are rejected.

## D15. Web search
- **Status:** Have (0.2.0: `web_search`, Tavily default + SearXNG endpoint, key in vault, Settings/onboarding; multi-key rotation on 429/402/quota. 0.4.1: Exa as a quota-only fallback with its own stored key, mask, probe and a tested decision function)
- **Ref:** OpenCode has a `websearch` permission; OpenRouter offers web search plugins.
- **Build:** One provider behind one tool; default ask; returns titles, URLs, snippets. Needs a key. Not before D14.
- **Done:** Results render as links the model can fetch.

## D16. Question tool
- **Status:** Have (0.1.3: `ask_user` tool, loop-awaited card with options + custom text)
- **Ref:** † OpenCode's `question` tool shows a header, question and options (with a custom answer) and waits.
- **Build:** Tool with `question`, `options[]`; the loop pauses, the UI shows buttons plus free text, the answer returns as the tool result.
- **Done:** The loop resumes with the chosen answer.

## D17. Todo list tool
- **Status:** Have (0.2.0: `todo_write`/`todo_set`, per-chat in DB, sticky checklist. 0.4.1: the sticky card is gone — the list lives in the session panel and the header shows `Step n of m` from the same rows)
- **Ref:** † OpenCode `todowrite` and `todoread`; OpenWebUI has task management in chat for multi-step work.
- **Build:** Tool that replaces a list of `{text, status}`. Rendered as a sticky checklist above the composer. Per chat, stored in the DB.
- **Done:** The model updates the list and the UI reflects it.

## D18. Subagents
- **Status:** Done (v0.4.0: `delegate_task`, depth 1, child events scoped to the parent tool entry)
- **Ref:** † Claude Code and OpenCode delegate subtasks to separate agents with their own context.
- **Build:** `delegate_task(task, model?)` runs one child agent with its own context and the same tools minus `delegate_task`, then returns a capped summary as the tool result. Child deltas, reasoning, tool starts/results and retries stream as `subagent` events into the parent tool entry's preview only; approvals and questions stay on the global card. Child inherits project, conversation, search and vision settings. Cancel reaches the child through the parent's notify plus an ancestry check on the cancelled set.
- **Done:** The parent transcript never receives child text; the child cannot delegate further; approvals appear once; one audit row per user-facing decision.

## D19. Tool output controls
- **Status:** Have (0.3.2: `src-tauri/src/tooltext.rs` shaping + per-tool caps + `{shown,total,truncated}` reports)
- **Ref:** Give the model the same levers a shell user has, so it asks for less instead of reading everything. Extends D13
- **Build:** Optional `max_chars` (plus `start`, `grep`, `format`) on `web_fetch`; `max_results` and `fields` on `web_search`; `head`, `tail`, `grep`, `max_chars` on `run_powershell`; `limit` on `recall_memory`. Safe default cap per tool; old prompts keep working. Strip ANSI and repeated blank lines in Rust before counting. Every result carries `{ shown, total, truncated }`, never truncates silently, and says how to get the rest. One line in each tool description tells the model to use the filters
- **Done:** Median `web_fetch` and `run_powershell` result is under 2,000 tokens and no tool exceeds its cap unless the model asks. Unit tests for truncation, `grep` and ANSI stripping

## D20. Result handles and on-demand tool definitions
- **Status:** Missing (plan: Phase 1)
- **Ref:** Anthropic code execution with MCP: the model sees a summary and a handle, not the payload
- **Build:** Results over the cap are written to `results/<turn-id>/<n>.txt` and returned as `{ handle, bytes, lines, preview }`. One tool `read_result(handle, grep?, head?, tail?, start?, max_chars?)` reads slices and rejects any path outside `results/`. Handles live for the chat, are deleted with it, and are swept after 7 days. Send a small core tool set each turn and load the rest with `search_tools(query)` once external MCP tools exist
- **Done:** A 200 KB page fetch adds under 1,000 tokens and a `read_result` `grep` still answers a detail question. Cleanup tested on chat delete

## D21. Code mode
- **Status:** Missing (plan: Phase 2; off by default)
- **Ref:** Anthropic code execution, Cloudflare Code Mode and StackOne: tools as async bindings inside a sandbox, bindings the only way out
- **Build:** One `execute_js(code)` tool running plain ES2020 in `rquickjs` on a blocking thread, a fresh runtime per snippet: 32 MB memory, 20 s wall clock, 50 tool calls, 200 KB returned. A global `tools` object exposes only the tools enabled for the chat; each call goes over a channel to Rust and runs the real tool through the same approval and cap path, never inside the script. No `fetch`, `require`, filesystem or process access, and no recursive `execute_js`. Errors return `{ error, tool, line, message }`. The system prompt says when to use it (loops, joins, filtering) and when not to
- **Not:** Running untrusted third-party code (in-process QuickJS is enough for the model's own code)
- **Done:** Windows `rquickjs` spike builds and enforces the limits; a fake-model loop test asserts 2 model requests; hostile scripts (infinite loop, memory bomb, huge output, recursive call, `fetch` or filesystem attempt) fail structurally

## D22. Container sandbox
- **Status:** Done (v0.4.0 S1)
- **Ref:** † Claude Code and OpenCode run tools on the host behind permission rules; this moves code execution into a container instead, and keeps only file operations on the jailed host.
- **Build:** One `sandbox_run(cmd, cwd, timeout)` tool. Each call is one ephemeral `docker run --rm` with `--network none`, `--read-only`, a writable 256MB `/tmp` used as `HOME`, `--user 1000:1000`, `--cap-drop ALL`, `no-new-privileges`, `--pids-limit 256`, `--memory-swap` equal to `--memory`, a single project-dir bind (`.git`, `.vscode`, `.husky`, `.github` and the agent-config files overlaid read-only) and a `timeout` wrapper inside. Cancel and timeout call `docker kill`. A pinned Debian slim base is pulled on Enable, then one local derived image is built and referenced by digest. Output is collected, capped and spilled through D13 (no per-call event channel yet). Before each exec a git snapshot is written to `refs/myagent/pre-exec/<id>` (temporary index, so untracked files are included); after exit a receipt lists changed config, hook and agent-config files. No secret env reaches the container. Host file tools stay jailed (D8-D10) and refuse the overlaid paths.
- **Not:** Untrusted third-party code, per-exec undo or diff UI (v2), background or long-lived execs, host-exec fallback when Docker is absent.
- **Done:** A `python3` socket connect and a ping fail inside; a host path under `/run/desktop/mnt/host/...` and a `..` escape fail; a `.git/hooks` or `AGENTS.md` write fails from the container and from host tools; a fork bomb and an output flood are contained with a spill path; after `rm -rf .` the checkpoint restores the tree including a previously untracked file; a killed app leaves no labelled container behind; the daemon being down refuses the exec with no host fallback.

## D23. Research job
- **Status:** Done (v0.4.0: `research_run`, planner queries, one approval card, cited markdown memo artifact)
- **Ref:** † Claude Code and OpenCode delegate multi-source lookups; cited research memos are the expected output shape.
- **Build:** One in-turn tool `research_run(query)` in `src-tauri/src/research.rs`: a planner call turns the question into up to 3 search queries, `websearch::search` gathers up to 10 unique hits, up to 4 pages are fetched with `webfetch::fetch_page`, a 60K-character notes digest feeds a main-model synthesis call, and the memo returns as the tool result plus a `StreamEvent::Artifact` markdown artifact. Budgets: 25s per search, 20s per fetch, 90s for search and fetch, 60s for synthesis, 6K chars per page, 12K chars memo. Progress re-sends `ToolStart` with the same id so the tool entry updates in place. Cancel propagates from the parent turn; a failed synthesis still returns a source list.
- **Not:** Background jobs, more than one concurrent job, a research-only task model, per-host pre-grants (the single `research_run` card covers the whole job).
- **Done:** One approval covers search and fetches; the memo cites its sources and opens as a markdown artifact; cancel stops the job; tests cover query parsing, dedupe, notes and memo caps.

## D24. Voice transcription
- **Status:** Done (v0.4.0: hold-to-talk in the composer, local Moonshine base int8, optional OpenAI-compatible remote provider. 0.4.1: the activity pill mirrors the phase — `Listening — release to send` with a pulsing dot, then `Transcribing` with a spinner, cleared on cancel or append)
- **Ref:** Whisper-style dictation in chat clients; the plan's V1 spec.
- **Build:** `public/pcm-worklet.js` captures 16 kHz mono in 1024-frame chunks; `src/lib/voice.ts` merges, converts to i16 and caps at 60 s; `useVoiceInput` owns press-and-hold, cancel and the draft append. Rust `voice.rs` exposes `voice_status`, `voice_enable`, `voice_disable`, `voice_set_provider` and `audio_transcribe`. Enable downloads `onnx-community/moonshine-base-ONNX` (encoder + merged decoder + tokenizer, ~64 MB, pinned sizes) into `app_local_data_dir/models/moonshine-base` with progress events; the model loads lazily and unloads after five idle minutes. `transcribe-rs` is vendored at `src-tauri/vendor/transcribe-rs` with the ort rc.15 environment patch. The remote path uses a custom connection's base URL and vault key to POST a WAV to `/audio/transcriptions`. Mic permission is granted through the app-level `on_permission_request` for `Microphone` only.
- **Not:** Hands-free VAD, streaming partial transcripts, TTS, voice clone, the HAP accent notice and the Common Voice WER matrix (v0.4.x follow-up).
- **Done:** Hold the mic, speak, release: the transcript lands in the draft. Local inference was checked against a generated 16 kHz clip; unit tests cover PCM conversion, resampling, WAV framing and the model-ready check.

---

# E. Memory and instructions

## E1. Global memory
- **Status:** Partial (0.5.0: notes live in `MEMORY.md` and are sent from there; retrieval is still a full dump, capped at 2500 characters and 24 notes per scope, with an “N not sent” counter in Settings. 0.3.6: the model can update and delete a memory by the id `recall_memory` prints)
- **Ref:** Claude app memory; † Claude Code `/memory` edits memory files and auto-memory. † OpenWebUI injects only retrieved memories per turn (`add_memory_context`).
- **Build:** A list of short facts the user can view, edit and delete. Per turn, retrieve by the current user text (keyword match, top-k), char-cap the block, and replace the previous turn's block — never dump all memories. Unrelated memories must not reach the model.
- **Not:** Sending every memory every turn.
- **Done:** A test sends an unrelated memory plus a matching one; only the matching one is in the prompt.

## E2. Secret refusal in memory
- **Status:** Have (0.5.0: `memory::looks_secret` runs before checked file writes, every assistant proposal and every manual edit. Key shapes, private-key headers and `password=`/`token=`/`Bearer` are refused with a reason. The one exception is the legacy migration: existing `memories` rows are copied into `MEMORY.md` without this screen so the upgrade does not lose notes. A note proposed after a web, shell, sandbox, document, image, MCP or subagent tool is tagged untrusted in the inbox and in the file; filters can only drop, never approve. Editing an existing note asks first)
- **Ref:** Claude does not store credentials in memory.
- **Build:** Pure function `looks_secret(&str) -> bool`: API key shapes (`sk-`, `ghp_`, `AKIA`, long hex/base64), private key headers, `password=`, `token=`, `Bearer`. Runs before every new memory write; legacy migration copies existing rows without this screen. Tell the user when blocked. Panic-free.
- **Not:** Entropy scanning of all chat.
- **Done:** Unit tests cover obvious keys and ordinary notes; the tool path refuses `remember this sk-…` with a reason.

## E3. Projects
- **Status:** Partial (threads + instructions + shared memory have; knowledge files missing)
- **Ref:** † OpenWebUI folders act as project workspaces with a system prompt and files. Claude app Projects hold instructions and knowledge; every chat in the project inherits both, but chats stay independent otherwise.
- **Build:** Project = name + description + instructions + knowledge (text notes plus stored docs) + chats (threads) + shared project memory. Every thread in the project gets the same instructions, knowledge excerpt, and project memory in context. Project folder is docs storage only in v1; tool sandbox enforcement waits for v2.
- **Done:** Two threads in one project receive identical instructions and project memory; thread-private history never leaks across.

## E4. Project instructions file
- **Status:** Unknown
- **Ref:** † Claude Code reads `CLAUDE.md` (project, user, and path-specific rules); OpenCode reads `AGENTS.md`. Hooks enforce rules, but instructions are only guidance.
- **Build:** Read `AGENTS.md` from the project root if present, add it to the system prompt, show it in the UI as "Instructions loaded".
- **Not:** Hierarchies and path-specific rules.
- **Done:** Editing the file changes the next turn.

## E5. System prompt and parameters per chat
- **Status:** Have (0.4.1: a global default system prompt in Settings → General, a project block, and a per-chat prompt behind the chat header's ••• menu; the order identity → Standing instructions → Durable memory → project → This chat is tested. Temperature and other sampling parameters are still not exposed)
- **Ref:** † OpenWebUI sets system prompt and parameters at chat, account or model level.
- **Build:** Global default, per-project override, per-chat override of the system prompt. Temperature only if needed.
- **Done:** Override order is tested.

## E6. Auto memory (agent-written)
- **Status:** Partial (0.5.0: Save appends the approved note to the memory file and Undo puts the pending row back; E2's secret gate and untrusted tag now guard proposals. 0.3.6: the model writes, updates and deletes memories through tools. 0.4.1: every model write lands in `pending_memories` and surfaces as a Save/Dismiss toast, and `source_conversation_id` keeps the provenance; thread roll-up is still missing)
- **Ref:** † Claude Code writes its own notes per project and lets users audit them.
- **Build:** The model may write memory only for durable bio, preferences, or an explicit "remember this". Thread summary stays primary and private; durable project points roll up from the thread into shared project memory on close, on explicit ask, or about every 10 turns — 1-5 bullets, facts only, never transcript quotes. Everything else stays in chat history. Enforce in the `remember` tool description plus the system prompt. Every write gated by E2. Every saved note visible and deletable.
- **Not:** Writing memory every turn, or silently.
- **Done:** Test asserts the tool rules, E2 blocks secrets, roll-up carries decisions with no private detail, and no auto-write path exists.

## E7. Memory file (`MEMORY.md`)
- **Status:** Have (0.5.0: one `MEMORY.md` plus `projects/<id>.md`, four headings - User, Preferences, Project, Decisions - and an id/date comment on every bullet. 0.4.1 rows migrate once at boot into the files, with a full JSON backup under `memory/legacy/`, an unassigned queue for notes whose project was deleted, and the `memories` table frozen rather than dropped. The raw editor rejects a save when the file changed on disk. A failed migration keeps the database path and shows a banner)
- **Ref:** † Claude Code `/memory` edits markdown; † OpenCode reads `AGENTS.md`.
- **Build:** The file is the source of truth; SQLite is only the migration source and the fallback. Writes are atomic (temp file then rename) and serialised. Outside text and unknown comments are preserved. Notes cap at 2000 characters; the send budget, not the write, keeps the file small.
- **Not:** Syncing the file with the database after migration, or editing project files from the global page.
- **Done:** File tests cover round-trip, CRLF/BOM, escaped comment markers, unknown text, duplicate ids and the sent budget. Migration tests cover an empty DB, an old row, an unknown kind, a deleted project, an existing file and a lost marker.

## E8. Memory migration and rollback
- **Status:** Have (0.5.0: one-time, idempotent migration from `memories` to `MEMORY.md`; full JSON backup under `memory/legacy/` before any file write; atomic rename; file existence is the idempotency key, not the marker; orphan project notes go to `legacy/unassigned.json`; `memories` stays frozen as the rollback snapshot; `pending_memories` is untouched. 0.5.1: a lost marker keeps notes the user deleted deleted, atomic saves no longer rotate a `.bak` first, manual dates must be `YYYY-MM-DD`, and late rows from a downgrade merge automatically)
- **Ref:** A migration that cannot lose a note; the file is the source of truth and SQLite is only the migration source and fallback.
- **Build:** Backup every row verbatim with schema version, counts and app version, then `fsync` it before writing files. Never `UPDATE`, `DELETE` or `DROP` `memories`. Write each file through `.tmp` then rename. If migration fails, keep reading `memories` and show a compatibility banner. Re-upgrade compares `memories` with the marker's known IDs and appends only unknown rows; IDs already known stay deleted. Downgrading to 0.4.1 shows memory as of the upgrade; a 0.5.0 export re-imports newer notes by ID without duplicates.
- **Not:** A file watcher, automatic near-duplicate consolidation, semantic retrieval, per-workspace memory folders, or a supported downgrade path.
- **Done:** A fixture covering long, multi-line, duplicate, unknown-kind and orphan rows imports with matching IDs and text; a second launch is a no-op; killing the app mid-migration loses nothing; a lost marker does not re-import deleted notes; a read-only file fails loudly; invalid manual dates are refused.

---

# F. Rendering and files

## F1. Artifact drawer
- **Status:** Partial (preview exists. 0.4.1: the dock is a 344 px Progress panel — steps, outputs, used in this session — with the artifact view one Back arrow away; the artifact dock defaults to 480 px and resizes; below 1100 px the panel overlays with a focus trap; a sidebar Outputs entry opens a gallery of the chat's artifacts and written files)
- **Ref:** † OpenWebUI renders web content and SVGs in the interface with live updates. Claude shows artifacts in a side panel with Preview and Code tabs.
- **Build:** Side drawer: Preview and Code tabs, Copy, Download, version list from regenerations. Triggered by a fenced block with an artifact marker.
- **Not:** Version list from regenerations.
- **Done:** Regenerating adds a version instead of replacing.

## F2. Artifact isolation
- **Status:** Partial (the artifact preview iframe still allows scripts, so it can reach IPC. 0.4.1: gallery thumbnails are a stricter case — `sandbox=""` with `<script>`, inline handlers and `javascript:` URLs stripped by a tested function, so a thumbnail cannot run anything)
- **Ref:** † OpenWebUI renders in an iframe with an injected CSP. † Tauri's Isolation pattern guards the IPC channel from untrusted frontend code but does not sandbox artifact HTML.
- **Build:** `<iframe sandbox="allow-scripts" srcdoc=...>` without `allow-same-origin` (opaque origin: no parent, storage or IPC access). Strict CSP meta in the artifact: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`. No Tauri capabilities for it. Parent talks to it via `postMessage` with validated shapes. External links opened by the host through a checked handler. Consider Tauri's Isolation pattern for the main window as extra hardening.
- **Not:** Per-artifact origins, artifact storage.
- **Done:** A test artifact that calls `parent`, `localStorage` and `invoke` fails on all three.

## F3. Attachments and project knowledge
- **Status:** Have (0.3.0: project Docs tab with sha256 dedupe and capped excerpts. 0.3.5: any chat can attach documents — text, markdown, code, HTML, PDF, DOCX, XLSX/XLS/ODS — extracted in Rust, injected into the user turn, and reachable later through the `read_document` tool; docs in a project also leave a reference in the project bucket; stored text is freed when nothing points at it. 0.4.1: attachments render as a 168 px card with a type chip, a two-line name and a size/character meta line that says Size unknown rather than guessing)
- **Ref:** Claude app Projects hold knowledge files every chat inherits; OpenWebUI accepts files in the composer.
- **Build:** Two paths, one content-addressed store under `documents/<sha256>.txt`: composer attachments (chat-scoped, up to 3 per turn, 10 MB per file) plus a project knowledge panel whose docs are searched on every send. Extraction classifies by mime then extension and caps text at 2 MB; the turn carries 40k chars per file. Full re-read through `read_document`. No code execution.
- **Not:** OCR, embedded media, charts, legacy `.doc`/`.ppt` binaries, audio/video.
- **Done:** Text excerpt of an attached project doc reaches the next turn's context.

## F4. Image input (vision)
- **Status:** Have (0.3.0: paste/attach + downscale, blind models route to vision fallback tool, non-vision never gets image parts. 0.3.2: sent images are stored on the message, survive regenerate and edit-resubmit, and render after reload. 0.3.4: image support is tri-state — a provider that reports no modality reads unknown and is treated as able to see, a known-family table answers in between, a per-model override in Settings → Models wins over both; only a model that cannot see is routed to the fallback and offered describe_image, which now runs on the fallback model's own provider. 0.6.1: raw clipboard images that arrive as clipboard items, not files, paste as attachments; unnamed screenshots get a generated name)
- **Ref:** Claude and OpenWebUI accept pasted images for vision models.
- **Build:** Paste or attach, downscale to a max edge, send as a content part unless the model is known not to see (C3), with a per-model override in Settings → Models.
- **Done:** A non-vision model never receives an image part.

## F5. Mermaid and LaTeX
- **Status:** Missing
- **Ref:** † OpenWebUI renders Mermaid diagrams in some views.
- **Build:** Later: lazy-loaded renderers inside A9. Never block text on them.
- **Done:** n/a for now.

---

# G. App shell

## G1. Slash commands
- **Status:** Have (0.2.0: registry with /compact /export /clear /model + /new /memory /settings, vitest)
- **Ref:** † Claude Code and OpenCode have `/compact`, `/export`, `/fork`, `/copy` and more; Claude Code custom commands are markdown files that are now part of skills.
- **Build:** Typing `/` at the start opens a filtered menu. Start with `/compact`, `/export`, `/fork`, `/clear`, `/model`. Commands are a plain registry in code.
- **Not:** User-defined commands.
- **Done:** Each command has a test and appears in the menu.

## G2. Keyboard shortcuts
- **Status:** Partial (composer only)
- **Ref:** † Claude Code: Esc stops, Esc Esc rewinds, Shift+Tab cycles modes.
- **Build:** Esc stop, Ctrl+N new chat, Ctrl+K search, Ctrl+, settings. A shortcuts list in settings.
- **Done:** Shortcuts do not fire while an IME is composing.

## G3. Settings page
- **Status:** Have (0.4.1: one 960 px / 92vw modal, 86vh tall, with 14 pages, a subtitle per page, a search that jumps to a row on another page and highlights it, a focus trap, and close restoring focus to the opener. A test holds every page id to a subtitle and to at least one search term, and no term may point at a page that does not exist)
- **Ref:** † Claude Code `/config`; OpenWebUI has settings per account.
- **Build:** Sections: Provider (C1), Models, Permissions (D4 rules list), Memory, Data (B9-B11), Appearance. One JSON file backs it.
- **Done:** Settings persist and reload.

## G4. Theme
- **Status:** Have (0.4.1: theme tiles, accent, a text-size scale applied to the root font size so rem-based text and spacing grow together, and comfortable/compact density; prefs persist in localStorage and a corrupt value falls back instead of breaking the layout)
- **Build:** Light, dark, system. CSS variables only.
- **Done:** No hard-coded colors outside the variable file.

## G5. Completion notification
- **Status:** Missing
- **Build:** Native notification when a long turn or an approval request finishes while the window is unfocused.
- **Done:** No notification when the window is focused.

## G6. Debug log view
- **Status:** Missing
- **Ref:** † OpenCode has `/debug`.
- **Build:** Rolling log file plus a "Copy debug info" button (app version, OS, model). Never log keys or full prompts by default.
- **Done:** Log contains no secrets (test with a fake key).

## G7. Auto-update
- **Status:** Missing
- **Build:** Later; use the platform updater with signed releases. Not before the app is stable.
- **Done:** n/a for now.

## G8. Changelog page
- **Status:** Have (0.3.2: settings page between Shortcuts and About, releases from `src/lib/releasenotes.ts`)
- **Ref:** Desktop apps ship a "What's new" surface; `docs/releases/` already holds the notes
- **Build:** A settings page placed before About in the nav. An installed-version card with **Check for updates** (spinner, then a confirmation), then releases newest first. Each release header shows version, a Current pill, date and change count, and expands to a one-line summary and its changes; each change carries a New / Improved / Fixed label. The latest release is open, older ones collapsed. A type filter opens every release that matches and hides the rest. Reachable from Settings, About, the profile menu ("What's new") and the command palette
- **Done:** The page lists the installed version and every stored release note; the filter hides non-matching releases; it opens from all four entry points

## G9. First-run onboarding
- **Status:** Have (0.6.0: four steps — welcome and display name, provider, model, search/suggestions. Each step can be skipped; the provider step keeps the row when the first model check fails so the key can be corrected)
- **Build:** A short first-run flow that stores the display name, adds a provider through C10, picks a model, and optionally configures web search. Skipping a step must not block the app or lose an already-saved provider.
- **Done:** A fresh profile reaches the chat screen after all four steps; every step can be skipped; a failed provider check leaves the row and the dialog available for correction.

## G10. Jump to latest and activity status
- **Status:** Have (0.5.0: jump-to-latest is a sibling of the scroller, 16 px above the chat area, and holds at every scroll offset; exactly one `role="status"` activity pill is mounted — centered while the transcript is empty, inline above the composer afterwards)
- **Build:** Keep the jump control outside the scrolling content so it never scrolls away. Render one activity pill per state, not both placements at once.
- **Done:** The jump button holds its position at every scroll offset; one turn produces one `role="status"` node per state.

---

# H. Quality

## H1. Test harness
- **Status:** Partial (vitest and cargo test suites exist and are green; CI runs the Rust suite only, the frontend suite is not wired into CI)
- **Build:** Rust unit tests for pure logic (A3, A4, A5, D4, E2, B2 path). A mock provider that replays SSE fixtures. Three smoke tests: send, stream, stop. One command runs all; CI blocks merge on failure.
- **Done:** `test` command is green on a clean checkout.

## H2. Recorded fixtures
- **Status:** Missing
- **Build:** A `fixtures/` folder of real recorded streams: plain text, reasoning, tool calls, `length`, mid-stream `error`, comment lines, usage chunk, 429. Each fixture has an expected-events file.
- **Done:** Every parser and loop test uses a fixture, not an inline string.

---

# J. Differentiators

Ideas that make MyAgents better than a plain Claude-app clone. All are "Later": none starts before Phase 5 is done. Sources: product ideas plus the OpenRouter usage and model-list behavior noted earlier.

## J1. Context inspector
- **Status:** Missing
- **Ref:** Claude Code `/context` shows context use; no mainstream chat app shows the full request.
- **Build:** A panel listing exactly what the next request contains: system prompt, memory, project instructions, summary, kept messages, tool definitions, each with token counts. Read-only view over the context builder output (C7, C8), with a "copy request JSON" button that redacts the API key.
- **Done:** The panel's total matches the tokens reported by the provider within a small margin.

## J2. Cost cap and budget
- **Status:** Missing
- **Ref:** † OpenRouter returns usage per response; the model list carries pricing.
- **Build:** Per-chat and per-day spend limits using stored usage (C5) and catalogue prices (C3). Warn at 80%, block new turns at 100% with an override button. A tool-loop turn also stops when it crosses the cap.
- **Done:** A looping mock agent is halted at the cap.

## J3. Side-by-side compare
- **Status:** Missing
- **Ref:** OpenWebUI supports multi-model chats.
- **Build:** Send one prompt to 2-3 models in parallel (no tools), show answers in columns with tokens, cost and time. "Continue with this one" keeps that answer as the main branch (B2).
- **Not:** Tool use in compare mode, voting or scoring.
- **Done:** Three parallel streams render independently; one failure does not affect the others.

## J4. Local models
- **Status:** Missing
- **Ref:** Ollama and LM Studio expose OpenAI-compatible endpoints.
- **Build:** Provider entry with a custom base URL and optional empty key. Model list from the endpoint's models route. Capabilities default to "unknown" (no tools, no reasoning) until set manually.
- **Done:** A chat works against a local endpoint with no key.

## J5. Cheap-model routing
- **Status:** Missing
- **Build:** A "task model" setting used for titles (A13), compaction (C8) and tag suggestions. Defaults to the chat model if unset.
- **Done:** Title generation request uses the task model.

## J6. Quick-ask hotkey
- **Status:** Missing
- **Ref:** Desktop-app advantage over web apps. If MyAgents is Tauri, there is a global-shortcut plugin.
- **Build:** A global shortcut opens a small always-on-top input; the answer streams in place; "Open as chat" saves it. Temporary by default (B8).
- **Done:** The shortcut works while another app has focus.

## J7. Branch tree view
- **Status:** Missing
- **Ref:** † OpenWebUI's tree data model makes this possible; Claude only shows `< 2/3 >` switchers.
- **Build:** A compact tree of the chat with the active path highlighted; click a node to switch, right-click to fork.
- **Done:** Switching from the tree matches switching with the arrows.

## J8. Action audit log
- **Status:** Have (0.3.0: deny-rule/deny-user/once/always rows + Settings Audit page, search, clear-all; included in delete-all. 0.5.0: migration 27 adds duration, exit code and source columns; the row expands to show them and old rows still render)
- **Build:** An append-only table of tool calls, approvals, denials and "always allow" rule changes with timestamp, chat and exact command. Searchable list in settings; included in delete-all (B11).
- **Done:** Every approval creates exactly one log row.

## J9. Prompt and command files
- **Status:** Have (0.3.0: app-data + bundled `commands/*.md` -> slash commands, `$ARGUMENTS`, no-restart refresh; true `.myagents/` on-disk deferred)
- **Ref:** † Claude Code custom commands are markdown files in the project, now part of skills.
- **Build:** Markdown files in `.myagents/commands/` become slash commands (G1) whose body is a prompt template with an optional `$ARGUMENTS`. Shown in the menu with their first line as description.
- **Done:** Adding a file adds a command with no restart.

## J10. Artifact export
- **Status:** Missing
- **Build:** Download a single artifact as `.html`, or all versions of a chat as a zip. Builds on F1.
- **Done:** The downloaded HTML opens standalone.

## J11. Scheduled runs
- **Status:** Missing
- **Build:** Later only: run a saved prompt on a schedule with the app open, in a temporary chat, with shell and edit tools disabled. Result lands in a "Runs" list.
- **Not:** Running while the app is closed, tool use.
- **Done:** A scheduled run produces a stored result.

## J12. MCP and skills
- **Status:** Have (0.3.0: skills index + `skill` tool + `@mention`; MCP stdio+sse, namespaced tools, permission-gated. 0.3.2: migrations for `approval_mode`, `deny_tools`, `ask_tools` + rebuilt MCP page. 0.6.0: `rmcp` 3.7.0 replaces the hand-rolled client; stdio, Streamable HTTP and legacy `sse`; bearer tokens; OAuth 2.1 with RFC 9728 discovery, DCR, PKCE S256, a `127.0.0.1` loopback callback, refresh and local disconnect; tokens live in Windows Credential Manager (chunked when oversized), never SQLite, JS or logs; migration 30 adds `auth_type` default `none`; auth states are not checked, connecting, waiting for browser, connected, authorization required, expired and failed; non-text tool results are described, `notifications/tools/list_changed` re-lists after five minutes, a handshake has a 20-second deadline and the protocol negotiates down. 0.6.1: legacy SSE session eviction, unique request ids, bounded framing, same-origin bearer endpoints, and Windows `.cmd` shim/PATH/`CREATE_NO_WINDOW` launch with a 60-second cold start. 0.7.0: migration 31 adds structured command/args/cwd/env/URL/headers/timeout config while old rows stay readable; standard `mcpServers` import/export with imported servers disabled until enabled; `${secret:name}` env/header refs owned in Windows Credential Manager; custom header values are write-only and export blanks secret-like values and refs; Windows Job Object child lifetime; bounded and redacted stderr logs; tool-definition hashes mark changed servers `needs_review` until approved; advanced settings, import/export and per-server logs. Protocol refresh, a Rust-owned state machine and the details/composer surfaces are 0.8.0 - see `docs/plan/v0.7.0-mcp-computer-use.md`)
- **Ref:** † OpenCode and Claude Code both support MCP servers and skills (`SKILL.md`).
- **Build:** Not before D4 and D5 are proven. Skills first (read a markdown file into context on demand), MCP second, every MCP tool going through the permission engine.
- **Not:** MCP server mode, enterprise SSO or device flow, pre-registered OAuth client fields, a hosted CIMD document, custom-scheme callbacks, server-side revocation, per-tool OAuth scopes, and non-Windows platforms. Disconnect clears the local credential only.
- **Done:** An MCP tool cannot run without passing D4.

## J13. Windows computer use
- **Status:** Have (0.7.0: bundled `computer-use` stdio MCP server, disabled by default; observe tools `list_apps`, `list_windows`, `get_state`, `screenshot`; actions `invoke`, `click`, `type_text`, `set_value`, `press_keys`, `scroll`, `drag`, `wait`, `focus_window`, `launch_app`, `read_clipboard`, `write_clipboard`; per-app `View`/`Interact`/`Full` allowlist, hard denies, user deny rules, global kill-switch hotkey, pause that stops observation and actions, optional always-on-top overlay, action budget, dry-run, before/after audit thumbnails and confirmations; input is checked against the focused process and click point, and Win-key/Alt-Tab shell escapes are denied. 0.8.0: hardening/eval, publisher verification and yield-to-user. Plan: `docs/plan/v0.7.0-mcp-computer-use.md`)
- **Ref:** Codex/Claude computer use, Windows-MCP, and the Rust UIA/capture/input ecosystem. Research date 2026-10-27; verify crate and API details before starting.
- **Build:** A Rust stdio MCP server bundled with the app and spawned by the MCP manager. UI Automation tree first, screenshots for canvas/Chromium/Electron surfaces; observe tools first, then semantic actions; per-app approval by executable path or process name, `View`/`Interact`/`Full` tiers, hard denies, kill switch, always-on control indicator, audit and dry-run. Windows-only, no elevated agent, no raw shell.
- **Done:** The agent can observe and act inside approved apps, and every mutating action is audited, budgeted, pausable and dry-runnable. The scripted eval set and yield-to-user pause are 0.8.0.

## J14. Local navigator
- **Status:** Planned (0.8.0 experiment; ship only if the benchmark gates pass. Plan: `docs/plan/v0.7.0-mcp-computer-use.md`)
- **Ref:** Research 2026-10-27/28, jevos-v5 and the local navigator doc. Verify the Windows binary, `/v1/systemone` shape and CPU timings before building.
- **Build:** Optional tier-2 verifier for computer use. The cloud planner plans; Rust name/role matching is tier 1; `jev.exe` OpenVINO INT8 answers one yes/no question per top candidate; the cloud model is tier 3. Act only on calibrated best `>= 0.80` with runner-up `< 0.50`. Spawn as a sidecar with `CREATE_NO_WINDOW`, Job Object, random localhost port and API key, idle stop and below-normal priority. Shadow mode first, off by default, no local vision. Settings: toggle, status, disk size, delete model, benchmark and audit columns.
- **Done:** On the target laptop, p50 `<= 3 s` plugged in / `<= 5 s` on battery, `>= 90%` top-1 on calibrated `p >= 0.80`, `>= 60%` of steps without the cloud, and no bypass of app tiers, hard denies or approval.

# I. Skipped for now

Each is real work with large overhead. Revisit only after phases in `later.md` are done.

| ID | Feature | Why skip |
|---|---|---|
| I1 | Anthropic-native wire | OpenRouter's OpenAI-compatible API covers it |
| I2 | Image generation | Not core to an agent |
| I3 | Voice in and out | Not core |
| I4 | Knowledge / RAG | Large; Projects plus file tools cover most needs |
| I5 | MCP servers | Moved to J12, after D4 is proven |
| I6 | Hooks, plugins | Skills moved to J12; hooks and plugins stay skipped |
| I7 | Sharing, multi-user | Single-user desktop app |
| I8 | Code execution sandbox | Moved to D22, v0.4.0 S1 |
