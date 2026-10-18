# MyAgents: Roadmap

IDs match `features.md`. `[x]` = do now. `[ ]` = later.

## Rules (Clauro died from breaking these)

1. One item at a time, in order. Do not start the next until the last is wired into the UI and tested.
2. No test, not done.
3. A phase is finished only when its exit check passes. Do not start the next phase before that.
4. Copy pure logic (parser, retry, secret check), not wiring.
5. Size: S under 1 day, M 1-3 days, L more (split before starting).
6. "Unknown" status means read the code first and update this file.

---

## Now

### v0.3.2: design system pass, MCP migrations, issue fixes

Exit: the Changelog page ships; MCP upgrades from 0.3.1 with no data loss; #10, #13 and #15 are closed.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | G8 | Changelog page (settings, before About) | Have (0.3.2) | S | none |
| [x] | J12 | MCP migrations (`approval_mode`, `deny_tools`, `ask_tools`) + MCP page | Have (0.3.2) | M | D4 |
| [x] | D19 | Tool output controls (code-mode Phase 0) | Have (0.3.2) | M | D13 |
| [x] | — | Issue fixes #10, #13, #15 | Closed (0.3.2) | M | none |

Detail: `docs/releases/v0.3.2.md`. Code-mode Phases 1 and 2 stay in Later.

### v0.3.3: verified stream reliability and agent-loop safety

Exit: the Done lines of A2, A4 and D3 are covered by tests, and the statuses
match the code.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | A2 | Stop / cancel mid-stream | Have (0.3.3 verified) | S | A3 |
| [x] | A4 | Retry with backoff | Have (0.3.3 verified) | S | A3, A7 |
| [x] | D3 | Step cap and doom-loop guard | Have (0.3.3 verified) | S | D1 |
| [x] | — | Roadmap truth pass (`features.md` statuses) | Done (0.3.3) | S | none |

Detail: `docs/releases/v0.3.3.md`. The three items were already in the build;
this release adds the tests their Done lines asked for and corrects the record.
The deferred review debt under Later stays open.

### Phase 1: Foundation
Exit: one command runs green tests on a clean checkout.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | H1 | Test harness | Partial (CI runs the Rust suite only) | S | none |
| [x] | H2 | Recorded fixtures | Missing | S | H1 |
| [x] | A11 | Composer fixes (in progress) | Partial | S | none |

### Phase 2: Stream reliability
Exit: every fixture (plain, reasoning, `length`, mid-stream error, 429) ends in the right UI state.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | A3 | SSE parser | Have (0.1.3) | M | H2 |
| [x] | A5 | Truncation and finish reasons | Have (0.1.3) | S | A3 |
| [x] | A7 | Error UI | Have (0.1.3) | S | A5 |
| [x] | A4 | Retry with backoff | Have (0.3.3) | S | A3, A7 |
| [x] | A6 | Reasoning display | Have (0.1.3) | S | A3 |
| [x] | A2 | Stop / cancel (mid-stream) | Have (0.3.3) | S | A3 |

### Phase 3: Rendering
Exit: the same markdown renders identically for user and assistant messages.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | A9 | Markdown rendering (assistant and user) | Unknown | S | none |
| [x] | A10 | Code blocks in messages | Unknown | S | A9 |

### Phase 4: Safety
Exit: no shell call runs without approval; deny beats allow; hostile artifact reaches nothing.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | D4 | Permission engine | Have (0.1.3) | M | H1 |
| [x] | D5 | Approval UI | Have (0.1.3) | M | D4 |
| [x] | D7 | Shell tool (gated) | Partial (0.1.3: cwd still home) | M | D4, D5 |
| [x] | F2 | Artifact isolation | Missing | M | H1 |
| [x] | E2 | Secret refusal in memory | Missing | S | none |

### Phase 5: Data safety
Exit: edit and regenerate never destroy a message.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | B2 | Message tree (branches) | Missing | M | H1 |
| [x] | A12 | Message actions rewired to branches | Have | S | B2 |

### Phase 6: Scoped memory
Exit: memory writes only bio, preferences, or explicit asks; thread summary stays private and primary, durable points roll up to shared project memory; injected memories match the current turn.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | E1 | Scoped memory recall | Partial | S | H1 |
| [x] | E6 | Write-only-what-matters memory + thread roll-up | Missing | S | E2 |

---

## Later

### Review debt (deferred from the 0.3.2 gate)

No IDs; these stay here until one is taken into a release. None is a known
exploit on its own — they are the hardening items the 0.3.2 review raised and we
chose to defer.

