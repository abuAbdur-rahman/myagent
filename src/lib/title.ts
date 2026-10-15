const MAX_TITLE = 48;

export function deriveFallbackTitle(userText: string): string {
  const cleaned = userText
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_~[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 6).join(" ");
  const candidate = words || userText.replace(/\s+/g, " ").trim();
  return (candidate || "New chat").slice(0, MAX_TITLE);
}
