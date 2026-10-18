import { Extension, type Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import type { MarkdownStorage } from "tiptap-markdown";
import { shiftEnterAction } from "./shiftEnter";

export interface ChatKeyCallbacks {
  send: () => void;
  onEscape: () => boolean;
  isPopupOpen: () => boolean;
  sendOnEnter: () => boolean;
  historyEntries: () => string[];
}

interface ChatKeysOptions {
  callbacks: ChatKeyCallbacks;
}

interface ChatKeysStorage {
  historyIndex: number;
  draft: string;
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: MarkdownStorage };
  return storage.markdown?.getMarkdown() ?? "";
}

function atStart(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection.empty && selection.from === Selection.atStart(editor.state.doc).from;
}

function atEnd(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection.empty && selection.from === Selection.atEnd(editor.state.doc).from;
}

function loadSnapshot(editor: Editor, markdown: string, pos: "start" | "end"): boolean {
  return editor.chain().setContent(markdown).focus(pos).run();
}

export const ChatKeys = Extension.create<ChatKeysOptions, ChatKeysStorage>({
  name: "chatKeys",
  priority: 1000,

  addStorage() {
    return { historyIndex: -1, draft: "" };
  },

  addKeyboardShortcuts() {
    const callbacks = () => this.options.callbacks;
    return {
      "Shift-Enter": ({ editor }) => {
        const { $from } = editor.state.selection;
        const node = $from.parent;
        const action = shiftEnterAction({
          parentType: node.type.name,
          depth: $from.depth,
          textContent: node.textContent,
          atParentEnd: $from.parentOffset === node.content.size,
          inListItem: editor.isActive("listItem"),
          listItemEmpty: node.content.size === 0,
        });

        if (action.kind === "insertNewline") {
          return editor.commands.insertContent("\n");
        }

        if (action.kind === "codeBlock") {
          return editor
            .chain()
            .deleteRange({ from: $from.start(), to: $from.end() })
            .setCodeBlock({ language: action.language })
            .run();
        }

        if (action.kind === "liftListItem") {
          return editor.commands.liftListItem("listItem");
        }

        if (action.kind === "splitListItem") {
          return editor.commands.splitListItem("listItem");
        }

        return editor.commands.splitBlock();
      },

      Enter: ({ editor }) => {
        if (editor.isActive("codeBlock")) return false;
        if (callbacks().isPopupOpen()) return false;
        if (!callbacks().sendOnEnter()) return false;
        callbacks().send();
        return true;
      },

      "Mod-Enter": () => {
        if (callbacks().isPopupOpen()) return false;
        callbacks().send();
        return true;
      },

      Escape: () => {
        if (callbacks().isPopupOpen()) return false;
        return callbacks().onEscape();
      },

      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          return editor.commands.insertContent("\t");
        }
        return false;
      },

      "Mod-k": ({ editor }) => {
        if (editor.isActive("link")) {
          return editor.commands.unsetLink();
        }
        const { from, to, empty } = editor.state.selection;
        if (empty) return false;
        const text = editor.state.doc.textBetween(from, to);
        if (!/^https?:\S+$/i.test(text.trim())) return false;
        return editor.commands.setLink({ href: text.trim() });
      },

      ArrowUp: ({ editor }) => {
        if (callbacks().isPopupOpen()) return false;
        if (editor.view.composing) return false;
        const history = callbacks().historyEntries();
        if (history.length === 0 || !atStart(editor)) return false;
        if (this.storage.historyIndex === -1) {
          this.storage.draft = getMarkdown(editor);
        }
        this.storage.historyIndex = Math.min(
          this.storage.historyIndex + 1,
          history.length - 1,
        );
        return loadSnapshot(editor, history[this.storage.historyIndex], "start");
      },

      ArrowDown: ({ editor }) => {
        if (callbacks().isPopupOpen()) return false;
        if (editor.view.composing) return false;
        if (this.storage.historyIndex === -1 || !atEnd(editor)) return false;
        this.storage.historyIndex -= 1;
        const markdown =
          this.storage.historyIndex === -1
            ? this.storage.draft
            : callbacks().historyEntries()[this.storage.historyIndex];
        return loadSnapshot(editor, markdown, "end");
      },
    };
  },
});