| Item | Where | Note |
|---|---|---|
| MCP alias collision | `src-tauri/src/mcp.rs` namespace encoding | Two servers can expose the same tool name and the model sees one of them. Needs a namespacing scheme that survives reconnects. |
| Untrusted framing | MCP tool descriptions and results, `web_fetch` bodies, `web_search` hits | Tool output is delimited but not neutralised, so a hostile page can forge the delimiter or a trailer. Phase 1 framing work. |
| Deny-table ordering | `mcp.rs` `filter_tools` / `blocked` | Deny-only today; revisit when allow-lists land. |
| Bidi and C1 controls | raw tool output preview | Not stripped; they can reorder or hide text in the preview. |
| `SKILL.md` size cap | skills loader | A skill's text reaches context with no cap. |
| Attachment parse cache | `src/lib/attachments.ts` `parseMessageAttachments` | Re-parses on every read; memoise when transcripts grow. |
| Frontend tests not in CI | `.github/workflows/ci.yml` | `npm test` (vitest) is green locally but CI runs only the Rust suite. Add the step with the next CI change. |
| `mcp_add` accepts any stdio command | Settings | Intentional: the user types it themselves behind the approval gate. Recorded so it is not re-flagged. |

### Dependency advisories

| Item | Where | Note |
|---|---|---|
| `zip 8.6.0` — RUSTSEC-2026-0367 / GHSA-vv5m-jxxh-4627 | transitive through `calamine 0.36.1` and `docx-rs 0.4.22` (`Cargo.lock`) | Flagged by the SafeDep scan on PR #21. Fixed only in `zip 9.0.0`, and both crates still pin `zip = "8"`, so no upgrade path exists. Every advisory covers the extraction APIs (`ZipArchive::extract`, stream extraction) that write entries to disk with attacker-controlled paths, permissions or symlinks; myagent calls none of them — the two crates only open `ZipArchive::new` and read entries in memory with `by_index`. Revisit when calamine or docx-rs allow `zip 9`. |

### Phase 7: Usage and context
Exit: compaction runs once at the threshold and the model still recalls an early decision.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | C3 | Model catalogue and capabilities | Partial | M | none |
| [ ] | C4 | Reasoning effort control | Partial | S | C3 |
| [ ] | C5 | Usage and cost (real usage) | Partial | S | A3 |
| [ ] | C6 | Context meter | Partial | S | C3, C5 |
| [ ] | C7 | Prune old tool outputs | Missing | S | C5 |
| [ ] | C8 | Compaction summary | Partial | L | C5, C7 |
| [ ] | C9 | Compact trigger (manual and auto) | Missing | S | C8 |

### Phase 8: Tool basics (office harness)
Exit: the agent runs gated tools with capped output and a loop guard. No file workspace in v1.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | D13 | Output cap and spill files | Have (0.1.4) | S | D7 |
| [ ] | D3 | Step cap and doom-loop guard | Have (0.3.3) | S | D1 |
| [ ] | D2 | Streaming tool loop | Missing | L | A3, D1 |

### Phase 9: Conversation management
Exit: find, organize, back up and wipe chats.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | B8 | Temporary chat | Missing | S | B2 |
| [ ] | B4 | Search | Missing | M | B1 |
| [ ] | B9 | Export | Partial | S | B2 |
| [ ] | B10 | Import | Missing | S | B9 |
| [ ] | B11 | Delete data (every byte) | Partial | S | D13, F3 |
| [ ] | B7 | Tags | Missing | S | B1 |
| [ ] | B6 | Folders | Missing | M | B1 |
| [ ] | B5 | Pins | Have | S | none |
| [ ] | B3 | Chat list polish | Have | S | none |
| [ ] | A13 | Auto titles (tags later) | Have | S | none |

### Phase 10: Shell around the agent
Exit: the app is comfortable to use daily.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | C1 | Provider and API key storage (verify first) | Unknown | S | none |
| [ ] | C2 | Model picker polish | Have | S | C3 |
| [ ] | G3 | Settings page | Unknown | M | C1, D4 |
| [ ] | G1 | Slash commands | Have (0.2.0) | M | C9, B9 |
| [ ] | G2 | Keyboard shortcuts | Partial | S | none |
| [ ] | A8 | Queue messages while streaming | Missing | S | A2 |
| [ ] | G4 | Theme | Unknown | S | none |
| [ ] | G5 | Completion notification | Missing | S | none |
| [ ] | G6 | Debug log view | Missing | S | none |
| [ ] | E5 | System prompt per chat | Unknown | S | E3 |
| [ ] | F1 | Artifact drawer (versions) | Partial | M | F2, B2 |

