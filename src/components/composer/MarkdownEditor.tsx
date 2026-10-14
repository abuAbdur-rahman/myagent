import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CODE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { $isCodeNode, $createCodeNode, CodeNode } from "@lexical/code";
import { $isListItemNode, ListItemNode, ListNode } from "@lexical/list";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { QuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { toast } from "../../lib/toast";

const COMPOSER_TRANSFORMERS: Transformer[] = [
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  LINK,
];

const URL_MATCHER = /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)))/;
const MATCHERS = [
  (text: string) => {
    const match = URL_MATCHER.exec(text);
    if (!match) return null;
    return { index: match.index, length: match[0].length, text: match[0], url: match[0] };
  },
];

function codeAncestor(node: LexicalNode | null): CodeNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isCodeNode(current)) return current;
    current = current.getParent();
  }
  return null;
}

function inListItem(node: LexicalNode | null): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isListItemNode(current)) return true;
    current = current.getParent();
  }
  return false;
}

function codeCaret(code: CodeNode, anchorNode: LexicalNode, anchorOffset: number) {
  let before = "";
  let after = "";
  let seen = false;
  for (const child of code.getChildren()) {
    if (!$isTextNode(child)) continue;
    const text = child.getTextContent();
    if (child.getKey() === anchorNode.getKey()) {
      seen = true;
      before += text.slice(0, anchorOffset);
      after += text.slice(anchorOffset);
    } else if (!seen) {
      before += text;
    } else {
      after += text;
    }
  }
  return { before, after };
}

function currentLineIsEmpty(before: string): boolean {
  const index = before.lastIndexOf("\n");
  return before.slice(index + 1).trim() === "";
}

function exitCodeBlock(editor: LexicalEditor, code: CodeNode) {
  editor.update(() => {
    const paragraph = $createParagraphNode();
    code.insertAfter(paragraph);
    paragraph.select();
  });
}

export interface EditorKeyHandlers {
  onSend: () => void;
  shouldSend: (mods: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => boolean;
  onEscape: () => void;
  onEmptyArrow: ((direction: 1 | -1) => void) | null;
  onBeforeEnter: (() => boolean) | null;
}

function isEditorEmpty(): boolean {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length !== 1) return false;
  const first = children[0];
  return $isElementNode(first) && first.getType() === "paragraph" && first.getTextContent() === "";
}

function KeyBehaviors({ handlers }: { handlers: EditorKeyHandlers }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisters = [
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          let inList = false;
          editor.read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              inList = inListItem(selection.anchor.getNode());
            }
          });
          if (inList) return false;
          event.preventDefault();
          const outdent = event.shiftKey;
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
            const anchor = selection.anchor;
            const node = anchor.getNode();
            if (!$isTextNode(node) || anchor.offset < 0) return;
            if (outdent) {
              const text = node.getTextContent();
              const before = text.slice(0, anchor.offset);
              const lineStart = before.lastIndexOf("\n") + 1;
              const head = text.slice(lineStart, anchor.offset);
              const cut = head.startsWith("  ") ? 2 : head.startsWith(" ") ? 1 : 0;
              if (cut === 0) return;
              node.setTextContent(text.slice(0, lineStart) + text.slice(lineStart + cut));
              anchor.set(node.getKey(), anchor.offset - cut, "text");
            } else {
              node.setTextContent(
                node.getTextContent().slice(0, anchor.offset) +
                  "  " +
                  node.getTextContent().slice(anchor.offset),
              );
              anchor.set(node.getKey(), anchor.offset + 2, "text");
            }
          });
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          let selection: RangeSelection | null = null;
          editor.read(() => {
            const sel = $getSelection();
            selection = $isRangeSelection(sel) && sel.isCollapsed() ? sel.clone() : null;
          });
          if (!selection) return false;
          const nonNull = selection as RangeSelection;
          let code: CodeNode | null = null;
          editor.read(() => {
            code = codeAncestor(nonNull.anchor.getNode());
          });
          if (code) {
            const keyboard = event as KeyboardEvent | null;
            if (keyboard && (keyboard.ctrlKey || keyboard.metaKey)) {
              event?.preventDefault();
              handlers.onSend();
              return true;
            }
            let exit = false;
            editor.read(() => {
              if (!code) return;
              const anchor = nonNull.anchor;
              const node = anchor.getNode();
              if (!$isTextNode(node)) return;
              const { before, after } = codeCaret(code, node, anchor.offset);
              exit = currentLineIsEmpty(before) && after.trim() === "";
            });
            if (exit && code) {
              event?.preventDefault();
              exitCodeBlock(editor, code);
              return true;
            }
            return false;
          }
          if (handlers.onBeforeEnter && handlers.onBeforeEnter()) {
            event?.preventDefault();
            return true;
          }
          if (handlers.shouldSend({ shiftKey: !!event?.shiftKey, ctrlKey: !!event?.ctrlKey, metaKey: !!event?.metaKey })) {
            event?.preventDefault();
            handlers.onSend();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          let code: CodeNode | null = null;
          editor.read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              code = codeAncestor(selection.anchor.getNode());
            }
          });
          if (code) {
            exitCodeBlock(editor, code);
            return true;
          }
          handlers.onEscape();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => {
          if (!handlers.onEmptyArrow) return false;
          let empty = false;
          editor.read(() => {
            empty = isEditorEmpty();
          });
          if (!empty) return false;
          handlers.onEmptyArrow(1);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          if (!handlers.onEmptyArrow) return false;
          let empty = false;
          editor.read(() => {
            empty = isEditorEmpty();
          });
          if (!empty) return false;
          handlers.onEmptyArrow(-1);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    ];
    return () => unregisters.forEach((unregister) => unregister());
  });

  return null;
}

