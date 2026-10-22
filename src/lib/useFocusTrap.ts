import { useEffect, useRef, type RefObject } from "react";

import { focusableElements, nextFocusIndex } from "./focus-trap";

const traps: HTMLElement[] = [];

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focusableElements(root)[0] ?? root).focus();
    traps.push(root);

    const onKey = (event: KeyboardEvent) => {
      if (traps[traps.length - 1] !== root) return;
      if (event.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableElements(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      items[nextFocusIndex(current, items.length, event.shiftKey)]?.focus();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = traps.lastIndexOf(root);
      if (index >= 0) traps.splice(index, 1);
      opener?.focus();
    };
  }, [ref, active]);
}