### Phase 11: Extra capabilities
Exit: each added one at a time with its own tests.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [x] | D16 | Question tool | Have (0.1.3) | M | D5 |
| [ ] | D17 | Todo list tool | Have (0.2.0) | M | D1 |
| [ ] | D14 | Web fetch | Have (0.2.0) | M | D4, D5 |
| [ ] | D15 | Web search | Have (0.2.0) | M | D14 |
| [ ] | F3 | Attachments + project knowledge (text, docs) | Missing | M | F2 |
| [ ] | F4 | Image input (vision) | Missing | S | C3, F3 |
| [ ] | F5 | Mermaid and LaTeX | Missing | M | A9 |
| [ ] | G7 | Auto-update | Missing | M | none |
| [ ] | D18 | Subagents | Missing | L | D1-D17 |

---

### Phase 12: Differentiators
Exit: each shipped one at a time, with its own tests. Do not start before Phase 7 exit passes.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | J1 | Context inspector | Missing | S | C7, C8 |
| [ ] | J2 | Cost cap and budget | Missing | M | C3, C5 |
| [ ] | J5 | Cheap-model routing | Missing | S | A13, C8 |
| [ ] | J4 | Local models | Missing | S | C1, C3 |
| [ ] | J3 | Side-by-side compare | Missing | M | B2, C3 |
| [ ] | J8 | Action audit log | Missing | S | D5 |
| [ ] | J7 | Branch tree view | Missing | M | B2 |
| [ ] | J9 | Prompt and command files | Missing | M | G1 |
| [ ] | J10 | Artifact export | Missing | S | F1 |
| [ ] | J6 | Quick-ask hotkey | Missing | M | B8 |
| [ ] | J11 | Scheduled runs | Missing | L | B8 |
| [ ] | J12 | MCP and skills | Missing | L | D4, D5 |

---

### Phase 13: Code mode, Phases 1-2 (gated)

Exit: big results are handles, tool definitions load on demand, and `execute_js` runs behind a setting.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | D20 | Result handles, `read_result`, on-demand tool definitions | Missing | M | D19 |
| [ ] | D21 | `execute_js` (QuickJS via `rquickjs`, off by default) | Missing | L | D20, D4, D5 |

Trigger: measured intermediate tokens over ~10K per turn on a regular basis. Spike `rquickjs` on Windows first. Plan: `docs/plan/code-mode-migration.md`.

---

## Sandbox and developer workspace (v0.4.0 S1; remainder in v2)

v1 is an office harness (Claude app / ChatGPT / OpenWebUI alt), not developer-first. The file-tools and sandbox set below is scheduled as v0.4.0 S1 (`docs/releases/v0.4.0.md`, plan `docs/plan/v0.4.0-sandbox.md` rev 2), not v2, as `docs/releases/v1.0.0.md` already records. Projects (E3) stay in v1 as grouping plus docs storage (pdfs, docs). The undo and diff UI, and the rest of the developer workspace, stay in v2.

Exit: the agent can read, search, edit and undo inside a project and nothing escapes it.

| Do | ID | Feature | Status | Size | Depends |
|---|---|---|---|---|---|
| [ ] | D8 | Read file tool | Unknown | S | D4 |
| [ ] | D9 | List, glob, grep tools | Unknown | M | D4 |
| [ ] | D10 | Write and edit tools | Unknown | M | D4, D8 |
| [ ] | D11 | Diff view | Missing | M | D10 |
| [ ] | D12 | Checkpoints / undo | Missing | M | D10, B2 |
| [ ] | D6 | Permission modes (ask, accept edits, plan) | Missing | M | D4, D10 |
| [ ] | E4 | Project instructions file (`AGENTS.md`) | Unknown | S | E3 |

---

## Not now

| ID | Feature | Reason |
|---|---|---|
| I1 | Anthropic-native wire | OpenRouter covers it |
| I2 | Image generation | Not core |
| I3 | Voice in/out | Not core |
| I4 | Knowledge / RAG | Large; Projects plus file tools cover it |
| I5 | MCP servers | Moved to J12, after the permission engine |
| I6 | Hooks, plugins | Skills moved to J12; hooks and plugins stay skipped |
| I7 | Sharing, multi-user | Single-user app |
| I8 | Code execution sandbox | Shell tool covers it |
