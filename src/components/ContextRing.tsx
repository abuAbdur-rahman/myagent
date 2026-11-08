export function ContextRing({
  pct,
  size = 18,
  warn,
}: {
  pct: number | null;
  size?: number;
  warn?: boolean;
}) {
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="-rotate-90"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={warn ? "var(--warning)" : "var(--accent-solid)"}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 180ms ease-out" }}
      />
    </svg>
  );
}
