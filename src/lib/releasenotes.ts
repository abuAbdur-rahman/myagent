export type ChangeKind = "new" | "improved" | "fixed";

export interface ReleaseChange {
  kind: ChangeKind;
  text: string;
}

export interface Release {
  version: string;
  date: string;
  summary: string;
  changes: ReleaseChange[];
}

export const CHANGE_KINDS: readonly ChangeKind[] = ["new", "improved", "fixed"];

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

export const RELEASES: readonly Release[] = [
  {
    version: "0.6.1",
    date: "2026-10-28",
    summary:
      "A review-fix patch for 0.6.0: legacy MCP SSE sessions reconnect cleanly, Windows stdio MCP servers resolve their .cmd shims, provider keys rotate from the first available key, model-list Refresh bypasses the backend cache, and raw clipboard screenshots paste into the composer.",
    changes: [
      {
        kind: "fixed",
        text: "A closed legacy SSE stream is evicted and reconnected. Requests use unique JSON-RPC ids, server-initiated requests are ignored, framing buffers are bounded, and a bearer token is only sent to the same origin as the SSE endpoint.",
      },
      {
        kind: "fixed",
        text: "Windows stdio MCP servers now launch reliably: npx/npm/pnpm/yarn/uvx shims resolve to their .cmd files with Rust's batch escaping, PATH includes the registry and common tool directories, children run without a console window, and a cold install gets 60 seconds instead of 20.",
      },
      {
        kind: "fixed",
        text: "Provider key rotation starts with the first key that is not cooling down. A quota-flavoured 429 or payment-required response marks the active key exhausted; with another key the request moves on, otherwise the error reports the cooldown. A plain 429 keeps the normal rate-limit backoff.",
      },
      {
        kind: "fixed",
        text: "Refresh on Models bypasses the backend ten-hour model cache as well as the picker cache. Empty lists are not cached, and an in-flight request cannot repopulate a cache that was just invalidated.",
      },
      {
        kind: "fixed",
        text: "Retrying a draft provider replaces its key instead of adding a second key. Stored model-cache entries are validated with Zod.",
      },
      {
        kind: "fixed",
        text: "Pasting a screenshot works when the clipboard exposes the image as a clipboard item rather than a file. Unnamed pasted images get a generated name.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-26",
    summary:
      "Online MCP servers now work without a bridge: Streamable HTTP, OAuth 2.1 with a loopback sign-in, bearer tokens in the Windows Credential Manager, and a tool list that stays current. This release also rotates up to ten provider keys on quota errors, caches model lists for ten hours, retries AgentRouter's gateway block with a clear message, and turns first-run setup into four short steps.",
    changes: [
      {
        kind: "new",
        text: "MCP servers can use Streamable HTTP as well as stdio and the legacy SSE transport. Initialize, protocol-version and session headers, initialized notifications, JSON or SSE responses, and the legacy handshake are handled by the official Rust SDK.",
      },
      {
        kind: "new",
        text: "OAuth 2.1 servers sign in through protected-resource discovery, authorization-server metadata, dynamic client registration, PKCE S256 and a 127.0.0.1 loopback callback. Tokens refresh and disconnect locally; the custom myagent:// callback is deferred.",
      },
      {
        kind: "new",
        text: "Bearer-token servers use a write-only token field. Bearer and OAuth credentials live in the Windows Credential Manager, chunked when needed, and never enter the webview or SQLite.",
      },
      {
        kind: "improved",
        text: "Connected MCP servers honour tools/list_changed and re-list after five minutes. Non-text tool results are described instead of becoming empty, and a handshake now has a 20-second deadline so a dead server cannot block the first send.",
      },
      {
        kind: "new",
        text: "A provider connection can hold up to ten keys. A quota or billing rejection skips to the next key and cools the rejected key for ten minutes; plain rate limits keep the existing backoff. Providers lists each key, shows a cooling key, and can remove one or all keys.",
      },
      {
        kind: "improved",
        text: "AgentRouter's content-blocked gateway response is retried twice and then reported as an AgentRouter moderation block, not a model decline. The error names the gateway and suggests rephrasing or starting a new chat.",
      },
      {
        kind: "improved",
        text: "Model lists are cached for ten hours in the backend and in the picker, so reopening the picker does not wait on every provider. Refresh on Models, saving or deleting a provider, and a successful provider test clear the cache.",
      },
      {
        kind: "improved",
        text: "First-run onboarding is four steps: welcome and display name, provider, model, and search/suggestions. A failed first model check keeps the provider row and explains the key, base URL or network error so setup can be retried.",
      },
      {
        kind: "improved",
        text: "Ollama Cloud verification uses the documented /api/balance bearer check, and model listing falls back to /api/tags when /v1/models is unavailable.",
      },
      {
        kind: "fixed",
        text: "The hold-to-talk mic sits beside Send instead of at the far left of the composer toolbar.",
      },
    ],
  },
  {
    version: "0.5.1",
    date: "2026-10-24",
    summary:
      "AgentRouter's current GPT models reject the Chat Completions endpoint and require the Responses API. MyAgent now detects that response once per model and retries against /v1/responses, keeping chat, tools, titles and summaries working without a new setting.",
    changes: [
      {
        kind: "fixed",
        text: "A provider that answers a chat request with “does not support /v1/chat/completions, use /v1/responses” is switched to the Responses API for that model. The switch happens once per launch, after the rejected request; later messages go straight to the new endpoint.",
      },
      {
        kind: "improved",
        text: "Responses requests preserve the tool loop: reasoning, function calls and their outputs are replayed, so a model can call several tools without losing its chain of thought. A partial completed response is reconciled with the calls already seen, and requests stay stateless and are not stored by the provider.",
      },
      {
        kind: "improved",
        text: "Generated titles and chat summaries use the same fallback and go straight to the Responses endpoint after the first switch. A failed or empty response is reported instead of becoming an empty title or summary.",
      },
      {
        kind: "fixed",
        text: "The fallback only runs before any answer text or tool call reaches the screen, so a late provider error cannot duplicate a reply. Oversized streams and tool arguments stop with a clear error instead of executing a partial call.",
      },
      {
        kind: "fixed",
        text: "A memory note deleted from MEMORY.md stays deleted if the migration marker is lost; the marker now remembers which legacy notes were already imported. Memory saves replace the file with one atomic rename, and a manual date that is not YYYY-MM-DD is refused.",
      },
      {
        kind: "fixed",
        text: "Generated titles keep double underscores, so Python names such as __init__ are not mangled. Notes written by a subagent are marked untrusted like notes from other tools.",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-23",
    summary:
      "Memory became one editable file per scope, migrated from the database without losing a note. Settings can open and edit the file directly, the inbox still gates every assistant write, and a note that looks like a key is refused. This release also finishes the 0.4.1 ledger: audit rows record duration, exit code and source; DeepSeek models know their context window; data export and import gained scopes; and the chat's jump button and activity pill stay where they belong.",
    changes: [
      {
        kind: "new",
        text: "Memory lives in MEMORY.md, with one file per project, beside the database. Four headings keep it readable, every note carries an id and date in a comment, and 0.4.1 notes migrate once with a full JSON backup. The database copy is frozen as a rollback, and a failed migration keeps memory working from it with a banner.",
      },
      {
        kind: "new",
        text: "Settings → Memory edits the file itself. A save is refused when the file changed on disk since it was opened, so a hand edit is never silently lost. Notes whose project no longer exists wait in an unassigned list instead of disappearing.",
      },
      {
        kind: "new",
        text: "Data export offers a scope: everything, chats and projects, or memory. The export carries the memory markdown, and import keeps the original ids, so importing the same file twice changes nothing.",
      },
      {
        kind: "improved",
        text: "A note proposed by the assistant is refused when it looks like an API key, token or password. Notes written after a web search, a fetched page, a document, a shell command or an MCP tool are marked untrusted in the inbox, so approval is an informed decision. Editing an existing note now asks first; deleting already did.",
      },
      {
        kind: "improved",
        text: "The 2500-character send budget is visible: Settings says how many notes are saved but not sent, and shortening a note makes room again.",
      },
      {
        kind: "improved",
        text: "Audit rows show the decision source, duration and exit code, and rows recorded before this release still render.",
      },
      {
        kind: "improved",
        text: "DeepSeek models show a context window instead of Unknown. A value reported by the provider still wins.",
      },
      {
        kind: "fixed",
        text: "The jump-to-latest button holds its place at the bottom of the chat instead of scrolling away with the transcript.",
      },
      {
        kind: "fixed",
        text: "Only one activity pill is mounted: centred on an empty chat and above the composer after the first message.",
      },
      {
        kind: "fixed",
        text: "Generated chat titles are plain text in the sidebar and header, including titles stored before this release.",
      },
      {
        kind: "fixed",
        text: "The sidebar lost the message box and the All chats filter; tags and the Ctrl+K palette remain.",
      },
      {
        kind: "fixed",
        text: "An approved memory now appends to the file, and Undo restores the exact pending note.",
      },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-10-22",
    summary:
      "Settings now shows what it can actually prove: each search key is masked and testable on its own, Models is a capability table instead of a list, and DeepSeek plus both Ollama kinds work — a local server asks for no key at all. The chat grew a Progress panel with steps, outputs and what the turn spent, an Outputs gallery, a chat filter, and pasted code arrives fenced. Airtable formulas and scripts highlight like any other language.",
    changes: [
      {
        kind: "new",
        text: "A Progress panel replaces the artifact-only drawer: steps in order, the chat's artifacts and written files, and what the turn used (uploads, tools, search domains). The header shows Step n of m, the old sticky checklist is gone, and the panel overlays with a focus trap when the window is narrow.",
      },
      {
        kind: "new",
        text: "Outputs in the sidebar opens a gallery of the current chat's artifacts and files. Thumbnails render in a sandbox that cannot run scripts, so a preview can never act on the app.",
      },
      {
        kind: "new",
        text: "Replies can be rated up or down. The rating is stored with the message and travels with the chat export, so it is data rather than a button with no consequence.",
      },
      {
        kind: "improved",
        text: "Settings answers its own questions: search jumps to the row on another page and highlights it, every page carries a subtitle, and the dialog traps focus and gives it back when it closes. Models became a capability table showing context, tools, vision and effort per model, with Unknown where the provider reports nothing.",
      },
      {
        kind: "improved",
        text: "Providers learned DeepSeek, Ollama Cloud and local Ollama. Local Ollama stores no key anywhere, Ollama Cloud falls back to its tags endpoint when the OpenAI-shaped list is empty, and effort controls hide themselves for providers whose request carries no reasoning field. A missing key now blocks the send and names the page that fixes it.",
      },
      {
        kind: "improved",
        text: "Search keys are listed one by one with a mask, a per-key test and session counters of hits and quota exhaustion, so a dead key is visible before it costs a turn. SearXNG gained an endpoint probe, and Exa joined as a fallback that is used only when Tavily answers quota.",
      },
      {
        kind: "improved",
        text: "Memory writes by the assistant now wait for approval: they land as pending, arrive as a Save or Dismiss toast, and Undo reverses the save. The Memory page can search notes, say where each came from, and export them.",
      },
      {
        kind: "improved",
        text: "The transcript keeps up with what the turn is doing: one pill shows Thinking, Writing, Compacting, Listening or Transcribing, centred when the chat is empty and above the composer otherwise. Attachments became cards that name the file and its type, the sidebar filters by All, Pinned or one project, and a pasted code block arrives fenced with Undo restoring the raw text.",
      },
      {
        kind: "improved",
        text: "Airtable work highlights: `airtable` and `airtable-formula` fences get field references, functions, strings and operators, while `script`, `airtable-script`, `apps-script` and `gs` render as JavaScript in both user and assistant messages.",
      },
      {
        kind: "fixed",
        text: "Tool calls written as plain text (DSML) run instead of appearing in the reply, and the context bar never claims a percentage for a model whose window the provider does not report.",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-21",
    summary:
      "The assistant can talk, research and delegate: hold the mic button to dictate, ask for a research run and get a cited memo, and let a subagent carry a scoped piece of work while the parent waits. Project code can run in a Docker sandbox instead of the host, and an approval card now says when the request it is asking about looks like a prompt-injection attempt.",
    changes: [
      {
        kind: "new",
        text: "Push-to-talk transcription: hold the mic to record 16 kHz mono, release to transcribe. The local Moonshine base model downloads once (~64 MB, pinned sizes) and loads only when used; an OpenAI-compatible provider can transcribe instead, and the recording caps at 60 seconds.",
      },
      {
        kind: "new",
        text: "`research_run` turns a question into planner queries, asks once, then returns a markdown memo whose claims cite the pages they came from. Results arrive as a normal artifact.",
      },
      {
        kind: "new",
        text: "`delegate_task` runs a depth-one subagent. Its events stay inside the parent tool entry, so the transcript shows one block of work instead of two interleaved streams, and a turn cannot spawn children without limit.",
      },
      {
        kind: "new",
        text: "A Docker sandbox runs project code away from the host: protected paths stay read-only, host writes are refused, auto-allow is limited to the commands the sandbox can contain, and the packages you add stay editable after a reload.",
      },
      {
        kind: "new",
        text: "Approval cards screen the pending request with a bundled local model. A flagged request is labelled as such, and approving it cannot persist an allow rule, so one careless click cannot widen the permission for the rest of the chat.",
      },
      {
        kind: "fixed",
        text: "Forged envelope markers in MCP and web results are redacted, so a page or a server cannot dress its output up as a tool call the assistant made.",
      },
      {
        kind: "fixed",
        text: "The `SKILL.md` body injected into context is capped, and the test suite now runs in CI so a broken frontend fails the build instead of reaching a release.",
      },
    ],
  },
  {
    version: "0.3.6",
    date: "2026-10-18",
    summary:
      "The assistant can edit and delete saved memories, and the tool-call list stops disappearing: it stays under the reply that used it and follows the Collapse tool calls setting. Deleting a memory or a project now confirms in the app's own dialog.",
    changes: [
      {
        kind: "new",
        text: "Memories can be changed or removed by the assistant: recall_memory prints an id beside each memory it finds, and update_memory or delete_memory act on that id, so a stale note is fixed or dropped without touching the others.",
      },
      {
        kind: "improved",
        text: "Every agent deletion asks first. The approval card shows the memory text about to go, the deletion is written to the audit log, and an id is pinned to that one memory, so approving once can never allow blanket deletion.",
      },
      {
        kind: "fixed",
        text: "The tool-call list no longer vanishes when the reply arrives. It used to live only while the answer streamed even though the calls were saved with the message; now it stays under that reply, follows the Collapse tool calls setting, and is still there when the chat is reopened.",
      },
      {
        kind: "improved",
        text: "Deleting a memory, or a project, confirms in the app's own dialog with the consequence spelled out and the action word on the button, instead of the bare Windows prompt. Escape or a click outside cancels.",
      },
    ],
  },
  {
    version: "0.3.5",
    date: "2026-10-18",
    summary: "Documents come to every chat: attach a PDF, Word file, spreadsheet, markdown or code file and its text goes into the message, with a read_document tool that lets the model pull more of a file later. No project required.",
    changes: [
      {
        kind: "new",
        text: "Any chat can take file attachments. Text, markdown and code files, HTML, PDF, Word (.docx) and Excel or OpenDocument spreadsheets (.xlsx, .xls, .ods) are read inside the app and their text is added to the message you send — up to three files per message, 10 MB each.",
      },
      {
        kind: "new",
        text: "read_document lets the model ask for the rest of a file: it lists the documents a chat holds, returns a named one, or searches inside it, so a long document does not have to fit in one message.",
      },
      {
        kind: "improved",
        text: "Attaching a file no longer needs a project. Inside a project the document is still added to that project's knowledge, so every chat there can search it, and it is stored once no matter how many chats point at it.",
      },
      {
        kind: "improved",
        text: "Attached documents show as a card under the message with the file name and the amount of text extracted, and they are still there when the chat is reopened, because the reference is saved on the message.",
      },
      {
        kind: "improved",
        text: "Written-out document text is deleted as soon as no chat or project points at it, so removing a chat, clearing it, removing a project file or Delete everything frees the space. A damaged or unsupported file cannot take the app down either: extraction runs behind a guard and reports a short message instead.",
      },
    ],
  },
  {
    version: "0.3.4",
    date: "2026-10-18",
    summary: "A vision, model-selection and composer fix: a model whose provider does not report image support is no longer treated as blind, Settings → Models now lists models from every provider with a vision fallback that only offers models that can see, and markdown shortcuts in the composer now work when there is already text above.",
    changes: [
      {
        kind: "fixed",
        text: "A model whose provider does not report image support is no longer treated as blind. The capability check falls back to a known-model table, so a capable model receives images instead of being told it cannot see them.",
      },
      {
        kind: "fixed",
        text: "The describe-image tool is only offered to a model that cannot see, and it now runs on the fallback model's own provider, so the fallback may live on a different provider than the chat.",
      },
      {
        kind: "improved",
        text: "Settings → Models lists models from every configured provider, grouped by provider; picking one switches the active provider.",
      },
      {
        kind: "improved",
        text: "The vision fallback dropdown only lists models that can see images, and a new Image reading row lets you mark one model as able to see, or unable to see, when detection is wrong.",
      },
      {
        kind: "fixed",
        text: "Markdown shortcuts work when there is already text above: Shift-Enter starts a new block instead of a soft line break, so 1. / - / > / # and ```ts format wherever you type them, not only on the first line.",
      },
    ],
  },
  {
    version: "0.3.3",
    date: "2026-10-18",
    summary: "A verification release: retry and mid-stream stop are covered by tests, the step cap and repeat guard are recorded as done, and the roadmap now matches the code.",
    changes: [
      {
        kind: "improved",
        text: "Retrying is covered by tests on the stream path: a 429 retries with growing backoff, a 400 does not, and an error that arrives mid-stream never does. Retries keep the existing Retrying (n/10) toast.",
      },
      {
        kind: "improved",
        text: "Stopping a reply mid-stream now has a test: the turn ends at once and the text already shown is kept. A tool entry still open when the stream ends shows as interrupted.",
      },
      {
        kind: "improved",
        text: "The step cap (25, clamped to 1 to 32, with a no-tools fallback at the cap) and the Keep going / Stop here guard against a repeating tool call are recorded as done; the cap and the guard's counting are tested.",
      },
      {
        kind: "fixed",
        text: "The roadmap was checked against the code: stop/cancel, retry, the step cap and tool spill files now read Have, and markdown, code blocks, the composer, key storage and the test harness were corrected to Partial where their acceptance tests are still missing.",
      },
    ],
  },
  {
    version: "0.3.2",
    date: "2026-10-17",
    summary: "A design-system pass, a rebuilt MCP page with per-tool approvals, a Changelog page, and smaller tool output.",
    changes: [
      {
        kind: "new",
        text: "Settings gained a Changelog page: the installed version, Check for updates, and every release with its changes.",
      },
      {
        kind: "new",
        text: "MCP: each tool has its own Ask, Allow or Block choice that overrides the server default.",
      },
      {
        kind: "new",
        text: "MCP: an empty scope offers one-click presets for Filesystem, Fetch and Git.",
      },
      {
        kind: "new",
        text: "Tools take limits: web_fetch pages through a page with start and max_chars, web_search narrows with max_results and fields, run_powershell filters with grep, head and tail, and recall_memory caps its list.",
      },
      {
        kind: "improved",
        text: "Every limited tool result reports how much it showed and how to ask for the rest, and terminal colour codes and repeated blank lines are stripped.",
      },
      {
        kind: "improved",
        text: "MCP page rebuilt to the design system: server cards with transport, mono targets, a status pill and Reconnect.",
      },
      {
        kind: "improved",
        text: "MCP: a server default (Ask, Allow or Block) covers every tool the server exposes, and servers and tools edit in place.",
      },
      {
        kind: "improved",
        text: "MCP: a blocked tool is hidden from the model instead of prompting on every call.",
      },
      {
        kind: "improved",
        text: "Settings pages share one pattern: page header, cards, pills, and empty, loading and error states.",
      },
      {
        kind: "fixed",
        text: "Images sent with a message are kept: regenerating a reply or resubmitting an edited message no longer loses them, and they show in the transcript again after a reload.",
      },
      {
        kind: "fixed",
        text: "Deleting a chat no longer touches project knowledge, and the audit log keeps itself to the newest 500 entries.",
      },
      {
        kind: "fixed",
        text: "A long PowerShell command is now split into its real segments for the approval check, so a command hidden behind a pipeline or a quoted separator is still seen.",
      },
      {
        kind: "fixed",
        text: "Skill text can no longer close its own wrapper with an unterminated tag, and a skill's description is sanitized before it reaches the prompt.",
      },
    ],
  },
  {
    version: "0.3.1",
    date: "2026-10-17",
    summary: "One startup crash and four harness defects fixed. No new features.",
    changes: [
      {
        kind: "fixed",
        text: "The window no longer opens blank after an update; a store init-order bug threw during first render.",
      },
      {
        kind: "fixed",
        text: "The permission dialog's Always now persists for MCP tools instead of re-asking on every call.",
      },
      {
        kind: "fixed",
        text: "MCP tools appear without restarting the app; the catalog refreshes on a miss.",
      },
      {
        kind: "fixed",
        text: "An MCP server with an empty allow-list exposes no tools, the opposite of the previous behaviour.",
      },
      {
        kind: "fixed",
        text: "@skill mentions no longer fire inside longer words or before an identifier suffix.",
      },
      {
        kind: "improved",
        text: "A toast explains when images cannot reach a vision model and the message goes as text only.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-17",
    summary: "The harness grew up: knowledge, images, MCP and skills, prompt files, and an audit log.",
    changes: [
      {
        kind: "new",
        text: "Attachments and project knowledge: text and documents dedupe by hash and reach context as capped excerpts.",
      },
      {
        kind: "new",
        text: "Image input: paste or attach an image, downscaled and sent to vision models only.",
      },
      {
        kind: "new",
        text: "MCP servers and skills: skills load markdown into context on demand, and every MCP tool passes the permission engine.",
      },
      {
        kind: "new",
        text: "Prompt and command files in .myagents/commands/*.md become slash commands with $ARGUMENTS.",
      },
      {
        kind: "new",
        text: "An append-only audit log records every tool call, approval, deny and rule.",
      },
    ],
  },
  {
    version: "0.2.4",
    date: "2026-10-16",
    summary: "A small UX and search patch.",
    changes: [
      {
        kind: "fixed",
        text: "The project dialog closes on Save and Delete, and gained a Cancel button.",
      },
      {
        kind: "improved",
        text: "Tavily keys rotate on rate limits and exhausted credit, and Settings lists each key with its own remove.",
      },
      {
        kind: "fixed",
        text: "Streaming indicators stay on the streaming message, so older bubbles and other chats stay quiet.",
      },
    ],
  },
  {
    version: "0.2.3",
    date: "2026-10-16",
    summary: "Patch release for released features whose checks failed in code. No new features.",
    changes: [
      {
        kind: "fixed",
        text: "Retry with backoff is capped at three attempts and skips 400 responses entirely.",
      },
      {
        kind: "fixed",
        text: "Interrupted and stopped replies have their own states, and Continue appears for length and interrupted.",
      },
      {
        kind: "improved",
        text: "Search has a dedicated result test, and the SSE parser gained 429 and comment-line fixtures.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-15",
    summary: "Office tools: research on the web, a task list, and slash commands.",
    changes: [
      {
        kind: "new",
        text: "Web fetch: HTTPS only, asks first, and blocks private and loopback hosts with a re-check after redirects.",
      },
      {
        kind: "new",
        text: "Web search behind one tool, returning titles, URLs and snippets the model can fetch.",
      },
      {
        kind: "new",
        text: "A todo list the model keeps, shown as a sticky checklist above the composer and stored per chat.",
      },
      {
        kind: "new",
        text: "Slash commands: /compact, /export, /clear and /model.",
      },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-10-15",
    summary: "Context honesty: what the model can do, what it used, and how context is pruned.",
    changes: [
      {
        kind: "new",
        text: "A cached model catalogue with context length, reasoning and tool support gates the UI.",
      },
      {
        kind: "new",
        text: "A reasoning-effort selector appears only for models that support it.",
      },
      {
        kind: "new",
        text: "Usage footer and context meter driven by stored usage, warning at 80%.",
      },
      {
        kind: "new",
        text: "Pruning, /compact, and an automatic compaction at about 80% with an off switch.",
      },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-10-15",
    summary: "Find and keep your chats.",
    changes: [
      {
        kind: "new",
        text: "Full-text search over messages with chat snippets and project and date filters.",
      },
      {
        kind: "new",
        text: "Export a chat to Markdown or lossless JSON, and import your own JSON without overwriting anything.",
      },
      {
        kind: "new",
        text: "Delete one chat or everything: rows, attachments, spill files and caches, behind a confirm.",
      },
      {
        kind: "new",
        text: "Tags you add and remove by hand, and filter chats by tag.",
      },
    ],
  },
];

export function changeCount(release: Release): number {
  return release.changes.length;
}

export function changeCountLabel(release: Release): string {
  const count = changeCount(release);
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

export function releaseHasKind(release: Release, kind: ChangeKind): boolean {
  return release.changes.some((change) => change.kind === kind);
}

export function matchesKinds(release: Release, kinds: readonly ChangeKind[]): boolean {
  return kinds.length === 0 || kinds.some((kind) => releaseHasKind(release, kind));
}

export function filterReleases(
  releases: readonly Release[],
  kinds: readonly ChangeKind[],
): Release[] {
  return releases.filter((release) => matchesKinds(release, kinds));
}

export function openVersions(
  releases: readonly Release[],
  kinds: readonly ChangeKind[],
): string[] {
  const shown = filterReleases(releases, kinds);
  if (kinds.length === 0) {
    const newest = shown[0];
    return newest ? [newest.version] : [];
  }
  return shown.map((release) => release.version);
}
