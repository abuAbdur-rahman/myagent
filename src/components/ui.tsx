import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/utils";
import { useFocusTrap } from "../lib/useFocusTrap";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-field text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
    focusRing,
  ),
  {
    variants: {
      variant: {
        default:
          "bg-fill-2 text-fg shadow-[inset_0_0_0_1px_var(--line)] hover:bg-fill-3",
        secondary:
          "bg-fill-2 text-fg shadow-[inset_0_0_0_1px_var(--line)] hover:bg-fill-3",
        primary:
          "bg-accent text-accent-contrast hover:bg-[var(--accent-solid-hover)]",
        ghost: "text-fg-2 hover:bg-fill-2 hover:text-fg",
        danger: "text-danger hover:bg-danger-soft",
        dangerFill: "bg-danger text-on-danger hover:brightness-95",
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
        "grid flex-none place-items-center rounded-field transition-colors hover:bg-fill-2 hover:text-fg",
        dims,
        active ? "bg-fill-3 text-fg" : "text-fg-2",
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
  "w-full rounded-field bg-fill-1 text-sm text-fg shadow-[inset_0_0_0_1px_var(--line)]",
  "px-2.5 placeholder:text-fg-3 focus:outline-none",
  "focus:shadow-[inset_0_0_0_1px_var(--accent-line),0_0_0_3px_var(--accent-ring)]",
  "disabled:opacity-45",
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
  <textarea ref={ref} className={cn("py-2 leading-relaxed", fieldBase, className)} {...props} />
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
        "relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors",
        checked
          ? "bg-accent"
          : "bg-fill-3 shadow-[inset_0_0_0_1px_var(--line)]",
        focusRing,
        disabled && "opacity-45",
      )}
    >
      <span
        className={cn(
          "ml-0.5 block h-4 w-4 rounded-full transition-transform",
          checked ? "translate-x-4 bg-white" : "bg-fg-2",
        )}
      />
    </button>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-chip bg-fill-2 px-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type PillTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

const pillTone: Record<PillTone, string> = {
  neutral: "bg-fill-2 text-fg-2",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warn: "bg-[var(--warning-soft)] text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-[var(--info-soft)] text-info",
};

export function Pill({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: PillTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 text-xs font-medium",
        pillTone[tone],
        className,
      )}
    >
      {icon}
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

function segmentedTone(active: boolean, tone: "default" | "policy", value: string): string {
  if (!active) return "text-fg-3 hover:text-fg";
  if (tone === "policy" && value === "allow") return "bg-success-soft text-success";
  if (tone === "policy" && (value === "block" || value === "deny")) {
    return "bg-danger-soft text-danger";
  }
  return "bg-overlay text-fg shadow-sm shadow-[inset_0_0_0_1px_var(--line-subtle)]";
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  tone = "default",
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  tone?: "default" | "policy";
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
        "inline-flex flex-none gap-0.5 rounded-field bg-fill-2 p-0.5",
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
              "h-6 rounded-chip px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
              segmentedTone(active, tone, option.value),
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

export function Avatar({
  initials,
  size = 28,
  muted,
}: {
  initials: string;
  size?: number;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid flex-none place-items-center rounded-full font-semibold",
        muted ? "bg-fill-2 text-fg-2" : "bg-accent-soft text-accent-text",
      )}
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
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent-text"
    />
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-fg-3">{icon}</div>}
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {body && <p className="m-0 max-w-sm text-[13px] text-fg-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
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
  useFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--scrim)] p-4 backdrop-blur-[3px]"
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
          "flex max-h-[86vh] w-full flex-col overflow-hidden rounded-composer bg-overlay shadow-[var(--shadow-lg)] ring-1 ring-line-strong",
          wide ? "max-w-[900px]" : "max-w-[480px]",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 flex-none items-center justify-between border-b border-line-subtle px-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" size={28} onClick={onClose}>
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
