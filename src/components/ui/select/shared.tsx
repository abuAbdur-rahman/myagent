import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight as ChevronRightIcon, Plus, X } from "lucide-react";
import { cn } from "../../../lib/utils";

export interface Option<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  group?: string;
}

export type Row<T extends string> =
  | { kind: "group"; key: string; label: string }
  | { kind: "option"; key: string; opt: Option<T>; index: number };

const FIELD = [
  "box-border m-0 flex w-full min-h-[var(--h)] items-center gap-2 rounded-ui border border-ui-line bg-ui-field",
  "text-left font-[inherit] leading-tight text-ui-fg transition-[border-color,box-shadow] duration-100",
  "[-webkit-tap-highlight-color:transparent]",
  "focus-visible:outline-none focus-visible:border-ui-accent focus-visible:ring-[3px] focus-visible:ring-ui-accent/25",
  "data-[open]:border-ui-accent data-[open]:ring-[3px] data-[open]:ring-ui-accent/25",
  "data-[invalid]:border-ui-danger data-[invalid]:focus-visible:border-ui-danger data-[invalid]:focus-visible:ring-ui-danger/25",
  "data-[invalid]:data-[open]:border-ui-danger data-[invalid]:data-[open]:ring-ui-danger/25",
  "disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
].join(" ");

export const fieldCls = (kind: "select" | "combo", size: "sm" | "md", extra?: string) =>
  cn(
    FIELD,
    size === "sm" ? "[--h:30px] pl-2.5 pr-1 text-[13px]" : "[--h:36px] pl-3 pr-1.5 text-sm",
    kind === "select"
      ? "group cursor-pointer [&:not([data-open]):not([data-invalid]):not(:focus-visible):not(:disabled):hover]:border-ui-line-hover"
      : "cursor-text data-[multi]:py-1 focus-within:border-ui-accent focus-within:ring-[3px] focus-within:ring-ui-accent/25 data-[invalid]:focus-within:border-ui-danger data-[invalid]:focus-within:ring-ui-danger/25 [&:not([data-invalid]):not(:focus-within):not([data-disabled]):hover]:border-ui-line-hover",
    extra,
  );

export const iconBtn =
  "inline-flex size-6 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit cursor-pointer hover:enabled:bg-ui-hover hover:enabled:text-ui-fg disabled:cursor-not-allowed";

export function buildRows<T extends string>(opts: Option<T>[]): Row<T>[] {
  const rows: Row<T>[] = [];
  let last: string | undefined;
  opts.forEach((opt, index) => {
    if (opt.group && opt.group !== last)
      rows.push({ kind: "group", key: `g${index}`, label: opt.group });
    last = opt.group;
    rows.push({ kind: "option", key: `${opt.value}:${index}`, opt, index });
  });
  return rows;
}

export function stepEnabled(opts: Option[], from: number, dir: 1 | -1): number {
  let i = from + dir;
  while (i >= 0 && i < opts.length) {
    if (!opts[i].disabled) return i;
    i += dir;
  }
  return from;
}
export const firstEnabled = (opts: Option[]) => opts.findIndex((o) => !o.disabled);
export const lastEnabled = (opts: Option[]) => {
  for (let i = opts.length - 1; i >= 0; i--) if (!opts[i].disabled) return i;
  return -1;
};

export function useControllable<V>(
  value: V | undefined,
  defaultValue: V,
  onChange?: (v: V) => void,
) {
  const [inner, setInner] = useState<V>(defaultValue);
  const controlled = value !== undefined;
  const set = useCallback(
    (v: V) => {
      if (!controlled) setInner(v);
      onChange?.(v);
    },
    [controlled, onChange],
  );
  return [controlled ? (value as V) : inner, set] as const;
}

export interface Pos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

export function useFloating(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  maxH = 300,
  gap = 6,
  width?: number,
): Pos | null {
  const [pos, setPos] = useState<Pos | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const calc = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const below = vh - r.bottom - gap - 8;
      const above = r.top - gap - 8;
      const flip = below < Math.min(maxH, 200) && above > below;
      const w = width ?? r.width;
      const next: Pos = {
        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
        width: w,
        maxHeight: Math.max(120, Math.min(maxH, flip ? above : below)),
        placement: flip ? "top" : "bottom",
        ...(flip ? { bottom: vh - r.top + gap } : { top: r.bottom + gap }),
      };
      setPos((p) => (p && JSON.stringify(p) === JSON.stringify(next) ? p : next));
    };
    calc();
    window.addEventListener("resize", calc);
    window.addEventListener("scroll", calc, true);
    return () => {
      window.removeEventListener("resize", calc);
      window.removeEventListener("scroll", calc, true);
    };
  }, [open, anchor, maxH, gap, width]);
  return pos;
}

