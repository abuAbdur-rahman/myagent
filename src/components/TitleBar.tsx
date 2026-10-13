import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Asterisk, Copy, Minus, Square, X } from "lucide-react";
import { useApp } from "../lib/store";
import { toast } from "../lib/toast";

function CapButton({
  label,
  onClick,
  close,
  children,
}: {
  label: string;
  onClick: () => void;
  close?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-8 w-[46px] place-items-center text-text transition-colors ${
        close ? "hover:bg-danger hover:text-white" : "hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const { conversations, activeConversationId } = useApp();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    getCurrentWindow()
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined);
  }, []);

  const run = async (action: (w: ReturnType<typeof getCurrentWindow>) => Promise<void>) => {
    try {
      await action(getCurrentWindow());
    } catch {
      toast("Window controls need the desktop app");
    }
  };

  const toggleMaximize = () =>
    run(async (w) => {
      await w.toggleMaximize();
      setMaximized(await w.isMaximized());
    });

  const title =
    conversations.find((c) => c.id === activeConversationId)?.title ?? "New chat";

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 flex-none select-none items-center bg-bg"
    >
      <div data-tauri-drag-region className="flex min-w-0 max-w-[60%] items-center gap-2 pl-2.5">
        <Asterisk size={16} className="shrink-0 text-accent" aria-hidden="true" />
        <b className="text-[13px]">myagent</b>
        <span className="truncate text-[13px] text-muted">· {title}</span>
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <CapButton label="Minimize" onClick={() => void run((w) => w.minimize())}>
        <Minus size={16} />
      </CapButton>
      <CapButton label={maximized ? "Restore" : "Maximize"} onClick={() => void toggleMaximize()}>
        {maximized ? <Copy size={14} /> : <Square size={14} />}
      </CapButton>
      <CapButton label="Close" close onClick={() => void run((w) => w.close())}>
        <X size={16} />
      </CapButton>
    </div>
  );
}
