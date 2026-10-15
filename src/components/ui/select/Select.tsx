import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Chevron,
  OptionList,
  fieldCls,
  Popup,
  Spinner,
  buildRows,
  firstEnabled,
  lastEnabled,
  stepEnabled,
  useControllable,
  useFloating,
  type Option,
} from "./shared";

export interface SelectProps<T extends string = string> {
  options: Option<T>[];
  value?: T | null;
  defaultValue?: T | null;
  onChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
  size?: "sm" | "md";
  name?: string;
  id?: string;
  className?: string;
  leading?: ReactNode;
  renderValue?: (option: Option<T>) => ReactNode;
  emptyText?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function Select<T extends string = string>({
  options,
  value,
  defaultValue = null,
  onChange,
  placeholder = "Select…",
  disabled,
  invalid,
  loading,
  size = "md",
  name,
  id,
  className,
  leading,
  renderValue,
  emptyText = "No options",
  title,
  ...aria
}: SelectProps<T>) {
  const [current, setCurrent] = useControllable<T | null>(
    value,
    defaultValue,
    onChange as (v: T | null) => void,
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const type = useRef({ s: "", t: 0 });
  const uid = useId();
  const listId = `${uid}-list`;

  const rows = useMemo(() => buildRows(options), [options]);
  const selIndex = options.findIndex((o) => o.value === current);
  const selected = selIndex >= 0 ? options[selIndex] : undefined;
  const pos = useFloating(open, trigger);

  const openList = (at?: number) => {
    if (disabled) return;
    setActive(at ?? (selIndex >= 0 ? selIndex : firstEnabled(options)));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    setCurrent(o.value);
    setOpen(false);
  };

  const typeahead = (ch: string): number => {
    window.clearTimeout(type.current.t);
    type.current.s += ch.toLowerCase();
    type.current.t = window.setTimeout(() => (type.current.s = ""), 600);
    const s = type.current.s;
    const n = options.length;
    const start = s.length === 1 ? active + 1 : Math.max(active, 0);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (!options[i].disabled && options[i].label.toLowerCase().startsWith(s)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.nativeEvent.isComposing) return;
    const k = e.key;
    const printable =
      k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (k !== " " || !!type.current.s);
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        openList(k === "ArrowUp" && selIndex < 0 ? lastEnabled(options) : undefined);
      } else if (printable) {
        const i = typeahead(k);
        if (i >= 0) openList(i);
      }
      return;
    }
    switch (k) {
      case "ArrowDown":
        e.preventDefault();
        setActive(stepEnabled(options, active, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(stepEnabled(options, active, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(firstEnabled(options));
        break;
      case "End":
        e.preventDefault();
        setActive(lastEnabled(options));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (active >= 0) pick(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (printable) {
          const i = typeahead(k);
          if (i >= 0) setActive(i);
        }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className={fieldCls("select", size, className)}
        data-size={size}
        data-open={open || undefined}
        data-invalid={invalid || undefined}
        data-empty={!selected || undefined}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-o${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        onClick={() => (open ? setOpen(false) : openList())}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      >
        {leading && <span className="inline-flex text-ui-muted">{leading}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected ? (
            renderValue ? (
              renderValue(selected)
            ) : (
              <>
                {selected.icon && (
                  <span className="inline-flex flex-none text-ui-muted">{selected.icon}</span>
                )}
                <span className="truncate">{selected.label}</span>
              </>
            )
          ) : (
            <span className="truncate text-ui-muted">{placeholder}</span>
          )}
        </span>
        <span className="inline-flex flex-none items-center gap-0.5 text-ui-muted">
          {loading && <Spinner />}
          <Chevron open={open} className="group-hover:text-ui-fg group-data-[open]:text-ui-fg" />
        </span>
      </button>

      {name && <input type="hidden" name={name} value={current ?? ""} />}

      {open && pos && (
        <Popup pos={pos}>
          {options.length === 0 ? (
            <div className="px-2.5 py-3.5 text-center text-[13px] text-ui-muted">
              {loading ? "Loading…" : emptyText}
            </div>
          ) : (
            <OptionList
              id={listId}
              rows={rows}
              active={active}
              selected={(o) => o.value === current}
              onPick={pick}
              onActive={setActive}
            />
          )}
        </Popup>
      )}
    </>
  );
}
