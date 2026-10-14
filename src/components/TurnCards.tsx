import { useEffect, useRef, useState } from "react";
import { ShieldQuestion, CircleQuestionMark } from "lucide-react";
import { useApp } from "../lib/store";
import { Button, Input } from "./ui";

function Kbd({ children }: { children: string }) {
  return <kbd className="border-white/40 bg-transparent text-inherit">{children}</kbd>;
}

function useFocusOnShow(dep: string | null) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dep) return;
    rootRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [dep]);
  return rootRef;
}

function inEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function ApprovalCard() {
  const { approval, replyApproval } = useApp();
  const rootRef = useFocusOnShow(approval?.id ?? null);

  useEffect(() => {
    if (!approval) return;
    const onKey = (e: KeyboardEvent) => {
      if (inEditable(e.target)) return;
      if (e.key === "1") void replyApproval("once");
      else if (e.key === "2") void replyApproval("always");
      else if (e.key === "Escape") void replyApproval("deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval, replyApproval]);

  if (!approval) return null;
  const firstSegment = approval.command.split("\n")[0] ?? approval.command;
  return (
    <div
      ref={rootRef}
      role="region"
      aria-live="assertive"
      aria-labelledby="approval-title"
      className="rounded-control bg-warn/10 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <ShieldQuestion size={16} className="flex-none text-warn" />
        <div id="approval-title" className="font-medium">
          Allow <span className="font-mono">{approval.tool}</span> to run?
        </div>
      </div>
      <div className="mt-0.5 pl-6 text-xs text-muted">
        No rule matches this command, so it asks first.
      </div>
      {approval.command && (
        <pre className="m-0 mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control border border-border bg-vault-raised p-2 font-mono text-xs text-text">
          {approval.command}
        </pre>
      )}
      <div className="mt-1 font-mono text-[11px] text-muted">
        in {approval.cwd} · Always saves allow {approval.tool} · {firstSegment.slice(0, 60)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => void replyApproval("once")}>
          Allow once <Kbd>1</Kbd>
        </Button>
        <Button size="sm" variant="default" onClick={() => void replyApproval("always")}>
          Always allow <Kbd>2</Kbd>
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="danger" onClick={() => void replyApproval("deny")}>
          Deny <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

function QuestionCard() {
  const { question, answerQuestion } = useApp();
  const [custom, setCustom] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useFocusOnShow(question?.id ?? null);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHighlight(0);
    setCustom("");
  }, [question?.id]);

  useEffect(() => {
    if (!question) return;
    const count = question.options.length + (question.allowCustom ? 1 : 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void answerQuestion("Skipped by user.");
        return;
      }
      if (inEditable(e.target)) return;
      if (e.key >= "1" && e.key <= "9") {
        const index = Number(e.key) - 1;
        if (index < question.options.length) {
          void answerQuestion(question.options[index]);
        } else if (index === question.options.length && question.allowCustom) {
          customRef.current?.focus();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + count) % count);
      } else if (e.key === "Enter") {
        if (highlight < question.options.length) {
          void answerQuestion(question.options[highlight]);
        } else {
          customRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question, highlight, answerQuestion]);

  if (!question) return null;
  const sendCustom = () => {
    if (!custom.trim()) return;
    void answerQuestion(custom);
    setCustom("");
  };
  return (
    <div
      ref={rootRef}
      role="region"
      aria-live="assertive"
      aria-labelledby="question-title"
      className="rounded-control bg-accent/10 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <CircleQuestionMark size={16} className="flex-none text-accent" />
        <div id="question-title" className="font-medium">
          {question.question}
        </div>
      </div>
      <div className="mt-0.5 pl-6 text-xs text-muted">
        The model is waiting on your choice before it continues.
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {question.options.map((option, i) => (
          <button
            key={`${i}-${option}`}
            type="button"
            onClick={() => void answerQuestion(option)}
            onMouseEnter={() => setHighlight(i)}
            className={
              highlight === i
                ? "flex items-center gap-2.5 rounded-control border border-accent bg-accent/15 px-2.5 py-1.5 text-left"
                : "flex items-center gap-2.5 rounded-control border border-border px-2.5 py-1.5 text-left hover:border-accent/60"
            }
          >
            <span className="grid h-5 w-5 flex-none place-items-center rounded-control border border-border font-mono text-[11px] text-muted">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate" title={option}>
              {option}
            </span>
          </button>
        ))}
        {question.allowCustom && (
          <form
            className={
              highlight === question.options.length
                ? "flex items-center gap-2.5 rounded-control border border-accent bg-accent/15 px-2.5 py-1.5"
                : "flex items-center gap-2.5 rounded-control border border-border px-2.5 py-1.5"
            }
            onSubmit={(e) => {
              e.preventDefault();
              sendCustom();
            }}
          >
            <span className="grid h-5 w-5 flex-none place-items-center rounded-control border border-border font-mono text-[11px] text-muted">
              {question.options.length + 1}
            </span>
            <label htmlFor="question-custom" className="sr-only">
              Type your own answer
            </label>
            <Input
              id="question-custom"
              ref={customRef}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onFocus={() => setHighlight(question.options.length)}
              placeholder="Type your own answer"
              className="h-7 min-w-0 flex-1 border-transparent bg-transparent text-xs"
            />
          </form>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (highlight < question.options.length) {
              void answerQuestion(question.options[highlight]);
            } else {
              sendCustom();
            }
          }}
        >
          Send answer <Kbd>Enter</Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void answerQuestion("Skipped by user.")}>
          Skip <Kbd>Esc</Kbd>
        </Button>
        <span className="flex-1" />
        <span className="hidden text-[11px] text-muted sm:inline">↑↓ move · 1–{question.options.length + (question.allowCustom ? 1 : 0)} pick</span>
      </div>
    </div>
  );
}

export function TurnCards() {
  const { approval, question } = useApp();
  if (!approval && !question) return null;
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2">
      <div className="space-y-2 rounded-control border border-border bg-surface p-2 shadow-[var(--shadow)]">
        <ApprovalCard />
        <QuestionCard />
      </div>
      <div className="mt-1 text-center text-[11px] text-muted">
        Waiting for your answer above…
      </div>
    </div>
  );
}