export function Popup({ pos, children }: { pos: Pos; children: ReactNode }) {
  return createPortal(
    <div
      className="fixed z-[1000] box-border flex origin-top flex-col rounded-[12px] border border-ui-line bg-ui-popup p-1 text-sm leading-snug text-ui-fg shadow-ui animate-ui-in data-[placement=top]:origin-bottom data-[placement=top]:animate-ui-in-up motion-reduce:animate-none"
      data-placement={pos.placement}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        left: pos.left,
        width: pos.width,
        top: pos.top,
        bottom: pos.bottom,
        maxHeight: pos.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function highlight(text: string, q?: string): ReactNode {
  const needle = q?.trim().toLowerCase();
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-ui-accent/20 px-px text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

interface OptionListProps<T extends string> {
  id: string;
  rows: Row<T>[];
  active: number;
  selected: (o: Option<T>) => boolean;
  onPick: (i: number) => void;
  onActive: (i: number) => void;
  query?: string;
  multiple?: boolean;
}

export function OptionList<T extends string>(p: OptionListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const fromMouse = useRef(false);

  useEffect(() => {
    if (fromMouse.current) {
      fromMouse.current = false;
      return;
    }
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!list || !el) return;
    const prev = el.previousElementSibling as HTMLElement | null;
    const top = el.offsetTop - (prev?.classList.contains("ui-group") ? prev.offsetHeight : 0);
    const bottom = el.offsetTop + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [p.active]);

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      role="listbox"
      id={p.id}
      aria-multiselectable={p.multiple || undefined}
    >
      {p.rows.map((row) => {
        if (row.kind === "group") {
          return (
            <div
              key={row.key}
              className="ui-group px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ui-muted first:pt-1"
              role="presentation"
            >
              {row.label}
            </div>
          );
        }
        const { opt, index } = row;
        const sel = p.selected(opt);
        return (
          <div
            key={row.key}
            id={`${p.id}-o${index}`}
            role="option"
            className="group/opt flex cursor-pointer select-none items-center gap-2.5 rounded-lg py-[7px] pl-2.5 pr-2 data-[active=true]:bg-ui-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            aria-selected={sel}
            aria-disabled={opt.disabled || undefined}
            data-active={index === p.active}
            onMouseMove={() => {
              if (index !== p.active && !opt.disabled) {
                fromMouse.current = true;
                p.onActive(index);
              }
            }}
            onClick={() => !opt.disabled && p.onPick(index)}
          >
            {opt.icon && <span className="inline-flex flex-none text-ui-muted">{opt.icon}</span>}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate group-aria-selected/opt:font-semibold">
                {highlight(opt.label, p.query)}
              </span>
              {opt.description && (
                <span className="truncate text-xs text-ui-muted">{opt.description}</span>
              )}
            </span>
            {opt.hint && (
              <span className="flex-none text-xs tabular-nums text-ui-muted">{opt.hint}</span>
            )}
            <span className="inline-flex size-4 flex-none text-ui-accent">
              {sel && <CheckIcon />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Chevron({ open, className }: { open?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center transition-transform duration-150 motion-reduce:transition-none data-[open]:rotate-180",
        className,
      )}
      data-open={open || undefined}
    >
      <ChevronDown size={16} strokeWidth={1.6} aria-hidden />
    </span>
  );
}
export const CheckIcon = () => <Check size={16} strokeWidth={1.6} aria-hidden />;
export const XIcon = () => <X size={16} strokeWidth={1.6} aria-hidden />;
export const PlusIcon = () => <Plus size={16} strokeWidth={1.6} aria-hidden />;
export const ChevronRight = () => <ChevronRightIcon size={16} strokeWidth={1.6} aria-hidden />;
export const Spinner = () => (
  <span
    className="mr-1 size-3.5 animate-spin rounded-full border-2 border-ui-line-hover border-t-ui-accent"
    role="status"
    aria-label="Loading"
  />
);
