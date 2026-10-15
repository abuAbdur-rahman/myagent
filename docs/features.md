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
- **Status:** Partial (stops only between steps)
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
- **Status:** Missing
- **Ref:** † OpenRouter: pre-stream errors are normal HTTP errors; mid-stream errors arrive as SSE with HTTP 200. Claude Code and OpenCode retry transient failures.
- **Build:** Retry only on 429, 5xx and network errors, and only if no token was received. Exponential backoff with jitter, max 3 attempts, honor `Retry-After`. Show "Retrying (2/3)" in the UI.
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
- **Status:** Unknown
- **Ref:** All three render markdown for both sides. OpenWebUI and Claude store raw text and render on display.
- **Build:** Store raw markdown only. One renderer for both roles (`react-markdown`, `remark-gfm`, `remark-breaks`). No raw HTML. Links get `rel="noopener noreferrer"` and open externally. Throttle re-render during streaming.
- **Done:** The same markdown string renders identically for user and assistant bubbles.

## A10. Code blocks in messages
- **Status:** Unknown
- **Ref:** Claude and OpenWebUI: language label, copy button, syntax highlighting; OpenWebUI also allows editable code blocks.
- **Build:** Header with language and Copy; monospace; horizontal scroll; highlight lazily after streaming finishes. Copy copies raw text only.
- **Not:** Editable code blocks, run buttons.
- **Done:** Copy output equals the fenced source exactly.

## A11. Composer (input)
- **Status:** Partial (fixes in progress)
- **Ref:** Claude Code: multiline input, history with Up arrow, Esc Esc for rewind. Claude app: rich input with shortcuts.
- **Build:** Rich-text editor serializing to markdown. Single focus ring on the container. Clear immediately on send. History on ArrowUp at doc start, ArrowDown at doc end. Lists continue with Shift+Enter. "```lang" plus Space or Shift+Enter makes a code block. Enter sends outside code blocks.
- **Done:** The acceptance list from the composer spec passes.

## A12. Message actions
- **Status:** Have (destructive edit)
- **Ref:** † OpenWebUI edits and regenerates by adding branches; Claude shows `< 2/3 >` version switchers.
- **Build:** Copy, Regenerate, Edit (user messages). Edit and Regenerate create new branches (see B2). Delete only on explicit confirm.
- **Done:** Edit never removes the old version.

## A13. Auto titles
- **Status:** Have (0.1.5: placeholder first, AI title with default-model fallback)
- **Ref:** † OpenWebUI generates titles (and tags) with a task model, without bumping the chat's activity time.
- **Build:** After the first assistant reply, ask a cheap model for a 3-6 word title. Fall back to the first line of the user message. Never block the UI.
- **Not:** Tags and follow-up suggestions (see B7).
- **Done:** Title appears without delaying the reply; failure keeps the fallback.

---

# B. Conversation data

## B1. Persistence
- **Status:** Have (verify schema)
- **Ref:** OpenWebUI stores chats in a database with per-chat metadata (title, tags, pinned).
- **Build:** SQLite: `chats`, `messages`, `projects`, `memories`, `settings`. Migrations from day one. WAL mode. One writer.
- **Done:** A migration test upgrades an old DB without data loss.

## B2. Message tree (branches)
- **Status:** Missing
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
- **Status:** Have (verify)
- **Ref:** † OpenWebUI sidebar groups by recency, tracks unread state, and does not bump a chat for being auto-titled.
- **Build:** List ordered by last user activity, grouped (Today, Yesterday, Earlier). Rename, delete with confirm. Virtualize if over 200 chats.
- **Not:** Unread dots.
- **Done:** Ordering is stable and tested.

## B4. Search
- **Status:** Partial (0.1.6: FTS5 + sidebar box + filters, no test yet)
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
- **Status:** Partial (0.1.6: markdown + lossless JSON single chat)
- **Ref:** † OpenWebUI exports chats as JSON including the tree, tags and pinned state.
- **Build:** Markdown (readable, active branch only) and JSON (lossless, all branches). Single chat and all chats.
- **Done:** JSON export re-imports to an identical chat.

