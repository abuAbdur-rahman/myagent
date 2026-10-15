import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRight, useControllable } from "./shared";
import { cn } from "../../../lib/utils";

interface ItemBase {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  keepOpen?: boolean;
}
export interface MenuAction extends ItemBase {
  type?: "item";
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  onSelect?: () => void;
}
export interface MenuCheckbox extends ItemBase {
  type: "checkbox";
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  shortcut?: string;
}
export interface MenuRadioGroup {
  type: "radio-group";
  id: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
    shortcut?: string;
  }[];
}
export interface MenuLabel {
  type: "label";
  id?: string;
  label: string;
  plain?: boolean;
}
export interface MenuSeparator {
  type: "separator";
  id?: string;
}
export interface MenuSub extends Omit<ItemBase, "keepOpen"> {
  type: "submenu";
  icon?: ReactNode;
  items: MenuEntry[];
}
export type MenuEntry =
  | MenuAction
  | MenuCheckbox
  | MenuRadioGroup
  | MenuLabel
  | MenuSeparator
  | MenuSub;

export interface DropdownMenuProps {
  trigger: ReactElement;
  items: MenuEntry[];
  align?: "start" | "end";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

type Row =
  | { kind: "sep"; key: string }
  | { kind: "label"; key: string; label: string; plain?: boolean }
  | { kind: "item"; key: string; e: MenuAction }
  | { kind: "check"; key: string; e: MenuCheckbox }
  | {
      kind: "radio";
      key: string;
      g: MenuRadioGroup;
      o: MenuRadioGroup["options"][number];
    }
  | { kind: "sub"; key: string; e: MenuSub };

function toRows(items: MenuEntry[]): Row[] {
  const rows: Row[] = [];
  items.forEach((e, i) => {
    const k = `${("id" in e && e.id) || e.type}-${i}`;
    switch (e.type) {
      case "separator":
        rows.push({ kind: "sep", key: k });
        break;
      case "label":
        rows.push({ kind: "label", key: k, label: e.label, plain: e.plain });
        break;
      case "checkbox":
        rows.push({ kind: "check", key: k, e });
        break;
      case "submenu":
        rows.push({ kind: "sub", key: k, e });
        break;
      case "radio-group":
        if (e.label) rows.push({ kind: "label", key: `${k}-l`, label: e.label });
        e.options.forEach((o) => rows.push({ kind: "radio", key: `${k}-${o.value}`, g: e, o }));
        break;
      default:
        rows.push({ kind: "item", key: k, e });
    }
  });
  return rows;
}

function useMenuPos(
  anchor: HTMLElement | null,
  popup: RefObject<HTMLDivElement | null>,
  side: "bottom" | "right",
  align: "start" | "end",
) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const calc = () => {
      const el = popup.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.scrollHeight + 2;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left: number;
      let top: number;
      let maxHeight = vh - 16;
      if (side === "bottom") {
        left = align === "end" ? r.right - w : r.left;
        top = r.bottom + 6;
        if (top + h > vh - 8) {
          const room = r.top - 6 - 8;
          if (room > vh - top - 8) {
            top = Math.max(8, r.top - 6 - h);
            maxHeight = Math.min(h, room);
          } else maxHeight = vh - top - 8;
        }
      } else {
        left = r.right + 2;
        if (left + w > vw - 8) left = r.left - w - 2;
        top = r.top - 5;
        if (top + h > vh - 8) top = Math.max(8, vh - 8 - h);
      }
      left = Math.max(8, Math.min(left, vw - w - 8));
      const next: CSSProperties = { left, top, maxHeight };
      setPos((p) =>
        p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight
          ? p
          : next,
      );
    };
    calc();
    const onScroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) calc();
    };
    window.addEventListener("resize", calc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", calc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, popup, side, align]);
  return pos;
}

