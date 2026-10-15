import { cn } from "../lib/utils";

export function Logo({
  size,
  className,
  alt = "MyAgent logo",
}: {
  size: number;
  className?: string;
  alt?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label={alt}
      className={cn("flex-none", className)}
      style={{ width: size, height: size }}
    >
      <rect x="8" y="8" width="240" height="240" rx="56" fill="var(--color-accent)" />
      <path
        d="M169 85 A64 64 0 1 0 169 167"
        fill="none"
        stroke="var(--color-accent-contrast)"
        strokeWidth="24"
        strokeLinecap="round"
      />
      <path
        d="M62 168 L104 186 L56 214 Z"
        fill="var(--color-accent-contrast)"
        stroke="var(--color-accent-contrast)"
        strokeWidth="12"
        strokeLinejoin="round"
      />
      <circle cx="176" cy="128" r="13" fill="var(--color-accent-contrast)" />
    </svg>
  );
}
