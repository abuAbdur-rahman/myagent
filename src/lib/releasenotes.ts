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
