# Round 3 — Composer, awareness, tools, identity, release 0.1.1

**Status: T1–T7 shipped. T8 (release 0.1.1) and T9 (in-app updater) remain.**

Follows the UI overhaul. Goal: a composer that behaves like Claude's, a model
that knows the app and can act in it, correct errors, real titles, guarded
context, product identity, and a tagged release.

**Quality bar: ≥70% on every phase. No dead controls. No speculative features.**

## What the screenshots proved

- `232908`: composer focus ring too heavy; model chip truncates with no tooltip.
- `233048`: code rendered monochrome, no copy affordance (pre-rewrite build).
- `234337`: failed sends render `[object Object]` — Tauri error objects are
  stringified, never formatted. No recovery path is offered.

## Phases

### T1 — Errors that read, toasts, draft safety (quick win)
- `formatInvokeError`: string → as-is; `Error` → message; `{Upstream|Network|
  Vault|Internal: string}` → `prefix: detail`; `{message}` → message; else
  truncated `JSON.stringify`. Single home in `lib/api.ts`.
- Every `setError`/`toast` on an invoke path uses it; `console.error` keeps the
  raw value for diagnostics.
- Send clears the draft only on accept; any failure rolls the text back into the
  composer and raises a toast + banner. No silent loss, no `[object Object]`.
- Gate: tsc, build, fallow. Commit, ocr, push.

### T2 — Composer that behaves (Claude parity, researched)
- Focus: keep the accent border, drop the extra ring.
- Smart editing: Enter continues `-`, `1.` (auto-numbered), `>`, and fenced
  blocks; Enter on an empty item removes it; Tab/Shift+Tab indent/outdent;
  keep Ctrl+B/I/E and the fence shortcut.
- History: ArrowUp/Down on an empty composer cycles this session's sent
  messages; any edit resets the cycle.
- Model chip gets a `title` tooltip with the full name.
- Findings from the OpenWebUI + Claude research land here or are recorded as
  rejected with a reason.
- Gate + commit + ocr + push.

### T3 — The model knows the app (prompt awareness)
- `buildSystemPrompt` gains a stable identity block: what MyAgent is, that keys
  and chats never leave the machine, and the exact conventions it must follow
  (memory kinds, fenced code, **HTML-only artifacts**, compact is client-side).
- No behavior change when there is no context: still `null`.
- Gate + commit + ocr + push.

### T4 — Titles from the model, guarded context
- After the first assistant reply completes, one background non-streaming call
  asks for a ≤6-word plain-text title; applied only while the title is still
  "New chat". Failure is silent (keep the user-text title).
- Pre-send: if estimated context (messages + system) exceeds 80% of the
  budget, force the compact window for that request and toast why.
- Gate + commit + ocr + push.

### T5 — Code blocks vs artifacts
- Only ```html fences become artifacts (numbered `1 · html`, capped row with
  `+N more` expanding inline). Every other fence is code: header + Copy +
  highlight, never an artifact button.
- Verify highlight colors against the surface; adjust the shiki theme only if
  still unreadable. Visual proof required (dev screenshot).
- Gate + commit + ocr + push.

### T6 — Identity and logo
- Display rename `myagent` → `MyAgent`: title bar, welcome, composer
  placeholder/disclaimer, About, README, docs. Crate/npm identifiers stay
  lowercase.
- Design a simple SVG mark (spark on clay rounded square), favicon, and full
  Tauri icon set via the project's own `tauri icon` command.
- Gate + commit + ocr + push.

### T7 — Real tool calling (agentic loop)
- Rust owns tool specs. `chat_stream` gains `enable_tools` + `max_iterations`
  (default 8) and an optional `project_id` for scoped memory writes.
- Round structure: non-streaming tool rounds first, then one streaming final
  answer. New channel events: `tool_start {id, name, summary}` and
  `tool_result {id, ok, preview}`; the UI renders them as inline collapsible
  rows under the pending reply.
- Tools: `get_time`, `remember`, `recall_memory` (LIKE search over all
  memories), `run_powershell` (timeout 60s, 32KB output cap, non-interactive,
  no profile), `save_artifact` (title/lang/code → panel event).
- Memory writes from tools go through a direct SQLite connection with a busy
  timeout; document the two-writer arrangement and its limits.
- Frontend sends `tools: [...]` only when the provider is OpenAI-compatible;
  failures degrade to a plain completion, never a dead chat.
- No destructive guardrails beyond scope honesty: this is a solo local user
  running their own machine; every tool call is shown inline as it runs.
- Gate (tsc, build, fmt, clippy, fallow, ocr) + commit + push.

### T8 — Release 0.1.1
- Bump `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` to 0.1.1.
- Full gate green, tag `v0.1.1`, push tag, watch the release workflow to a
  draft with the NSIS asset attached.

### T9 — Update from inside the app
- Wire `tauri-plugin-updater` (Rust + JS): About → "Check for updates" with
  real progress, install, and relaunch; silent background check on launch
  with a toast only when an update is ready.
- Release workflow emits `latest.json` (`updaterJson`) and signs artifacts;
  private key lives only as a GitHub secret (`TAURI_SIGNING_PRIVATE_KEY`).
- **Known constraint:** GitHub release assets on a *private* repo need auth
  the shipped app must not carry. The updater activates when releases are
  publicly reachable; until then the check reports the channel state
  honestly instead of failing cryptically. Repo visibility is a user
  decision (asked at implementation time).

## Open research questions (agents running)

- RQ1 (OpenWebUI): composer history/drafts/paste/token-count, error surfaces,
  title generation, context trimming. → feeds T2.
- RQ2 (Claude ASAR): composer textarea behaviors, slash/shortcut literals,
  tool-use UI strings, system-prompt fragments. → feeds T2/T3.
- Tool-loop shape is owned by this doc; agent C validates against
  OpenAI-compatible function-calling reality (OpenRouter quirks included).

## Explicitly out of scope

- Skills as executable packs (documented as future; the tool set is fixed).
- `compact` as a model-invoked tool (it stays a client-side send window).
- Feedback thumbs, voice, multi-window, auto-update.
