# Architecture

## Process model

```
Renderer (webview)                     Rust core (src-tauri)
────────────────────                   ─────────────────────
React UI / Zustand-free context        tauri::Builder
  │ invoke("chat_stream", Channel)       ├─ llm.rs   ─ HTTP + SSE proxy
  ├─────────────────────────────────────▶│
  │  Channel<StreamEvent> deltas          │  reqwest::Client (managed, timeouts)
  │◀─────────────────────────────────────┤
  │                                       ├─ vault.rs ─ Windows Credential Manager
  │  never sees the API key               └─ state.rs ─ cancellation registry
  │
  └─ tauri-plugin-sql ──▶ sqlite:myagent.db (local file)
```

The renderer never receives an API key. It sends a `connection_id`; Rust looks the
key up in the Credential Manager and attaches it to the outbound request.

## Request flow (chat)

1. UI calls `chat_stream` with `{ request_id, base_url, connection_id, model, messages }`
   and a `Channel` for events.
2. `llm::chat_stream` resolves the key, registers a cancel token, then streams.
3. SSE lines are assembled from raw bytes (never per-chunk string decode) and
   emitted as `{ type: "delta", text }`; `{ type: "done" }` terminates.
4. Failures return `Err(AppError)`; the frontend surfaces them in the error banner
   and persists whatever partial text arrived.
5. `cancel_stream` fires a `Notify`; the stream select-loop returns immediately.

## Module map

| File | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | Builder, SQLite migrations, managed `reqwest::Client` + `StreamState` |
| `src-tauri/src/llm.rs` | `list_models`, `chat_stream`, `cancel_stream`, `suggest_title`; SSE parsing; the agentic tool loop |
| `src-tauri/src/tools.rs` | Tool specs, executors, SQLite access for memory tools |
| `src-tauri/src/vault.rs` | Credential Manager set/get/has/delete by connection id |
| `src-tauri/src/state.rs` | Per-request cancel tokens, cleaned up on completion |
| `src-tauri/src/error.rs` | `AppError` enum (Vault / Network / Upstream / Internal) |
| `src/lib/store.tsx` | App state, send/stop, persistence orchestration |
| `src/lib/context.ts` | `buildSystemPrompt` — bounded global + project context |
| `src/lib/db.ts` | SQLite access layer (connections, conversations, messages, projects, memories) |
| `src/lib/api.ts` | Typed `invoke` wrappers |
| `src/lib/types.ts` | Zod schemas + inferred types |

## Context assembly

Before each send, `buildSystemPrompt` assembles a single leading system message
from global memory, the active project's description/instructions, and project
memory. It is bounded (`MAX_MEMORIES` 24, `MAX_CHARS` 6000) and returns `null`
when there is nothing to add, so a context-free request is identical to the
baseline. The injected message is sent to the provider but never written to the
`messages` table.

## Database schema (`sqlite:myagent.db`)

```sql
connections(id PK, name, base_url, kind, default_model, created_at)
conversations(id PK, title, connection_id, project_id, model, created_at, updated_at)
messages(id PK, conversation_id FK→conversations, role, content, created_at)
projects(id PK, name, description, instructions, created_at, updated_at)
memories(id PK, scope, project_id, kind, content, created_at, updated_at)
-- indexes: messages(conversation_id, created_at), memories(scope, project_id)
```

Secrets are **not** in the database. The `connections` row holds only metadata;
the key lives in the Credential Manager under service `com.abdul.myagent` and the
connection's `id` as the account name.

## Invariants

- A key never appears in the DB, in the renderer, or in logs.
- The assistant message row is created (empty) before streaming so the final
  update is never a no-op.
- Cancellation is cooperative and cleaned up; the registry does not grow.
- The injected system message is derived at send time and never persisted.
- All frontend state that cross-checks the DB treats the DB as truth on read.
- Every tool call is shown inline as it runs; nothing executes silently.

## Acting through tools

`chat_stream` runs an agentic loop when the request enables tools (the UI always
does). Each round is a non-streaming completion with the tool specs; `tool_calls`
are executed in Rust, appended as `tool` messages, and the loop repeats (max 8
rounds) before one final streamed answer. If the provider rejects the `tools`
parameter, the request degrades once to a plain streaming completion.

| Tool | What it does | Limits |
|---|---|---|
| `get_time` | Current UTC time + Unix timestamp | — |
| `remember` | Writes a memory (global or current project) | 2000 chars; project scope needs an active project |
| `recall_memory` | Keyword search over global + project memories, each line prefixed with the row id | 20 results max |
| `update_memory` | Rewrites one memory by id (content, kind, or both) | id must be a UUID visible to this chat, canonicalised before the lookup; 2000 chars |
| `delete_memory` | Deletes one memory by id, after the user approves | id must be a UUID visible to this chat, canonicalised before the lookup; asks every time |
| `run_powershell` | Runs a non-interactive command, returns output | 60s default timeout (5–300s), 32KB output cap, home directory |
| `save_artifact` | Opens a titled code artifact in the side panel | 120-char title, 200KB code cap |

Memory tools open the same SQLite file through a direct connection with a busy
timeout, alongside the `tauri-plugin-sql` pool. Both writers are local and the
volume is tiny; a busy database surfaces as a tool error, never corruption.

New channel events: `tool_start {id, name, summary}`, `tool_result
{id, ok, preview}`, `artifact {title, lang, code}`. The frontend writes the
running log onto the assistant message as those events arrive and renders it from
`message.tool_log` for any reply that used tools, so the list outlives the turn
and survives a reload. Artifact events open in the panel.

## Built

- **Memory** — global and per-project, user-managed.
- **Projects** — group chats with shared instructions and memory.
- **Documents** — files attached to a chat, or to a project as shared context.
  Text is extracted in Rust and stored once under `documents/<sha256>.txt`; both
  a chat and a project row point at that file, and it is deleted when nothing
  points at it any more.

## Not yet built

- Automatic memory extraction from conversations.
