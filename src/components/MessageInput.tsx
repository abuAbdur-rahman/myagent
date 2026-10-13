import { useState, type KeyboardEvent } from "react";
import { useApp } from "../lib/store";
import { Button, Textarea } from "./ui";

export function MessageInput() {
  const { sendMessage, stopStream, streaming, activeConnection, model } = useApp();
  const [value, setValue] = useState("");

  const canSubmit = value.trim().length > 0 && !!activeConnection && !!model && !streaming;

  const submit = async () => {
    const text = value.trim();
    if (!canSubmit) return;
    setValue("");
    try {
      const accepted = await sendMessage(text);
      if (!accepted) setValue(text);
    } catch {
      setValue(text);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="border-t border-vault-line p-4">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={
            activeConnection
              ? "Send a message…  (Enter to send, Shift+Enter for newline)"
              : "Add a connection in Settings to start"
          }
          disabled={!activeConnection}
          aria-label="Message"
          className="max-h-40"
        />
        {streaming ? (
          <Button variant="destructive" onClick={stopStream} className="h-auto self-stretch">
            Stop
          </Button>
        ) : (
          <Button onClick={() => void submit()} disabled={!canSubmit} className="h-auto self-stretch">
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
