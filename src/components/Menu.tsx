import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

interface MenuState {
  content: ReactNode;
  x: number;
  y: number;
  width: number;
}

let current: MenuState | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function showMenu(
  anchor: HTMLElement,
  content: ReactNode,
  opts?: { align?: "left" | "right"; above?: boolean; width?: number },
) {
  closeMenu();
  const rect = anchor.getBoundingClientRect();
  const width = opts?.width ?? 240;
  let x = opts?.align === "right" ? rect.right - width : rect.left;
  x = Math.min(Math.max(8, x), window.innerWidth - width - 8);
  let y = rect.bottom + 4;
  if (opts?.above || rect.bottom + 320 > window.innerHeight) {
    y = Math.max(8, rect.top - 4 - 320);
  }
  current = { content, x, y, width };
  emit();
}

function closeMenu() {
  if (!current) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function MenuHost() {
  const [state, setState] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => subscribe(() => setState(current)), []);

  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const el = ref.current;
    const overRight = el.getBoundingClientRect().right - window.innerWidth;
    if (overRight > 0) {
      el.style.left = `${Math.max(8, state.x - overRight - 8)}px`;
    }
  }, [state]);

  useLayoutEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[200] min-w-[180px] max-w-[320px] rounded-card border border-border bg-surface p-1 shadow-[var(--shadow)]"
      style={{ left: state.x, top: state.y, width: state.width }}
    >
      {state.content}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  danger,
  onSelect,
}: {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        closeMenu();
        onSelect();
      }}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-[13px] hover:bg-active",
        danger ? "text-danger" : "text-text",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <hr className="my-1 border-0 border-t border-border" />;
}
