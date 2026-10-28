export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export interface ClipboardDataLike {
  files: ArrayLike<File>;
  items: ArrayLike<ClipboardItemLike>;
}

export async function clipboardFiles(data: ClipboardDataLike): Promise<File[]> {
  const files: File[] = [];
  for (let index = 0; index < data.files.length; index += 1) {
    files.push(data.files[index]);
  }
  const images: File[] = [];
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const typed = await ensureImageType(file);
    if (typed.type.startsWith("image/")) images.push(typed);
  }
  if (images.length === 0) return files;
  if (files.some((file) => file.type.startsWith("image/"))) return files;
  const typedByKey = new Map(images.map((image) => [fileKey(image), image]));
  const merged = files.map((file) => typedByKey.get(fileKey(file)) ?? file);
  for (const image of images) {
    if (!merged.some((file) => fileKey(file) === fileKey(image))) {
      merged.push(image);
    }
  }
  return merged;
}

export function pastedImageName(file: File, index: number): string {
  if (file.name.trim()) return file.name;
  const subtype = file.type.split("/")[1]?.split("+")[0] || "png";
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  return `pasted-image-${index + 1}.${extension}`;
}

function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}`;
}

async function ensureImageType(file: File): Promise<File> {
  if (file.type) return file;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const type = imageType(head);
  if (!type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

interface ImageSignature {
  type: string;
  match: (bytes: Uint8Array) => boolean;
}

const IMAGE_SIGNATURES: readonly ImageSignature[] = [
  {
    type: "image/png",
    match: (bytes) => matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { type: "image/jpeg", match: (bytes) => matches(bytes, [0xff, 0xd8, 0xff]) },
  { type: "image/gif", match: (bytes) => matches(bytes, [0x47, 0x49, 0x46, 0x38]) },
  { type: "image/bmp", match: (bytes) => matches(bytes, [0x42, 0x4d]) },
  {
    type: "image/tiff",
    match: (bytes) =>
      matches(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
      matches(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  {
    type: "image/webp",
    match: (bytes) =>
      matches(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]),
  },
];

function imageType(bytes: Uint8Array): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.match(bytes)) return signature.type;
  }
  return null;
}

function matches(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return matchesAt(bytes, 0, prefix);
}

function matchesAt(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[offset + index] === value);
}
