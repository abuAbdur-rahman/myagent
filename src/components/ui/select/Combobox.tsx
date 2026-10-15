import {
  useEffect,
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
  PlusIcon,
  fieldCls,
  iconBtn,
  Popup,
  Spinner,
  XIcon,
  buildRows,
  firstEnabled,
  stepEnabled,
  useFloating,
  type Option,
} from "./shared";

const CREATE = "\u0000create";

interface Base<T extends string> {
  options: Option<T>[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
  size?: "sm" | "md";
  name?: string;
  id?: string;
  className?: string;
  leading?: ReactNode;
  emptyText?: string;
  filter?: ((option: Option<T>, query: string) => boolean) | false;
  onQueryChange?: (query: string) => void;
  creatable?: boolean;
  onCreate?: (label: string) => Option<T> | void;
  clearable?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}
type Single<T extends string> = {
  multiple?: false;
  value?: T | null;
  defaultValue?: T | null;
  onChange?: (v: T | null) => void;
};
type Multi<T extends string> = {
  multiple: true;
  value?: T[];
  defaultValue?: T[];
  onChange?: (v: T[]) => void;
};
export type ComboboxProps<T extends string = string> = Base<T> & (Single<T> | Multi<T>);

const toArr = <T,>(v: T | T[] | null | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
const defaultFilter = <T extends string>(o: Option<T>, q: string) => {
  const n = q.toLowerCase();
  return o.label.toLowerCase().includes(n) || !!o.description?.toLowerCase().includes(n);
};

export function Combobox<T extends string = string>(props: ComboboxProps<T>) {
  const {
    options,
    placeholder = "Search…",
    disabled,
    invalid,
    loading,
    size = "md",
    name,
    id,
    className,
    leading,
    emptyText = "No results",
    filter,
    onQueryChange,
    creatable,
    onCreate,
    clearable = true,
  } = props;
  const multi = props.multiple === true;

  const [inner, setInner] = useState<T[]>(() =>
    toArr(props.defaultValue as T | T[] | null | undefined),
  );
  const controlled = props.value !== undefined;
  const values = controlled ? toArr(props.value as T | T[] | null) : inner;
  const commit = (next: T[]) => {
    if (!controlled) setInner(next);
    if (props.multiple === true) props.onChange?.(next);
    else (props.onChange as ((v: T | null) => void) | undefined)?.(next[0] ?? null);
  };

  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const labels = useRef(new Map<string, string>());
  options.forEach((o) => labels.current.set(o.value, o.label));
  const labelOf = (v: string) => labels.current.get(v) ?? v;

  const q = (query ?? "").trim();
  const picked = useMemo(() => new Set<string>(values), [values]);

  const visible = useMemo(() => {
    let list = options;
    if (q && filter !== false) {
      const f = filter ?? defaultFilter;
      list = options.filter((o) => f(o, q));
    }
    if (creatable && q && !options.some((o) => o.label.toLowerCase() === q.toLowerCase())) {
      list = [...list, { value: CREATE as T, label: `Create “${q}”`, icon: <PlusIcon /> }];
    }
    return list;
  }, [options, q, filter, creatable]);
  const rows = useMemo(() => buildRows(visible), [visible]);
  const pos = useFloating(open, wrap);

  useEffect(() => {
    if (!open) return;
    const sel = !multi && !q ? visible.findIndex((o) => picked.has(o.value)) : -1;
    setActive(sel >= 0 ? sel : firstEnabled(visible));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, visible.length]);

  const inputValue = query ?? (multi ? "" : values[0] ? labelOf(values[0]) : "");

  const setText = (v: string | null) => {
    setQuery(v);
    onQueryChange?.(v ?? "");
  };
  const pickValue = (v: T) => {
    if (multi) {
      commit(picked.has(v) ? values.filter((x) => x !== v) : [...values, v]);
      setText("");
    } else {
      commit([v]);
      setText(null);
      setOpen(false);
    }
  };
  const pick = (i: number) => {
    const o = visible[i];
    if (!o || o.disabled) return;
    if (o.value === CREATE) {
      const made = onCreate?.(q);
      if (made) pickValue(made.value);
      else {
        setText(multi ? "" : null);
        if (!multi) setOpen(false);
      }
      return;
    }
    pickValue(o.value);
  };
  const reset = () => {
    setOpen(false);
    setText(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive(stepEnabled(visible, active, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive(stepEnabled(visible, active, -1));
        break;
      case "Enter":
        if (open && active >= 0) {
          e.preventDefault();
          pick(active);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          reset();
        }
        break;
      case "Backspace":
        if (multi && !inputValue && values.length) commit(values.slice(0, -1));
        break;
      case "Tab":
        reset();
        break;
    }
  };

  const hasValue = values.length > 0;
  const showClear = clearable && !disabled && (hasValue || !!query);

  return (
    <>
      <div
        ref={wrap}
        className={fieldCls("combo", size, className)}
        data-size={size}
        data-open={open || undefined}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-multi={multi || undefined}
        onMouseDown={(e) => {
          if (disabled) return;
          if (e.target !== input.current) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
        onClick={() => !disabled && setOpen(true)}
        onBlur={(e) => {
          if (!wrap.current?.contains(e.relatedTarget as Node | null)) reset();
        }}
      >
        {leading && <span className="inline-flex text-ui-muted">{leading}</span>}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {multi &&
            values.map((v) => (
              <span
                key={v}
                className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-[7px] border border-ui-line bg-ui-hover pl-2 pr-0.5 text-[12.5px]"
              >
                <span className="truncate">{labelOf(v)}</span>
                {!disabled && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-ui-muted hover:bg-ui-accent/20 hover:text-ui-fg [&_svg]:size-3"
                    aria-label={`Remove ${labelOf(v)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(values.filter((x) => x !== v));
                    }}
                  >
                    <XIcon />
                  </button>
                )}
              </span>
            ))}
          <input
            ref={input}
            id={id}
            className={`m-0 min-w-[72px] flex-1 truncate border-0 bg-transparent p-0 font-[inherit] text-inherit outline-none placeholder:text-ui-muted disabled:cursor-not-allowed ${multi ? "h-6" : "h-[calc(var(--h)-2px)]"}`}
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={inputValue}
            placeholder={multi && hasValue ? "" : placeholder}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${listId}-o${active}` : undefined}
            aria-invalid={invalid || undefined}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={(e) => {
              if (!multi) e.target.select();
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <span className="inline-flex flex-none items-center gap-0.5 text-ui-muted">
          {loading && <Spinner />}
          {showClear && (
            <button
              type="button"
              tabIndex={-1}
              className={iconBtn}
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                commit([]);
                setText(null);
                input.current?.focus();
              }}
            >
              <XIcon />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            className={iconBtn}
            aria-label={open ? "Close list" : "Open list"}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
              input.current?.focus();
            }}
          >
            <Chevron open={open} />
          </button>
        </span>
      </div>

      {name && values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}

      {open && pos && (
        <Popup pos={pos}>
          {visible.length === 0 ? (
            <div className="px-2.5 py-3.5 text-center text-[13px] text-ui-muted">
              {loading ? "Searching…" : emptyText}
            </div>
          ) : (
            <OptionList
              id={listId}
              rows={rows}
              active={active}
              selected={(o) => picked.has(o.value)}
              onPick={pick}
              onActive={setActive}
              query={q}
              multiple={multi}
            />
          )}
        </Popup>
      )}
    </>
  );
}
