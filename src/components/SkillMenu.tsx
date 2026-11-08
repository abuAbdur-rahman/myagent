import type { SkillInfo } from "../lib/api";
import { cn } from "../lib/utils";

export function SkillMenu({
  items,
  index,
  onPick,
}: {
  items: SkillInfo[];
  index: number;
  onPick: (skill: SkillInfo) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="absolute bottom-full left-2 z-10 mb-2 min-w-[260px] rounded-card bg-overlay px-2.5 py-2 text-xs text-fg-3 shadow-[var(--shadow-md)] ring-1 ring-line">
        No enabled skill matches.
      </div>
    );
  }
  return (
    <div
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-2 z-10 mb-2 w-[420px] max-w-[calc(100%-1rem)] rounded-card bg-overlay p-1 shadow-[var(--shadow-md)] ring-1 ring-line"
    >
      {items.map((skill, i) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={i === index}
          onClick={() => onPick(skill)}
          className={cn(
            "flex w-full flex-col gap-0.5 rounded-field px-2.5 py-1.5 text-left",
            i === index ? "bg-fill-2" : "hover:bg-fill-2",
          )}
        >
          <span className="flex items-baseline gap-2">
            <b className="font-mono text-[13px] text-fg">@{skill.name}</b>
            <span className="truncate text-xs text-fg-3">{skill.title}</span>
          </span>
          <span className="truncate text-xs text-fg-3">{skill.summary || skill.description}</span>
        </button>
      ))}
    </div>
  );
}
