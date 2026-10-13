# PHASES.md — Memory & Projects

Roadmap for the RE build-out. Each phase is independently shippable, gets its own
commit, and passes the review gate (`fallow` + `ocr`) before it is pushed.

**Baseline (shipped):** BYOK connections, streaming chat with cancellation, local
history, artifacts panel, design tokens (`DESIGN.md`).

**Definition of done for every phase:** `tsc --noEmit`, `vite build`,
`cargo fmt --check`, `cargo clippy -D warnings`, `cargo check`, and
`fallow dead-code` are green; `ocr review -c <sha>` has no critical/high/medium
findings; docs updated where behavior changed.

**Commit grouping:** Phases 1–4 land in one feature commit — the data layer added
in Phase 1 has no standalone shippable state (its exports are unused until the
Projects/Memory UI of Phases 2–3 consumes them), so a phase-1-only tree would
fail `fallow dead-code`. Phases 5, 6 and 7 each land separately.

---

## Phase 1 — Data foundation ✅
Goal: schema and typed repositories for projects and memories.

- [x] Migration v2: `projects`, `memories` tables; `conversations.project_id`.
- [x] Zod schemas and inferred types (`Project`, `Memory`, `MemoryScope`, `MemoryKind`).
- [x] `db.ts`: project + memory repositories; project-aware conversation helpers.
- [x] Architecture doc reflects the new tables.

---

## Phase 2 — Projects ✅
Goal: group work under a project with shared context.

- [x] Store: `projects`, `activeProjectId`, CRUD, project-scoped chat list.
- [x] `ProjectDialog`: name, description, instructions, and its memory list.
- [x] Sidebar: project list above chats; "All chats" default; new chats inherit
      the active project.
- [x] Deleting a project detaches its chats and removes its memories.

---

## Phase 3 — Memory ✅
Goal: durable context, global and per-project, fully user-managed.

- [x] `MemoryEditor`: add, edit, delete memories with a kind
      (`fact` | `preference` | `summary` | `note`).
- [x] `MemoryDialog` for global memory; project memory lives in `ProjectDialog`.
- [x] "Remember" action on an assistant message saves it as a memory in the
      current scope.

---

## Phase 4 — Context assembly ✅
Goal: memories and project context reach the model, safely and boundedly.

- [x] `context.ts`: `buildSystemPrompt({ global, project, projectMemories })`.
- [x] Injected as a leading system message on every send; never persisted as a
      chat message.
- [x] Bounded: `MAX_MEMORIES` (24) and `MAX_CHARS` (6000), newest first.
- [x] Returns `null` when there is nothing to inject (no empty system message).

---

## Phase 5 — CI workflow
Goal: every push and PR to `main` is verified automatically.

- [ ] `.github/workflows/ci.yml` on `windows-latest` (Windows-only app).
- [ ] Steps: Node + Rust setup, `npm ci`, `tsc --noEmit`, `vite build`,
      `cargo fmt --check`, `cargo clippy -D warnings`, `cargo check`,
      `fallow dead-code`.
- [ ] Cargo + npm caches.

---

## Phase 6 — Release workflow
Goal: tagging a version produces an NSIS installer and a GitHub Release.

- [ ] `.github/workflows/release.yml` on `v*` tags.
- [ ] `tauri-apps/tauri-action` builds the NSIS bundle and drafts the release.
- [ ] Version is taken from the tag.

---

## Phase 7 — Docs, verification, and the RE close-out
Goal: the repo explains itself and the whole flow is proven.

- [ ] `AGENTS.md` and `docs/references/*` cover memory, projects, and release.
- [ ] `README.md` gives install, BYOK, memory, and project usage.
- [ ] Full local gate green; branch pushed.
