import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/utils";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-0";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: "bg-text-primary text-vault-black hover:bg-white",
        secondary: "bg-vault-raised text-text-primary hover:bg-neutral-700",
        ghost: "text-text-muted hover:bg-vault-raised hover:text-text-primary",
        destructive: "bg-destroy text-white hover:bg-destroy-hover",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3",
        icon: "h-9 w-9",
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

const fieldBase = cn(
  "w-full rounded-control border border-vault-line bg-vault-surface px-3 text-sm text-text-primary placeholder:text-text-faint focus:border-text-faint focus:outline-none focus:ring-2 focus:ring-focus",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("h-9", fieldBase, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("resize-none py-2", fieldBase, className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn("h-9 px-2", fieldBase, className)} {...props} />
  ),
);
Select.displayName = "Select";

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl rounded-panel border border-vault-line bg-vault-black"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-vault-line px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
