# myagent

A Windows-only desktop chat client with bring-your-own-key (BYOK) providers.

Point it at OpenRouter or any OpenAI-compatible endpoint, paste your key, and chat
with streaming responses. Your key lives in the Windows Credential Manager and
never reaches the web UI; your chats live in a local SQLite file. There is no
backend, no account, and no telemetry.

---

## How it works

```
React UI (webview)                Rust core (src-tauri)
  │  invoke("chat_stream") ──────▶  llm.rs   ─ HTTPS/SSE to your provider
  │  ◀── streamed deltas ─────────  vault.rs ─ key from Credential Manager
  └  tauri-plugin-sql ───────────▶  sqlite:myagent.db (local)
```

The renderer sends a `connection_id`; Rust looks up the key and attaches it. The
key is never returned to JavaScript.

---

## Features

- **BYOK connections** — OpenRouter or a custom OpenAI-compatible base URL, with a
  per-connection API key stored in the Credential Manager.
- **Streaming chat** — token-by-token responses with a working Stop.
- **Local history** — conversations and messages persist in SQLite.
- **Artifacts** — fenced code blocks open in a side panel with copy.
- **Projects** — group chats and give them shared description and instructions.
- **Memory** — durable notes that are sent with your chats, globally or scoped to
  a project; save an assistant reply with one click.

Memory and project context are assembled into a bounded system message on every
send (max 24 notes, 6000 characters). Nothing is injected when there is no
context.

---

## Requirements

- Windows 10/11
- Node.js 20+ and npm
- Rust (stable) with the MSVC toolchain
- WebView2 runtime (preinstalled on Windows 11; the installer bootstraps it)

---

## Develop

```bash
npm install
npm run tauri dev
```

## Build the installer

```bash
npm run tauri build   # NSIS installer in src-tauri/target/release/bundle/nsis
```

## Checks

```bash
npx tsc --noEmit
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
fallow dead-code
```

---

## Usage

1. Open **Settings** (footer of the sidebar) and add a connection: pick
   OpenRouter or Custom, set the base URL, then **Store** an API key.
2. Pick a model in the top bar. **Refresh** re-fetches the model list.
3. Chat. Assistant replies can be opened as artifacts or saved with **Remember**.

### Projects

Create a project from the sidebar (`+`). A project has a description, standing
instructions, and its own memory. New chats started while a project is selected
belong to it. Deleting a project keeps its chats (detached) and removes its
memory.

### Memory

- **Global memory** (sidebar footer) applies to every chat.
- **Project memory** lives inside the project dialog.
- Use **Remember** on a reply to save it to the currently active scope.

---

## Releasing

Tag a version to build and publish a draft release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `release` workflow builds the NSIS installer on `windows-latest` and drafts a
GitHub Release with the artifact attached.

---

## Project docs

- `PRODUCT.md` — product truth
- `DESIGN.md` — the visual system ("The Local Vault")
- `PHASES.md` — the memory & projects roadmap
- `AGENTS.md` — contribution rules and the review gate
- `docs/references/` — architecture, code standards, workflow, design system
