const MAX_TITLE = 48;

export function plainTitle(raw: string): string {
  return raw
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*>\s*/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.:;!]+$/, "")
    .trim();
}

function strip(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_~[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveFallbackTitle(userText: string): string {
  const cleaned = strip(userText);
  const words = cleaned.split(" ").filter(Boolean).slice(0, 6).join(" ");
  const candidate = words || cleaned || "New chat";
  if (candidate.length <= MAX_TITLE) return candidate;
  const clipped = candidate.slice(0, MAX_TITLE);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim();
}
