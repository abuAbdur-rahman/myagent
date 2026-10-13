export interface ToastAction {
  label: string;
  run?: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  actions: ToastAction[];
}

let nextId = 1;
const items = new Map<number, ToastItem>();
const listeners = new Set<() => void>();
let snapshot: ToastItem[] = [];

function rebuild() {
  snapshot = [...items.values()];
}

function emit() {
  rebuild();
  listeners.forEach((listener) => listener());
}

export function toast(message: string, opts?: { actions?: ToastAction[]; ms?: number }) {
  const id = nextId++;
  const ms = opts?.ms ?? 3000;
  items.set(id, { id, message, actions: opts?.actions ?? [] });
  emit();
  setTimeout(() => {
    if (items.delete(id)) emit();
  }, ms);
  return id;
}

export function dismissToast(id: number) {
  if (items.delete(id)) emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return snapshot;
}
