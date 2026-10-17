import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/utils";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0";

const buttonVariants = cva(
  cn(
    "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: "border-border bg-surface hover:bg-hover",
        primary: "border-accent bg-accent text-accent-contrast hover:brightness-110",
        ghost: "border-transparent text-muted hover:bg-hover hover:text-text",
        danger: "border-danger text-danger hover:bg-hover",
        dangerFill: "border-danger bg-danger text-white hover:brightness-110",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    title?: string;
    size?: 32 | 28 | 24;
    active?: boolean;
  }
>(({ className, label, title, size = 32, active, children, ...props }, ref) => {
  const dims = size === 24 ? "h-6 w-6" : size === 28 ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={title ?? label}
      className={cn(
        "grid flex-none place-items-center rounded-control transition-colors hover:bg-hover",
        dims,
        active ? "text-accent" : "text-muted",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
IconButton.displayName = "IconButton";

const fieldBase = cn(
  "w-full rounded-card border border-border bg-surface-2 px-2.5 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("h-8", fieldBase, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("py-2", fieldBase, className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-10 flex-none items-center rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-border bg-active",
        focusRing,
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "ml-0.5 block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("rounded bg-hover px-1.5 py-px text-[11px] text-muted", className)}
    >
      {children}
    </span>
  );
}

export type PillTone = "neutral" | "accent" | "success" | "warn" | "danger";

const pillTone: Record<PillTone, string> = {
  neutral: "border-border text-muted",
  accent: "border-accent text-accent",
  success: "border-success text-success",
  warn: "border-warn text-warn",
  danger: "border-danger text-danger",
};

export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center gap-1 rounded-full border px-2 text-[11px] font-medium",
        pillTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const SEGMENT_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

function segmentedTabIndex(active: boolean, index: number, position: number): number {
  if (active) return 0;
  return index < 0 && position === 0 ? 0 : -1;
}

function segmentedTone(active: boolean): string {
  return active ? "bg-active font-semibold text-text" : "text-muted hover:bg-hover";
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const index = options.findIndex((option) => option.value === value);
  const move = (step: number) => {
    if (options.length === 0) return;
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex flex-none rounded-control border border-border p-0.5",
        className,
      )}
    >
      {options.map((option, position) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={segmentedTabIndex(active, index, position)}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const step = SEGMENT_STEPS[event.key];
              if (!step) return;
              event.preventDefault();
              move(step);
            }}
            className={cn(
              "h-6 rounded-control px-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
              segmentedTone(active),
              focusRing,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Avatar({ initials, size = 28 }: { initials: string; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full bg-accent font-semibold text-accent-contrast"
      style={{ width: size, height: size, fontSize: size <= 22 ? 10 : 12 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent"
    />
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  noBackdropClose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  noBackdropClose?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !noBackdropClose) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-composer border border-border bg-surface shadow-[var(--shadow)]",
          wide ? "max-w-[960px]" : "max-w-[480px]",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" size={24} onClick={onClose}>
            <CloseGlyph />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