## B10. Import
- **Status:** Partial (0.1.6: single-chat import, needs round-trip test)
- **Ref:** † OpenWebUI imports its own JSON and can convert other platforms' exports.
- **Build:** Import MyAgents JSON only. Validate schema, generate new ids, never overwrite.
- **Not:** Other platforms' formats.
- **Done:** Round trip with B9 passes.

## B11. Delete data
- **Status:** Partial (0.1.6: delete-everything added, needs filesystem test)
- **Ref:** † OpenWebUI lets you delete one chat or clear all history from settings.
- **Build:** Delete chat (including spill files and attachments for it). "Delete everything" removes DB, attachments, spill files, caches, then confirms. Memory included, with a warning.
- **Done:** A test against the real filesystem finds no leftover files.

---

# C. Models and context

## C1. Provider and API key storage
- **Status:** Partial (0.1.5: OS vault have, key-rejected hint added; live AgentRouter key rejected — rotate it)
- **Ref:** Claude Code and OpenCode read keys from config or environment; desktop apps use the OS keychain.
- **Build:** Store the key in the OS credential store (Windows Credential Manager), never in plain JSON or localStorage. Base URL configurable (OpenRouter default). "Test connection" button.
- **Done:** The key never appears in logs or exports.

## C2. Model picker
- **Status:** Have
- **Ref:** All three have a per-chat model selector.
- **Build:** Dropdown showing provider and model, remembering the last choice per chat, with a recent-models list.
- **Done:** Switching mid-chat applies to the next turn only.

## C3. Model catalogue and capabilities
- **Status:** Have (0.1.7: Rust-side fetch, 24h TTL cache, caps per model)
- **Ref:** † OpenRouter's models list includes context length and supported parameters.
- **Build:** Fetch, cache with a TTL, and read: context length, supports reasoning, supports tools. Disable UI that a model cannot use. Fall back to safe defaults when unknown.
- **Done:** A model without tool support never gets tools in its request.

## C4. Reasoning effort control
- **Status:** Have (0.1.7: caps-gated selector, mixed param shape, Rust re-gate)
- **Ref:** † OpenRouter accepts a `reasoning` request parameter with effort. Claude Code has effort levels and a thinking toggle.
- **Build:** Selector (off, minimal, low, medium, high) shown only for reasoning-capable models (C3). Maps to the provider parameter.
- **Done:** The request body contains the parameter only when supported.

## C5. Usage and cost
- **Status:** Have (0.1.7: include_usage on streams, fallback chain, tokens-only footer)
- **Ref:** † OpenRouter returns a final usage chunk (prompt and completion tokens).
- **Build:** Store real usage per assistant message. Footer shows tokens for the chat. Cost only if the catalogue has prices. Fall back to chars/4 labelled "estimate".
- **Done:** Usage from the fixture is stored and displayed.

## C6. Context meter
- **Status:** Have (0.1.7: stored usage + catalogue limit, warn at 80%, limit-estimated flag)
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

---

# D. Tools and agent loop

## D1. Tool-call loop
- **Status:** Have (0.1.5: mid-loop text retracted, identical pure calls collapsed)
- **Ref:** † OpenCode and Claude Code: call the model, run its tool calls, return results, repeat until a final answer.
- **Build:** Loop with a step cap (D3). Each tool call is stored as a message part with input, output, status, duration.
- **Done:** A two-tool turn completes with both results visible.

## D2. Streaming tool loop
- **Status:** Missing
- **Ref:** † Stream tool-call arguments as deltas keyed by `index`; assemble before executing.
- **Build:** Accumulate `ToolCallDelta` events (A3) into complete calls; execute after the finish reason `tool_calls`. Show "running" state in the UI as soon as the name arrives.
- **Done:** Split argument fixtures assemble into valid JSON.

## D3. Step cap and doom-loop guard
- **Status:** Missing
- **Ref:** † OpenCode has a `doom_loop` permission that asks before repeating identical calls.
- **Build:** Max steps per turn (for example 25). If the same tool with the same arguments repeats 3 times, stop and ask the user.
- **Done:** A looping mock model is halted.

## D4. Permission engine
- **Status:** Have (0.1.3: `permissions.rs` decide + SQLite always-rules, rules UI pending)
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
- **Build:** Three modes in one setting: Ask (default), Accept edits (auto-allow file edits only, shell still asks), Plan (only read tools exposed). A mode badge near the composer.
- **Not:** Fully-automatic "yolo" mode.
- **Done:** In Plan mode, write and shell tools are not even sent to the model.

