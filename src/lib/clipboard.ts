export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export interface ClipboardDataLike {
  files: ArrayLike<File>;
  items: ArrayLike<ClipboardItemLike>;
}

export function clipboardFiles(data: ClipboardDataLike): File[] {
  const files: File[] = [];
  for (let index = 0; index < data.files.length; index += 1) {
    files.push(data.files[index]);
  }
  if (files.some((file) => file.type)) return files;
  const images: File[] = [];
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) images.push(file);
  }
  return images.length > 0 ? images : files;
}

export function pastedImageName(file: File, index: number): string {
  if (file.name.trim()) return file.name;
  const subtype = file.type.split("/")[1]?.split("+")[0] || "png";
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  return `pasted-image-${index + 1}.${extension}`;
}
