# AGENTS.md — myagent

> Local rules for this repo. Keep this file short; detail lives in `docs/references/`.

Windows-only desktop chat client. Local-first BYOK: the user's API keys live in
the Windows Credential Manager and never reach the webview; a Rust process
proxies OpenAI-compatible streaming to OpenRouter or a custom base URL; chats
persist in local SQLite.

---

## Stack

- **Shell:** Tauri v2 (Rust), NSIS target, Windows only.
- **Frontend:** Vite + React 19 + TypeScript + Tailwind v4 (tokens in `src/index.css`).
- **Backend:** Rust — `src-tauri/src/{lib,llm,vault,state,error}.rs`.
- **Data:** `tauri-plugin-sql`, `sqlite:myagent.db`.
- **Validation:** Zod at the boundary.
- **Design:** see `DESIGN.md` (system of record) and `PRODUCT.md` (product truth).

---

## Commands

```bash
npm run tauri dev        # run the app
npm run tauri build      # NSIS installer
npx tsc --noEmit         # frontend types
npm run build            # tsc + vite build
cargo check --manifest-path src-tauri/Cargo.toml
fallow dead-code         # unused code + dependency hygiene
ocr review -c <sha>      # AI review gate (see Workflow)
```

Run every check before saying "done".

---

## Hard rules

- **Only edit files in scope.** Ask before touching anything else.
- **No `any`.** Use `unknown` + narrowing or generics.
- **Validate external input with Zod** at the boundary. Always.
- **Every `catch` must log, rethrow, or set a typed error.** Never swallow silently.
- **No `console.log`** in committed code.
- **No hardcoded secrets.** Runtime secrets go through `vault.rs` only.
- **Keys never cross into JS.** If a feature would put a key in the renderer, redesign it.
- **No comments** unless asked.
- **Windows-only.** Do not add macOS/Linux/mobile branches.

---

## Where the rules live

| Need | Read |
|---|---|
| Process model, data flow, BYOK, DB schema | [docs/references/architecture.md](docs/references/architecture.md) |
| TS/Rust conventions, errors, security | [docs/references/code-standards.md](docs/references/code-standards.md) |
| Git, commits, the review gate, push policy | [docs/references/workflow.md](docs/references/workflow.md) |
| Visual tokens, components, a11y | [docs/references/design-system.md](docs/references/design-system.md) |

---

## Workflow (short form)

1. `git add .` — always stage everything; never selective staging.
2. Commit: `type(scope): imperative summary` (see workflow.md).
3. **Before every push:** run BOTH gates and fix what they find:
   - `fallow dead-code` (and `fallow audit --base main` on a branch)
   - `ocr review -c <sha>`
4. **Push only when the gates are clean** or only minor/nit findings remain.
5. Never force-push, never commit secrets, never commit `node_modules`/`target`/`dist`.