## D7. Shell tool
- **Status:** Partial (0.1.3: approval + per-segment rules + kill-on-stop; cwd still home, not project)
- **Ref:** † OpenCode parses bash with tree-sitter to apply per-command rules. Claude Code asks per command pattern.
- **Build:** `run_powershell` goes through D4 and D5. Timeout (default 60s), working directory fixed to the project, output captured and capped (D13), kill process tree on stop. Parse the command into segments (`;`, `&&`, `|`) and evaluate each, so `ls; rm x` cannot hide behind an allowed `ls`.
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
- **Not:** Git integration, tracking shell-made changes.
- **Done:** Undo restores bytes exactly.

## D13. Output cap and spill files
- **Status:** Partial (32KB then lost)
- **Ref:** † Tools cap output sent to the model; OpenCode and Claude Code let the model re-read slices.
- **Build:** Cap at about 32KB. Write the full output to `spill/<chat>/<id>.txt` and append "[truncated, full output at path]". The model reads it with D8. Delete with the chat (B11).
- **Done:** Large output is capped in context but fully recoverable.

## D14. Web fetch
- **Status:** Have (0.2.0: `web_fetch`, https-only, SSRF guard + redirect re-check, htmd conversion, audit rows)
- **Ref:** † OpenCode `webfetch` reads web pages; default permission is allow in some setups, ask in safer templates.
- **Build:** Default ask. HTTP(S) only, block private, loopback and link-local addresses, resolve DNS before connecting and re-check after redirects (SSRF). Convert HTML to text, cap size, 15s timeout.
- **Done:** Requests to localhost and 169.254.x.x are rejected.

## D15. Web search
- **Status:** Have (0.2.0: `web_search`, Tavily default + SearXNG endpoint, key in vault, Settings/onboarding)
- **Ref:** OpenCode has a `websearch` permission; OpenRouter offers web search plugins.
- **Build:** One provider behind one tool; default ask; returns titles, URLs, snippets. Needs a key. Not before D14.
- **Done:** Results render as links the model can fetch.

## D16. Question tool
- **Status:** Have (0.1.3: `ask_user` tool, loop-awaited card with options + custom text)
- **Ref:** † OpenCode's `question` tool shows a header, question and options (with a custom answer) and waits.
- **Build:** Tool with `question`, `options[]`; the loop pauses, the UI shows buttons plus free text, the answer returns as the tool result.
- **Done:** The loop resumes with the chosen answer.

## D17. Todo list tool
- **Status:** Have (0.2.0: `todo_write`/`todo_set`, per-chat in DB, sticky checklist)
- **Ref:** † OpenCode `todowrite` and `todoread`; OpenWebUI has task management in chat for multi-step work.
- **Build:** Tool that replaces a list of `{text, status}`. Rendered as a sticky checklist above the composer. Per chat, stored in the DB.
- **Done:** The model updates the list and the UI reflects it.

## D18. Subagents
- **Status:** Missing
- **Ref:** † Claude Code and OpenCode delegate subtasks to separate agents with their own context.
- **Build:** Skip. Revisit only after D1-D17 are solid.
- **Done:** n/a.

---

# E. Memory and instructions

## E1. Global memory
- **Status:** Partial
- **Ref:** Claude app memory; † Claude Code `/memory` edits memory files and auto-memory. † OpenWebUI injects only retrieved memories per turn (`add_memory_context`).
- **Build:** A list of short facts the user can view, edit and delete. Per turn, retrieve by the current user text (keyword match, top-k), char-cap the block, and replace the previous turn's block — never dump all memories. Unrelated memories must not reach the model.
- **Not:** Sending every memory every turn.
- **Done:** A test sends an unrelated memory plus a matching one; only the matching one is in the prompt.

## E2. Secret refusal in memory
- **Status:** Missing
- **Ref:** Claude does not store credentials in memory.
- **Build:** Pure function `looks_secret(&str) -> bool`: API key shapes (`sk-`, `ghp_`, `AKIA`, long hex/base64), private key headers, `password=`, `token=`, `Bearer`. Runs before every memory write; tell the user when blocked. Panic-free.
- **Not:** Entropy scanning of all chat.
- **Done:** A 15+ row table test passes.

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
- **Status:** Unknown
- **Ref:** † OpenWebUI sets system prompt and parameters at chat, account or model level.
- **Build:** Global default, per-project override, per-chat override of the system prompt. Temperature only if needed.
- **Done:** Override order is tested.