const ITEM =
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-lg py-[7px] pl-2.5 pr-2 text-sm leading-snug outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
const ITEM_NORMAL = "text-ui-fg focus:bg-ui-hover aria-expanded:bg-ui-hover";
const ITEM_DANGER = "text-ui-danger focus:bg-ui-danger/10 aria-expanded:bg-ui-danger/10";
const SLOT = "inline-flex size-4 flex-none items-center justify-center text-ui-muted";

interface PanelProps {
  rows: Row[];
  anchor: HTMLElement | null;
  side: "bottom" | "right";
  align: "start" | "end";
  focusOn: "first" | "last" | "panel";
  className?: string;
  label?: string;
  onCloseAll: () => void;
  onCloseSelf?: () => void;
  onPointerEnter?: () => void;
}

function MenuPanel({
  rows,
  anchor,
  side,
  align,
  focusOn,
  className,
  label,
  onCloseAll,
  onCloseSelf,
  onPointerEnter,
}: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useMenuPos(anchor, ref, side, align);
  const [sub, setSub] = useState<{ key: string; focus: "first" | "panel" } | null>(null);
  const [subAnchor, setSubAnchor] = useState<HTMLElement | null>(null);
  const timers = useRef({ open: 0, close: 0 });
  const typed = useRef({ s: "", t: 0 });
  const indicator = rows.some((r) => r.kind === "check" || r.kind === "radio");

  const items = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[data-mi]:not([aria-disabled="true"])') ?? [],
    );

  useEffect(() => {
    if (!pos) return;
    const list = items();
    const target =
      focusOn === "first" ? list[0] : focusOn === "last" ? list[list.length - 1] : ref.current;
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!pos]);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.open);
      window.clearTimeout(timers.current.close);
    },
    [],
  );

  const openSub = (key: string, el: HTMLElement, focus: "first" | "panel") => {
    window.clearTimeout(timers.current.close);
    setSubAnchor(el);
    setSub({ key, focus });
  };
  const closeSubLater = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => setSub(null), 160);
  };

  const move = (dir: 1 | -1 | "first" | "last") => {
    const list = items();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    let i: number;
    if (dir === "first") i = 0;
    else if (dir === "last") i = list.length - 1;
    else
      i = at < 0 ? (dir === 1 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    list[i].focus({ preventScroll: false });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    const k = e.key;
    const cur = document.activeElement as HTMLElement | null;
    if (k === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (k === "Home") {
      e.preventDefault();
      move("first");
    } else if (k === "End") {
      e.preventDefault();
      move("last");
    } else if (k === "Enter" || k === " ") {
      if (cur?.hasAttribute("data-mi")) {
        e.preventDefault();
        cur.click();
      }
    } else if (k === "ArrowRight") {
      if (cur?.getAttribute("aria-haspopup") === "menu") {
        e.preventDefault();
        cur.click();
      }
    } else if (k === "ArrowLeft") {
      if (onCloseSelf) {
        e.preventDefault();
        onCloseSelf();
      }
    } else if (k === "Escape") {
      e.preventDefault();
      onCloseSelf ? onCloseSelf() : onCloseAll();
    } else if (k === "Tab") {
      e.preventDefault();
      onCloseAll();
    } else if (
      k.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (k !== " " || typed.current.s)
    ) {
      window.clearTimeout(typed.current.t);
      typed.current.s += k.toLowerCase();
      typed.current.t = window.setTimeout(() => (typed.current.s = ""), 600);
      const list = items();
      const start =
        typed.current.s.length === 1
          ? list.indexOf(cur as HTMLElement) + 1
          : Math.max(list.indexOf(cur as HTMLElement), 0);
      for (let n = 0; n < list.length; n++) {
        const el = list[(start + n) % list.length];
        if ((el.getAttribute("data-label") ?? "").toLowerCase().startsWith(typed.current.s)) {
          el.focus();
          break;
        }
      }
    }
  };

  const choose = (keepOpen: boolean | undefined, fn?: () => void) => {
    fn?.();
    if (!keepOpen) onCloseAll();
  };

  const hover = (e: { currentTarget: HTMLElement }) => {
    const el = e.currentTarget;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  };

  const lead = (node: ReactNode) => <span className={SLOT}>{node}</span>;

  const body = (labelText: string, description?: string) => (
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="truncate">{labelText}</span>
      {description && <span className="truncate text-xs text-ui-muted">{description}</span>}
    </span>
  );
  const keys = (s?: string) =>
    s && <span className="flex-none pl-4 text-xs tabular-nums text-ui-muted">{s}</span>;

  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        tabIndex={-1}
        data-ui-menu=""
        data-side={side}
        onKeyDown={onKeyDown}
        onPointerEnter={onPointerEnter}
        style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
        className={cn(
          "fixed z-[1010] box-border min-w-[11rem] max-w-[min(22rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-[12px] border border-ui-line bg-ui-popup p-1 text-ui-fg shadow-ui outline-none animate-ui-in motion-reduce:animate-none [scrollbar-width:thin]",
          className,
        )}
      >
        {rows.map((r) => {
          switch (r.kind) {
            case "sep":
              return <div key={r.key} role="separator" className="-mx-1 my-1 h-px bg-ui-line" />;
            case "label":
              return (
                <div
                  key={r.key}
                  role="presentation"
                  className={cn(
                    "px-2.5 pb-1 pt-2 text-ui-muted first:pt-1",
                    r.plain
                      ? "truncate text-xs"
                      : "text-[11px] font-semibold uppercase tracking-wider",
                  )}
                >
                  {r.label}
                </div>
              );
            case "item": {
              const e = r.e;
              return (
                <div
                  key={r.key}
                  role="menuitem"
                  tabIndex={-1}
                  data-mi=""
                  data-label={e.label}
                  aria-disabled={e.disabled || undefined}
                  className={cn(ITEM, e.danger ? ITEM_DANGER : ITEM_NORMAL)}
                  onPointerMove={hover}
                  onPointerEnter={closeSubLater}
                  onClick={() => !e.disabled && choose(e.keepOpen, e.onSelect)}
                >
                  {e.icon ? lead(e.icon) : indicator && lead(null)}
                  {body(e.label, e.description)}
                  {keys(e.shortcut)}
                </div>
              );
            }
            case "check": {
              const e = r.e;
              return (
                <div
                  key={r.key}
                  role="menuitemcheckbox"
                  tabIndex={-1}
                  data-mi=""
                  data-label={e.label}
                  aria-checked={e.checked}
                  aria-disabled={e.disabled || undefined}
                  className={cn(ITEM, ITEM_NORMAL)}
                  onPointerMove={hover}
                  onPointerEnter={closeSubLater}
                  onClick={() =>
                    !e.disabled && choose(e.keepOpen, () => e.onCheckedChange(!e.checked))
                  }
                >
                  <span className={cn(SLOT, "text-ui-accent")}>{e.checked && <CheckIcon />}</span>
                  {body(e.label, e.description)}
                  {keys(e.shortcut)}
                </div>
              );
            }
            case "radio": {
              const { g, o } = r;
              const on = g.value === o.value;
              return (
                <div
                  key={r.key}
                  role="menuitemradio"
                  tabIndex={-1}
                  data-mi=""
                  data-label={o.label}
                  aria-checked={on}
                  aria-disabled={o.disabled || undefined}
                  className={cn(ITEM, ITEM_NORMAL)}
                  onPointerMove={hover}
                  onPointerEnter={closeSubLater}
                  onClick={() => !o.disabled && choose(false, () => g.onValueChange(o.value))}
                >
                  <span className={SLOT}>
                    {on && <span className="size-1.5 rounded-full bg-ui-accent" />}
                  </span>
                  {body(o.label, o.description)}
                  {keys(o.shortcut)}
                </div>
              );
            }
            case "sub": {
              const e = r.e;
              const isOpen = sub?.key === r.key;
              return (
                <div
                  key={r.key}
                  role="menuitem"
                  tabIndex={-1}
                  data-mi=""
                  data-label={e.label}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-disabled={e.disabled || undefined}
                  className={cn(ITEM, ITEM_NORMAL)}
                  onPointerMove={hover}
                  onPointerEnter={(ev) => {
                    if (e.disabled) return;
                    const el = ev.currentTarget;
                    window.clearTimeout(timers.current.close);
                    window.clearTimeout(timers.current.open);
                    if (!isOpen)
                      timers.current.open = window.setTimeout(
                        () => openSub(r.key, el, "panel"),
                        110,
                      );
                  }}
                  onClick={(ev) => {
                    if (!e.disabled) openSub(r.key, ev.currentTarget, "first");
                  }}
                >
                  {e.icon ? lead(e.icon) : indicator && lead(null)}
                  {body(e.label, e.description)}
                  <span className="inline-flex flex-none text-ui-muted">
                    <ChevronRight />
                  </span>
                </div>
              );
            }
          }
        })}
      </div>
      {sub &&
        (() => {
          const row = rows.find((x) => x.key === sub.key);
          if (!row || row.kind !== "sub") return null;
          return (
            <MenuPanel
              key={sub.key}
              rows={toRows(row.e.items)}
              anchor={subAnchor}
              side="right"
              align="start"
              focusOn={sub.focus === "first" ? "first" : "panel"}
              label={row.e.label}
              onCloseAll={onCloseAll}
              onCloseSelf={() => {
                setSub(null);
                subAnchor?.focus();
              }}
              onPointerEnter={() => window.clearTimeout(timers.current.close)}
            />
          );
        })()}
    </>,
    document.body,
  );
}

