const FENCE = /^```([\w+#-]*)$/;

export interface ShiftEnterContext {
  parentType: string;
  depth: number;
  textContent: string;
  atParentEnd: boolean;
  inListItem: boolean;
  listItemEmpty: boolean;
}

export type ShiftEnterAction =
  | { kind: "insertNewline" }
  | { kind: "codeBlock"; language: string }
  | { kind: "liftListItem" }
  | { kind: "splitListItem" }
  | { kind: "splitBlock" };

export function fenceLanguage(text: string): string | null {
  const match = FENCE.exec(text);
  if (!match) return null;
  return match[1] ?? "";
}

export function shiftEnterAction(context: ShiftEnterContext): ShiftEnterAction {
  if (context.parentType === "codeBlock") return { kind: "insertNewline" };
  if (context.parentType === "paragraph" && context.depth === 1 && context.atParentEnd) {
    const language = fenceLanguage(context.textContent);
    if (language !== null) return { kind: "codeBlock", language };
  }
  if (context.inListItem) {
    return context.listItemEmpty ? { kind: "liftListItem" } : { kind: "splitListItem" };
  }
  return { kind: "splitBlock" };
}