function EditorRefPlugin({
  editorRef,
}: {
  editorRef?: MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

function SignalPlugin({ signal }: { signal: { id: number; text: string | null } | null }) {
  const [editor] = useLexicalComposerContext();
  const lastId = useRef(0);
  useEffect(() => {
    if (!signal || signal.id === lastId.current) return;
    lastId.current = signal.id;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (signal.text) {
        $convertFromMarkdownString(signal.text, COMPOSER_TRANSFORMERS);
      }
    });
  }, [editor, signal]);
  return null;
}

function InitialContentPlugin({ markdown }: { markdown?: string }) {
  const [editor] = useLexicalComposerContext();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !markdown) return;
    applied.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromMarkdownString(markdown, COMPOSER_TRANSFORMERS);
    });
  }, [editor, markdown]);
  return null;
}

export interface MarkdownEditorProps {
  initialMarkdown?: string;
  placeholder?: string;
  autoFocus?: boolean;
  signal?: { id: number; text: string | null } | null;
  editorRef?: MutableRefObject<LexicalEditor | null>;
  onChangeMarkdown?: (markdown: string) => void;
  handlers?: EditorKeyHandlers;
}

export function MarkdownEditor({
  initialMarkdown,
  placeholder,
  autoFocus,
  signal,
  editorRef,
  onChangeMarkdown,
  handlers,
}: MarkdownEditorProps) {
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const editor = editorRef?.current;
    if (!editor) return;
    const key = event.key.toLowerCase();
    if (key === "e" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
    } else if (key === "x" && event.shiftKey && !event.altKey) {
      event.preventDefault();
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
    } else if (key === "k" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const text = selection.getTextContent().trim();
        if (/^https?:\/\//i.test(text)) {
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, text);
        } else {
          toast("Select a URL first, then press Ctrl+K.");
        }
      });
    } else if (key === "c" && event.altKey) {
      event.preventDefault();
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createCodeNode());
        }
      });
    }
  };

  return (
    <LexicalComposer
      initialConfig={{
        namespace: "myagent-composer",
        nodes: [QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
        theme: {
          paragraph: "",
          text: {
            bold: "font-bold",
            italic: "italic",
            strikethrough: "line-through",
            underline: "underline",
            code: "rounded bg-black/30 px-1 font-mono text-[13px]",
          },
          code: "my-2 block overflow-x-auto whitespace-pre rounded-panel border border-vault-line bg-black/30 p-3 font-mono text-[13px] leading-relaxed",
          list: {
            ul: "ml-5 list-disc",
            ol: "ml-5 list-decimal",
            listitem: "mb-0.5",
          },
          quote: "my-2 border-l-[3px] border-accent pl-3 text-muted",
          link: "text-accent-link underline",
        },
        onError: (error) => {
          console.error(error);
        },
      }}
    >
      <div className="relative" onKeyDown={handleKeyDown}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={placeholder ?? "Message"}
              className="block max-h-[40vh] min-h-[24px] overflow-y-auto text-[15px] leading-6 outline-none placeholder:text-muted"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-0 top-0 select-none text-[15px] leading-6 text-muted">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin validateUrl={(url) => /^https?:\/\//i.test(url)} />
      <AutoLinkPlugin matchers={MATCHERS} />
      <MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(editorState) => {
          editorState.read(() => {
            onChangeMarkdown?.($convertToMarkdownString(COMPOSER_TRANSFORMERS));
          });
        }}
      />
      {handlers && <KeyBehaviors handlers={handlers} />}
      <EditorRefPlugin editorRef={editorRef} />
      <SignalPlugin signal={signal ?? null} />
      <InitialContentPlugin markdown={initialMarkdown} />
      {autoFocus && <AutoFocusPlugin />}
    </LexicalComposer>
  );
}

export function getEditorMarkdown(editor: LexicalEditor | null): string {
  if (!editor) return "";
  return editor.getEditorState().read(() => $convertToMarkdownString(COMPOSER_TRANSFORMERS));
}

export function clearEditor(editor: LexicalEditor | null) {
  if (!editor) return;
  editor.update(() => {
    $getRoot().clear();
  });
}

export function setEditorMarkdown(editor: LexicalEditor | null, markdown: string) {
  if (!editor) return;
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    if (markdown) {
      $convertFromMarkdownString(markdown, COMPOSER_TRANSFORMERS);
    }
  });
}

export function focusEditor(editor: LexicalEditor | null) {
  editor?.focus();
}