## E6. Auto memory (agent-written)
- **Status:** Missing
- **Ref:** † Claude Code writes its own notes per project and lets users audit them.
- **Build:** The model may write memory only for durable bio, preferences, or an explicit "remember this". Thread summary stays primary and private; durable project points roll up from the thread into shared project memory on close, on explicit ask, or about every 10 turns — 1-5 bullets, facts only, never transcript quotes. Everything else stays in chat history. Enforce in the `remember` tool description plus the system prompt. Every write gated by E2. Every saved note visible and deletable.
- **Not:** Writing memory every turn, or silently.
- **Done:** Test asserts the tool rules, E2 blocks secrets, roll-up carries decisions with no private detail, and no auto-write path exists.

---

# F. Rendering and files

## F1. Artifact drawer
- **Status:** Partial (preview exists)
- **Ref:** † OpenWebUI renders web content and SVGs in the interface with live updates. Claude shows artifacts in a side panel with Preview and Code tabs.
- **Build:** Side drawer: Preview and Code tabs, Copy, Download, version list from regenerations. Triggered by a fenced block with an artifact marker.
- **Done:** Regenerating adds a version instead of replacing.

## F2. Artifact isolation
- **Status:** Missing (iframe can reach IPC)
- **Ref:** † OpenWebUI renders in an iframe with an injected CSP. † Tauri's Isolation pattern guards the IPC channel from untrusted frontend code but does not sandbox artifact HTML.
- **Build:** `<iframe sandbox="allow-scripts" srcdoc=...>` without `allow-same-origin` (opaque origin: no parent, storage or IPC access). Strict CSP meta in the artifact: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`. No Tauri capabilities for it. Parent talks to it via `postMessage` with validated shapes. External links opened by the host through a checked handler. Consider Tauri's Isolation pattern for the main window as extra hardening.
- **Not:** Per-artifact origins, artifact storage.
- **Done:** A test artifact that calls `parent`, `localStorage` and `invoke` fails on all three.

## F3. Attachments and project knowledge
- **Status:** Missing
- **Ref:** Claude app Projects hold knowledge files every chat inherits; OpenWebUI accepts files in the composer.
- **Build:** Two paths, one storage: composer attachments plus a project knowledge panel (text notes plus stored docs such as PDF). Files copied into the project docs folder, deduped by hash, shown as chips. Capped text excerpts injected into context; full file re-read waits for the file tools in v2. Size limit. No code execution.
- **Not:** OCR, full binary parsing.
- **Done:** Text excerpt of an attached project doc reaches the next turn's context.

## F4. Image input (vision)
- **Status:** Missing
- **Ref:** Claude and OpenWebUI accept pasted images for vision models.
- **Build:** Paste or attach, downscale to a max edge, send as a content part only if the model supports it (C3).
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
- **Status:** Unknown
- **Ref:** † Claude Code `/config`; OpenWebUI has settings per account.
- **Build:** Sections: Provider (C1), Models, Permissions (D4 rules list), Memory, Data (B9-B11), Appearance. One JSON file backs it.
- **Done:** Settings persist and reload.

## G4. Theme
- **Status:** Unknown
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

---

# H. Quality

## H1. Test harness
- **Status:** Missing (zero test files)
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
- **Status:** Missing
- **Build:** An append-only table of tool calls, approvals, denials and "always allow" rule changes with timestamp, chat and exact command. Searchable list in settings; included in delete-all (B11).
- **Done:** Every approval creates exactly one log row.

## J9. Prompt and command files
- **Status:** Missing
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
- **Status:** Missing
- **Ref:** † OpenCode and Claude Code both support MCP servers and skills (`SKILL.md`).
- **Build:** Not before D4 and D5 are proven. Skills first (read a markdown file into context on demand), MCP second, every MCP tool going through the permission engine.
- **Done:** An MCP tool cannot run without passing D4.

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
| I8 | Code execution sandbox | Shell tool (D7) covers it |
