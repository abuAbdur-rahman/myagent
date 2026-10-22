import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { ChatKeys, type ChatKeyCallbacks } from "./chatKeys";
import { fenceForPaste } from "../../lib/paste";
import { toast } from "../../lib/toast";

export interface TipTapHandle {
  focus: (pos?: "start" | "end") => void;
  clear: () => void;
  setMarkdown: (markdown: string) => void;
  appendMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
}

function readMarkdown(editor: Editor | null): string {
  if (!editor) return "";
  const storage = editor.storage as unknown as { markdown?: MarkdownStorage };
  return storage.markdown?.getMarkdown() ?? "";
}

function syncEmptyClass(editor: Editor | null): void {
  if (!editor) return;
  editor.view.dom.classList.toggle("is-editor-empty", editor.isEmpty);
}

export function TipTapEditor({
  placeholder,
  autoFocus,
  signal,
  initialMarkdown,
  handleRef,
  onChangeMarkdown,
  chat,
  onKeyDown,
}: {
  placeholder: string;
  autoFocus?: boolean;
  signal: { id: number; text: string | null } | null;
  initialMarkdown?: string;
  handleRef?: MutableRefObject<TipTapHandle | null>;
  onChangeMarkdown: (markdown: string) => void;
  chat: ChatKeyCallbacks | null;
  onKeyDown?: (event: KeyboardEvent) => boolean;
}) {
  const callbacksRef = useRef(chat);
  callbacksRef.current = chat;
  const changeRef = useRef(onChangeMarkdown);
  changeRef.current = onChangeMarkdown;
  const keyDownRef = useRef(onKeyDown);
  keyDownRef.current = onKeyDown;
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Link.configure({ openOnClick: false }),
        Markdown,
        ...(chat
          ? [
              ChatKeys.configure({
                callbacks: {
                  send: () => callbacksRef.current?.send(),
                  onEscape: () => callbacksRef.current?.onEscape() ?? false,
                  isPopupOpen: () => callbacksRef.current?.isPopupOpen() ?? false,
                  sendOnEnter: () => callbacksRef.current?.sendOnEnter() ?? true,
                  historyEntries: () => callbacksRef.current?.historyEntries() ?? [],
                },
              }),
            ]
          : []),
      ],
      content: initialMarkdown ?? "",
      editorProps: {
        attributes: {
          ...(chat ? { id: "composer" } : {}),
          class: "composer-editor",
          "data-placeholder": placeholder,
        },
        handleKeyDown: (_view, event) => keyDownRef.current?.(event) ?? false,
        handlePaste: (_view, event) => {
          const clipboard = event.clipboardData;
          if (!clipboard || clipboard.files.length > 0) return false;
          const text = clipboard.getData("text/plain");
          if (!text) return false;
          const wrap = fenceForPaste(text);
          if (!wrap.wrapped) return false;
          const current = editorRef.current;
          if (!current) return false;
          event.preventDefault();
          const at = current.state.selection.from;
          current
            .chain()
            .focus()
            .insertContent({
              type: "codeBlock",
              attrs: { language: wrap.language },
              content: [{ type: "text", text: wrap.code }],
            })
            .run();
          toast(`Pasted as ${wrap.language ? `${wrap.language} code` : "a code block"}`, {
            actions: [
              {
                label: "Undo",
                run: () => {
                  if (current.isDestroyed) return;
                  current.commands.undo();
                  current.commands.insertContentAt(at, { type: "text", text: wrap.code });
                },
              },
            ],
            ms: 6000,
          });
          return true;
        },
      },
      onCreate: ({ editor: created }) => {
        editorRef.current = created;
        syncEmptyClass(created);
        if (autoFocus) {
          requestAnimationFrame(() => {
            if (!created.isDestroyed) created.commands.focus("end");
          });
        }
      },
      onUpdate: ({ editor: updated }) => {
        syncEmptyClass(updated);
        changeRef.current(readMarkdown(updated));
      },
    },
    [],
  );

  useEffect(() => {
    editorRef.current = editor;
    if (!editor || !handleRef) return;
    handleRef.current = {
      focus: (pos) => editor.commands.focus(pos === "start" ? "start" : "end"),
      clear: () => editor.commands.clearContent(),
      setMarkdown: (markdown) => {
        editor.commands.setContent(markdown);
        editor.commands.focus("end");
      },
      appendMarkdown: (markdown) => {
        const text = markdown.trim();
        if (!text) return;
        const current = readMarkdown(editor).trimEnd();
        const next = current.length > 0 ? `${current} ${text}` : text;
        editor.commands.setContent(next);
        editor.commands.focus("end");
      },
      getMarkdown: () => readMarkdown(editor),
    };
    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef]);

  const lastSignalId = useRef(signal?.id ?? null);
  useEffect(() => {
    if (!editor || !signal || signal.id === lastSignalId.current) return;
    lastSignalId.current = signal.id;
    const text = signal.text ?? "";
    if (readMarkdown(editor) !== text) {
      editor.commands.setContent(text);
    }
    editor.commands.focus("end");
  }, [editor, signal]);

  return (
    <EditorContent
      editor={editor}
      className="block max-h-[40vh] min-h-[24px] overflow-y-auto text-[15px] leading-6"
    />
  );
}
