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
| `src-tauri/src/llm.rs` | `list_models`, `chat_stream`, `cancel_stream`; SSE parsing |
| `src-tauri/src/vault.rs` | Credential Manager set/get/has/delete by connection id |
| `src-tauri/src/state.rs` | Per-request cancel tokens, cleaned up on completion |
| `src-tauri/src/error.rs` | `AppError` enum (Vault / Network / Upstream / Internal) |
| `src/lib/store.tsx` | App state, send/stop, persistence orchestration |
| `src/lib/db.ts` | SQLite access layer (connections, conversations, messages) |
| `src/lib/api.ts` | Typed `invoke` wrappers |
| `src/lib/types.ts` | Zod schemas + inferred types |

## Database schema (`sqlite:myagent.db`)

```sql
connections(id PK, name, base_url, kind, default_model, created_at)
conversations(id PK, title, connection_id, model, created_at, updated_at)
messages(id PK, conversation_id FK→conversations, role, content, created_at)
-- index: messages(conversation_id, created_at)
```

Secrets are **not** in the database. The `connections` row holds only metadata;
the key lives in the Credential Manager under service `com.abdul.myagent` and the
connection's `id` as the account name.

## Invariants

- A key never appears in the DB, in the renderer, or in logs.
- The assistant message row is created (empty) before streaming so the final
  update is never a no-op.
- Cancellation is cooperative and cleaned up; the registry does not grow.
- All frontend state that cross-checks the DB treats the DB as truth on read.

## Not yet built (product-required)

- **Memory** — durable cross-chat context.
- **Projects** — grouping work with shared context.

Both are recorded in `PRODUCT.md`; design for them, do not scaffold speculatively.
