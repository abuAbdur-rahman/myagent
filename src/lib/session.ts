import { parseDocAttachments, parseImageAttachments } from "./attachments";
import { parseDeclaredArtifacts, parseToolLog } from "./message-parse";
import type { Message, Todo } from "./types";
import type { ArtifactLocator } from "./artifact-versions";

export interface SessionOutput {
  key: string;
  title: string;
  lang: string;
  code: string;
  path?: string;
  kind: "artifact" | "file";
  messageId?: string;
  locator?: ArtifactLocator;
  artifactId?: string;
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

const DELIVERABLE_EXT =
  /\.(pdf|docx|pptx|xlsx|odt|ods|odp|csv|tsv|md|txt|png|jpe?g|gif|webp|svg|zip|mp4|mp3)$/i;

export function selectOutputFiles(paths: string[]): string[] {
  const unique = [...new Set(paths)].filter(
    (path) => !/(^|[/\\])outputs[/\\]renders[/\\]/i.test(path),
  );
  const hasDeliverable = unique.some((path) => DELIVERABLE_EXT.test(path));
  return unique.filter((path) => !hasDeliverable || DELIVERABLE_EXT.test(path));
}

const BINARY_ARTIFACT_LANGS = new Set([
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
  "odt",
  "ods",
  "odp",
  "zip",
  "7z",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

export function isBinaryArtifact(lang: string): boolean {
  return BINARY_ARTIFACT_LANGS.has(lang.toLowerCase());
}

export function sessionOutputs(messages: Message[]): SessionOutput[] {
  const artifacts: SessionOutput[] = [];
  const files: SessionOutput[] = [];
  const artifactKeys = new Set<string>();
  const writtenPaths: string[] = [];

  for (const message of [...messages].reverse()) {
    for (const entry of parseToolLog(message.tool_log)) {
      for (const path of entry.files ?? []) {
        if (!writtenPaths.includes(path)) writtenPaths.push(path);
      }
    }
    for (const [index, artifact] of parseDeclaredArtifacts(message.artifacts).entries()) {
      const key = `${artifact.title}::${artifact.lang}`;
      if (artifactKeys.has(key)) continue;
      artifactKeys.add(key);
      artifacts.push({
        key: `artifact:${key}`,
        title: artifact.title,
        lang: artifact.lang,
        code: artifact.code,
        kind: "artifact",
        messageId: message.id,
        locator: { kind: "tool", index },
        artifactId: `${message.id}:tool:${index}`,
      });
    }
  }

  for (const path of selectOutputFiles(writtenPaths)) {
    const title = baseName(path);
    files.push({
      key: `file:${path}`,
      title,
      lang: extensionOf(title),
      code: "",
      path,
      kind: "file",
    });
  }

  const kept = artifacts.filter(
    (artifact) =>
      !isBinaryArtifact(artifact.lang) ||
      !writtenPaths.some((path) => path.toLowerCase().endsWith(`.${artifact.lang}`)),
  );
  return [...kept, ...files];
}

export interface SessionToolUsage {
  name: string;
  count: number;
}

export interface SessionUsage {
  docs: { name: string; mime: string }[];
  images: number;
  tools: SessionToolUsage[];
  domains: string[];
  files: string[];
}

export function sessionUsage(messages: Message[]): SessionUsage {
  const docs: { name: string; mime: string }[] = [];
  const docKeys = new Set<string>();
  const toolCounts = new Map<string, number>();
  const domains: string[] = [];
  const files: string[] = [];
  let images = 0;

  for (const message of [...messages].reverse()) {
    for (const doc of parseDocAttachments(message.attachments)) {
      const key = `${doc.name}:${doc.sha256}`;
      if (docKeys.has(key)) continue;
      docKeys.add(key);
      docs.push({ name: doc.name, mime: doc.mime });
    }
    images += parseImageAttachments(message.attachments).length;
    for (const entry of parseToolLog(message.tool_log)) {
      toolCounts.set(entry.name, (toolCounts.get(entry.name) ?? 0) + 1);
      for (const domain of entry.domains ?? []) {
        if (!domains.includes(domain)) domains.push(domain);
      }
      for (const path of entry.files ?? []) {
        if (!files.includes(path)) files.push(path);
      }
    }
  }

  const tools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { docs, images, tools, domains: domains.slice(0, 8), files };
}

export interface StepProgress {
  done: number;
  total: number;
  current: number;
}

export function stepProgress(todos: Todo[]): StepProgress {
  const total = todos.length;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const activeIndex = todos.findIndex((todo) => todo.status === "in_progress");
  const current =
    activeIndex >= 0 ? activeIndex + 1 : done >= total ? total : done + 1;
  return { done, total, current: Math.max(1, current) };
}

export function stepLabel(todos: Todo[]): string | null {
  const { current, total } = stepProgress(todos);
  if (total === 0) return null;
  return `Step ${current} of ${total}`;
}
