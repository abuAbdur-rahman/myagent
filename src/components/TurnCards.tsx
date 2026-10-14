import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { Button, Input } from "./ui";

function useFocusOnShow(dep: string | null) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dep) return;
    rootRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [dep]);
  return rootRef;
}

function ApprovalCard() {
  const { approval, replyApproval } = useApp();
  const rootRef = useFocusOnShow(approval?.id ?? null);
  if (!approval) return null;
  return (
    <div
      ref={rootRef}
      role="region"
      aria-live="assertive"
      aria-labelledby="approval-title"
      className="rounded-control bg-warn/10 px-3 py-2 text-sm"
    >
      <div id="approval-title" className="font-medium">
        Allow <span className="font-mono">{approval.tool}</span> to run?
      </div>
      {approval.command && (
        <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control bg-vault-raised p-2 font-mono text-xs text-text">
          {approval.command}
        </pre>
      )}
      {approval.cwd && <div className="mt-1 text-xs text-muted">in {approval.cwd}</div>}
      <div className="mt-1 text-xs text-muted">Always applies to this command only.</div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void replyApproval("once")}>
          Allow once
        </Button>
        <Button size="sm" variant="default" onClick={() => void replyApproval("always")}>
          Always allow
        </Button>
        <Button size="sm" variant="danger" onClick={() => void replyApproval("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}

function QuestionCard() {
  const { question, answerQuestion } = useApp();
  const [custom, setCustom] = useState("");
  const rootRef = useFocusOnShow(question?.id ?? null);
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
      <div id="question-title" className="font-medium">
        {question.question}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {question.options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant="default"
            onClick={() => void answerQuestion(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      {question.allowCustom && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendCustom();
          }}
        >
          <label htmlFor="question-custom" className="sr-only">
            Custom answer
          </label>
          <Input
            id="question-custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Or type your own answer…"
            className="h-7 min-w-0 flex-1 text-xs"
          />
          <Button size="sm" variant="default" type="submit" disabled={!custom.trim()}>
            Send
          </Button>
        </form>
      )}
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
    </div>
  );
}
