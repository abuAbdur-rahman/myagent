import { toast } from "../../lib/toast";
import {
  formatBytes,
  ingestChatDoc,
  MAX_DOC_BYTES,
  type ChatDocument,
} from "../../lib/chat-docs";
import { pastedImageName } from "../../lib/clipboard";
import { downscaleImage, isSupportedImage } from "../../lib/image";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSION_MIMES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  yml: "application/yaml",
  yaml: "application/yaml",
  xml: "application/xml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  jsx: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  toml: "text/plain",
  ini: "text/plain",
  log: "text/plain",
  sh: "text/plain",
  ps1: "text/plain",
  py: "text/plain",
  rs: "text/plain",
  go: "text/plain",
  java: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  h: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

const IMAGE_EXTENSION_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function mimeForFile(name: string, declared: string): string {
  if (declared) return declared;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_MIMES[ext] ?? "";
}

function imageTypeOf(file: File): string {
  if (file.type) return file.type;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return "";
  return IMAGE_EXTENSION_MIMES[file.name.slice(dot + 1).toLowerCase()] ?? "";
}

export interface DocChip {
  key: string;
  kind: "doc";
  name: string;
  detail: string;
  doc: ChatDocument;
}

export interface ImageChip {
  key: string;
  kind: "image";
  name: string;
  detail: string;
  dataUrl: string;
}

export type AttachChip = DocChip | ImageChip;

export function isDocChip(chip: AttachChip): chip is DocChip {
  return chip.kind === "doc";
}

export function isDocFile(file: File): boolean {
  return !isSupportedImage(imageTypeOf(file));
}

async function buildImageChip(file: File, index: number): Promise<ImageChip | null> {
  const name = pastedImageName(file, index);
  if (file.size > MAX_IMAGE_BYTES) {
    toast(`"${name}": over ${formatBytes(MAX_IMAGE_BYTES)}, skipped.`);
    return null;
  }
  try {
    const typed = file.type
      ? file
      : new File([file], file.name, { type: imageTypeOf(file) });
    const downscaled = await downscaleImage(typed);
    return {
      key: `img-${index}-${Date.now()}`,
      kind: "image",
      name,
      detail: formatBytes(file.size),
      dataUrl: downscaled.dataUrl,
    };
  } catch {
    toast(`"${name}": couldn't read as image.`);
    return null;
  }
}

async function buildDocChip(
  file: File,
  index: number,
  conversationId: string | null,
): Promise<DocChip | null> {
  if (file.size > MAX_DOC_BYTES) {
    toast(`"${file.name}": over ${formatBytes(MAX_DOC_BYTES)}, skipped.`);
    return null;
  }
  const mime = mimeForFile(file.name, file.type);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ingestChatDoc({
      conversationId,
      name: file.name,
      mime,
      bytes,
    });
    if (result.status === "refused") {
      toast(`"${file.name}": ${result.message}.`);
      return null;
    }
    if (result.status === "duplicate") {
      toast(`"${file.name}": already attached here, reusing the stored copy.`);
    }
    return {
      key: `${result.doc.sha256}-${Date.now()}-${index}`,
      kind: "doc",
      name: file.name,
      detail: `${formatBytes(result.doc.size)} · ${result.doc.chars.toLocaleString()} chars`,
      doc: result.doc,
    };
  } catch (error) {
    console.warn(`attachment: ${file.name} could not be read`, error);
    toast(`"${file.name}": couldn't attach.`);
    return null;
  }
}

async function pickChip(
  file: File,
  index: number,
  conversationId: string | null,
  docsLeft: number,
): Promise<AttachChip | null> {
  if (isSupportedImage(imageTypeOf(file))) return buildImageChip(file, index);
  if (docsLeft <= 0) return null;
  return buildDocChip(file, index, conversationId);
}

export async function collectChips(
  files: File[],
  conversationId: string | null,
  room: number,
): Promise<AttachChip[]> {
  const chips: AttachChip[] = [];
  let left = room;
  for (const [index, file] of files.entries()) {
    const chip = await pickChip(file, index, conversationId, left);
    if (chip) {
      chips.push(chip);
      if (isDocChip(chip)) left -= 1;
    }
  }
  return chips;
}

export function docChipsIn(chips: AttachChip[]): number {
  return chips.filter(isDocChip).length;
}

export function docsOf(chips: AttachChip[]): ChatDocument[] {
  return chips.filter(isDocChip).map((chip) => chip.doc);
}

export function imagesOf(chips: AttachChip[]): { dataUrl: string }[] {
  return chips.filter((chip) => !isDocChip(chip)).map((chip) => ({ dataUrl: chip.dataUrl }));
}

export function outgoingText(text: string, imageCount: number, docCount: number): string {
  if (text.trim().length > 0) return text;
  if (imageCount > 0) return "See the attached image.";
  if (docCount > 0) return "See the attached document.";
  return "";
}
