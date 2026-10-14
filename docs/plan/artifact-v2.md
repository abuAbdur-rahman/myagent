# Artifact v2 — resizable panel + declared file cards

Next-release scope. Decisions locked with user; one defaulted item at the end.

## Panel: resize, fullscreen, minimize vs close

1. **Width drag** — drag handle on the panel's left edge, clamped min/max,
   width persisted in localStorage and restored across sessions.
2. **Fullscreen expand** — header expand button turns the panel into an
   overlay covering the chat; toggles back to the docked (remembered) width.
3. **Minimize ≠ close**
   - Minimize → chat keeps most of the width, artifact stays visible in a
     small live panel beside it.
   - Close (X) → full-width chat; transcript keeps the file card to reopen.
4. Header gains minimize + expand + close buttons; existing Ctrl+Shift+A
   toggle keeps working.

## Declared artifacts → Claude-style file cards

5. **Declaration = `save_artifact` tool call only.** No fence sniffing for
   other languages, no length fallback. The tool call is the declare step
   (mirrors Claude: model decides, no user-visible marker).
6. **System-prompt rule** — standalone, reusable output over ~50 lines must
   go through `save_artifact` with title + language; short snippets stay
   inline codeblocks. Codeblock ≠ artifact.
7. **File card in transcript** — title, language badge, Open button; Hide
   appears while the panel is open for that artifact. Tool artifacts never
   render inline code. Cards derive from persisted tool-log entries so they
   survive reload/branch.
8. **Views per type** — `html` Preview/Code, `md` Doc/Source, everything
   else Code only.

## Defaulted (proceed unless told otherwise)

9. Existing ```html fence extraction stays as the declaration convention for
   previewable types, but those blocks now render as file cards with the
   code hidden (no more inline dump + button duplication).

## AgentRouter models fix (same release)

10. Root cause: `list_models` sent bearer-only to
    `https://agentrouter.org/v1/models`. Path is correct (401 without key),
    but the gateway needs client headers — proven by
    `C:\Users\abdul\.opencode\agentrouter_server.js:44-56`, which succeeds
    with `originator` + `User-Agent` and reads the `{success, data}` envelope.
11. Fix (`src-tauri/src/llm.rs::list_models`): when the base URL contains
    `agentrouter.org`, send `User-Agent: myagent/<version>` +
    `originator: myagent`; accept both `{data}` and `{success, data}`
    envelopes (same `.data` array); drop models whose
    `supported_endpoint_types` is present but lacks `openai` (chat uses
    `/v1/chat/completions`). Other providers untouched.
12. Live-verified model IDs via local proxy: `claude-opus-4-8`,
    `claude-opus-5`, `deepseek-v4-flash`, `gpt-6-astra`.