export function DropdownMenu({
  trigger,
  items,
  align = "start",
  open,
  defaultOpen = false,
  onOpenChange,
  disabled,
  className,
  ...aria
}: DropdownMenuProps) {
  const [isOpen, setOpen] = useControllable<boolean>(open, defaultOpen, onOpenChange);
  const [via, setVia] = useState<"pointer" | "first" | "last">("pointer");
  const [el, setEl] = useState<HTMLElement | null>(null);
  const rows = useMemo(() => toRows(items), [items]);
  const only = Children.only(trigger);
  if (!isValidElement(only)) throw new Error("DropdownMenu: trigger must be a single element");
  const tp = only.props as {
    onClick?: (e: unknown) => void;
    onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  };

  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) el?.focus();
    },
    [setOpen, el],
  );

  useEffect(() => {
    if (!isOpen) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest("[data-ui-menu]") || el?.contains(t)) return;
      setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", blur);
    };
  }, [isOpen, el, setOpen]);

  const triggerEl = cloneElement(only as ReactElement<Record<string, unknown>>, {
    ref: setEl,
    "aria-haspopup": "menu",
    "aria-expanded": isOpen,
    "data-open": isOpen || undefined,
    disabled: disabled || (only.props as { disabled?: boolean }).disabled,
    onClick: (e: unknown) => {
      tp.onClick?.(e);
      if (disabled) return;
      if (!isOpen) setVia("pointer");
      setOpen(!isOpen);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      tp.onKeyDown?.(e);
      if (disabled || e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setVia(e.key === "ArrowUp" ? "last" : "first");
        setOpen(true);
      } else if ((e.key === "Enter" || e.key === " ") && !isOpen) {
        setVia("first");
      }
    },
  });

  return (
    <>
      {triggerEl}
      {isOpen && el && (
        <MenuPanel
          rows={rows}
          anchor={el}
          side="bottom"
          align={align}
          focusOn={via === "pointer" ? "panel" : via}
          className={className}
          label={aria["aria-label"]}
          onCloseAll={() => close(true)}
        />
      )}
    </>
  );
}
