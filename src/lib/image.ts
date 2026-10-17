export const MAX_IMAGE_SIDE = 1568;
export const IMAGE_TURN_TRIGGER_BYTES = 25 * 1024 * 1024;
export const IMAGE_TURN_TARGET_BYTES = 15 * 1024 * 1024;

export function imageByteSize(dataUrl: string): number {
  const payload = dataUrl.split(",")[1] ?? "";
  return Math.floor(payload.length * 3 / 4);
}

export function fitImageBudget<T extends { dataUrl: string }>(
  images: T[],
  trigger = IMAGE_TURN_TRIGGER_BYTES,
  target = IMAGE_TURN_TARGET_BYTES,
): { kept: T[]; dropped: number } {
  const total = images.reduce((sum, image) => sum + imageByteSize(image.dataUrl), 0);
  if (total <= trigger) return { kept: images, dropped: 0 };
  const kept = [...images];
  let keptBytes = total;
  let dropped = 0;
  while (kept.length > 0 && keptBytes > target) {
    const oldest = kept.shift() as T;
    keptBytes -= imageByteSize(oldest.dataUrl);
    dropped += 1;
  }
  return { kept, dropped };
}

const IMAGE_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isSupportedImage(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return IMAGE_ALLOWLIST.has(base);
}

export function targetSize(
  width: number,
  height: number,
  maxSide = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface DownscaledImage {
  dataUrl: string;
  width: number;
  height: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("could not decode image"));
    image.src = url;
  });
}

export async function downscaleImage(blob: Blob): Promise<DownscaledImage> {
  const mime = blob.type.split(";")[0]?.trim().toLowerCase();
  if (!isSupportedImage(mime)) {
    throw new Error(`image type not supported in v1: ${mime || "unknown"}`);
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const size = targetSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.8), ...size };
  } finally {
    URL.revokeObjectURL(url);
  }
}
