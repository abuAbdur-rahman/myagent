import { useState } from "react";
import { useApp } from "../lib/store";
import { Button } from "./ui";

function ApprovalCard() {
  const { approval, replyApproval } = useApp();
  if (!approval) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Tool approval"
      className="mb-2 rounded-control border border-warn/60 bg-warn/10 px-3 py-2 text-sm"
    >
      <div className="font-medium">
        Allow <span className="font-mono">{approval.tool}</span> to run?
      </div>
      {approval.command && (
        <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control bg-vault-raised p-2 font-mono text-xs text-text">
          {approval.command}
        </pre>
      )}
      {approval.cwd && <div className="mt-1 text-xs text-muted">in {approval.cwd}</div>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="default" onClick={() => void replyApproval("once")}>
          Allow once
        </Button>
        <Button size="sm" variant="default" onClick={() => void replyApproval("always")}>
          Always
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void replyApproval("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}

function QuestionCard() {
  const { question, answerQuestion } = useApp();
  const [custom, setCustom] = useState("");
  if (!question) return null;
  const sendCustom = () => {
    if (!custom.trim()) return;
    void answerQuestion(custom);
    setCustom("");
  };
  return (
    <div
      role="alertdialog"
      aria-label="Model question"
      className="mb-2 rounded-control border border-accent/60 bg-accent/10 px-3 py-2 text-sm"
    >
      <div className="font-medium">{question.question}</div>
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
        <div className="mt-2 flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendCustom();
            }}
            placeholder="Or type your own answer…"
            aria-label="Custom answer"
            className="min-w-0 flex-1 rounded-control border border-border bg-surface px-2 py-1 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button size="sm" variant="default" disabled={!custom.trim()} onClick={sendCustom}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}

export function TurnCards() {
  const { approval, question } = useApp();
  if (!approval && !question) return null;
  return (
    <div className="mb-1.5">
      <ApprovalCard />
      <QuestionCard />
    </div>
  );
}
