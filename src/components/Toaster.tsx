import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts } from "../lib/toast";

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[300] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-center gap-3 rounded-card bg-overlay px-3.5 py-2 text-[13px] text-fg shadow-[var(--shadow-md)] ring-1 ring-line-strong"
        >
          <span>{item.message}</span>
          {item.actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                dismissToast(item.id);
                action.run?.();
              }}
              className="h-6 rounded-chip bg-fill-2 px-2 text-xs font-medium hover:bg-fill-3"
            >
              {action.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
