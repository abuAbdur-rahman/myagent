# MyAgent

A Windows-only desktop chat client with bring-your-own-key (BYOK) providers.
Point it at OpenRouter, Agent Router, or any OpenAI-compatible endpoint, paste
your key, and chat with streaming responses. Your key lives in the Windows
Credential Manager and never reaches the web UI; your chats live in a local
SQLite file. No backend, no account, no telemetry.

![release](https://img.shields.io/github/v/release/abuAbdur-rahman/myagent)
![license](https://img.shields.io/github/license/abuAbdur-rahman/myagent)
![platform](https://img.shields.io/badge/platform-Windows-blue)
![ci](https://img.shields.io/github/actions/workflow/status/abuAbdur-rahman/myagent/ci.yml?label=ci)

## Stack

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Lexical](https://img.shields.io/badge/Lexical_editor-000000?logo=meta&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67DF?logo=zod&logoColor=white)

## Screenshots

| Chat | Welcome |
| ---- | ------- |
| ![MyAgent chat with tool calls](docs/images/chat.png) | ![MyAgent welcome screen](docs/images/welcome.png) |

## Features

- **BYOK connections** — OpenRouter, Agent Router, or a custom
  OpenAI-compatible base URL, with a per-connection API key stored in the
  Windows Credential Manager. Keys never cross into the renderer.
- **Rich-text composer** — Lexical-powered input with live Markdown formatting
  (bold, italic, lists, code blocks, quotes), keyboard shortcuts, and a token
  counter.
- **Streaming chat** — token-by-token responses with a working Stop.
- **Reasoning control** — per-model effort selector driven by the OpenRouter
  catalog, sent as `reasoning.effort`.
- **Model visibility** — hide noisy models per provider; pickers only show
  what you keep.
- **Local history** — conversations and messages persist in SQLite, with pins,
  branching, search, and AI titles.
- **Artifacts** — fenced HTML blocks open in a side panel with tabs and download.
- **Projects** — group chats with shared description, instructions, and memory.
- **Memory** — durable notes injected as bounded context, globally or per
  project; save any reply with one click.
- **Agent tools** — the model can check the time, save/search memories, run
  PowerShell commands, and open titled artifacts. Every call is shown inline.
- **In-app updates** — signed releases with automatic checks from About.

## How it works

```
React UI (webview)                Rust core (src-tauri)
  │  invoke("chat_stream") ──────▶  llm.rs   ─ HTTPS/SSE to your provider
  │  ◀── streamed deltas ─────────  vault.rs ─ key from Credential Manager
  └  tauri-plugin-sql ───────────▶  sqlite:myagent.db (local)
```

The renderer sends a `connection_id`; Rust looks up the key and attaches it.
The key is never returned to JavaScript. External input is validated with Zod
at the boundary.

## Requirements

- Windows 10/11
- Node.js 20+ and npm
- Rust (stable) with the MSVC toolchain
- WebView2 runtime (preinstalled on Windows 11; the installer bootstraps it)

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

Run everything before saying "done":

```bash
npx tsc --noEmit
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
fallow dead-code
```

## Usage

1. Open **Settings** (footer of the sidebar) and add a connection: pick a
   provider preset or Custom, set the base URL, then **Store** an API key.
2. Pick a model from the model chip. **Refresh** re-fetches the model list.
3. Chat. Use the effort selector for reasoning models, **Remember** to save a
   reply, **Compact** when context runs high.

### Projects

Create a project from the sidebar (`+`). A project has a description, standing
instructions, and its own memory. New chats started while a project is selected
belong to it. Deleting a project keeps its chats (detached) and removes its
memory.

### Memory

- **Global memory** (sidebar footer) applies to every chat.
- **Project memory** lives inside the project dialog.
- Use **Remember** on a reply to save it to the currently active scope.

## Releasing

Tag a version to build and publish a release:

```bash
git tag v0.1.3
git push origin v0.1.3
```

The `release` workflow builds the signed NSIS installer on `windows-latest`,
emits `latest.json`, and publishes a GitHub Release with the artifacts
attached. The app checks that channel from About → Updates (and once quietly
on launch); signing keys live only in the `TAURI_SIGNING_PRIVATE_KEY` repo
secret.

## Contributing

`main` is locked to the maintainer. Please open an issue first for anything
bigger than a typo, then a pull request from a feature branch. Follow
`AGENTS.md` (no `any`, Zod at the boundary, no `console.log`, every `catch`
logs or rethrows) and keep `npm run build` + `cargo clippy` clean.

## Project docs

- `PRODUCT.md` — product truth
- `DESIGN.md` — the visual system ("The Local Vault")
- `PHASES.md` — the memory & projects roadmap
- `AGENTS.md` — contribution rules and the review gate
- `docs/references/` — architecture, code standards, workflow, design system

## License

MIT — see [LICENSE](LICENSE).
