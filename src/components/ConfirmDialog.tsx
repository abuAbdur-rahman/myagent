import { useEffect, useState } from "react";
import { Button } from "./ui";

interface ConfirmOpts {
  title: string;
  body?: string;
  ok?: string;
  danger?: boolean;
}

interface PendingConfirm {
  opts: ConfirmOpts;
  resolve: (value: boolean) => void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    pending = { opts, resolve };
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): PendingConfirm | null {
  return pending;
}

function settle(value: boolean) {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(value);
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);

  useEffect(
    () =>
      subscribe(() => {
        setCurrent(snapshot());
      }),
    [],
  );

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      if (e.key === "Enter") settle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;
  const { opts } = current;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        className="w-full max-w-[480px] rounded-composer border border-border bg-surface p-5 shadow-[var(--shadow)]"
      >
        <h3 className="m-0 text-base font-semibold">{opts.title}</h3>
        {opts.body && <p className="m-0 mt-1 text-sm text-muted">{opts.body}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="default" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button variant={opts.danger ? "dangerFill" : "primary"} onClick={() => settle(true)}>
            {opts.ok ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
