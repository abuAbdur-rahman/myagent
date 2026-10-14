import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { ChatKeys, type ChatKeyCallbacks } from "./chatKeys";

export interface TipTapHandle {
  focus: (pos?: "start" | "end") => void;
  clear: () => void;
  setMarkdown: (markdown: string) => void;
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
      },
      onCreate: ({ editor: created }) => {
        syncEmptyClass(created);
        if (autoFocus) {
          requestAnimationFrame(() => created.commands.focus("end"));
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
    if (!editor || !handleRef) return;
    handleRef.current = {
      focus: (pos) => editor.commands.focus(pos === "start" ? "start" : "end"),
      clear: () => editor.commands.clearContent(),
      setMarkdown: (markdown) => {
        editor.commands.setContent(markdown);
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
