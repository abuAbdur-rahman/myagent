import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Search, Square, X } from "lucide-react";
import { Logo } from "./Logo";
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
      className={`grid h-9 w-[46px] place-items-center text-fg-2 transition-colors ${
        close ? "hover:bg-danger hover:text-white" : "hover:bg-fill-2 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const { setPaletteOpen } = useApp();
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

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 flex-none select-none items-center bg-sunken pl-3"
    >
      <div
        data-tauri-drag-region
        className="flex w-[252px] flex-none items-center gap-2"
      >
        <Logo size={20} alt="" />
        <b className="text-[13px] font-semibold">MyAgent</b>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search chats, projects and commands"
        className="mx-auto hidden h-[26px] w-[min(420px,40vw)] items-center gap-2 rounded-field bg-fill-1 px-2.5 text-[13px] text-fg-3 shadow-[inset_0_0_0_1px_var(--line-subtle)] hover:bg-fill-2 hover:text-fg-2 md:flex"
      >
        <Search size={14} />
        <span className="truncate">Search chats, projects, commands</span>
        <kbd className="ml-auto">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex h-9 items-center">
        <CapButton label="Minimize" onClick={() => void run((w) => w.minimize())}>
          <Minus size={15} />
        </CapButton>
        <CapButton label={maximized ? "Restore" : "Maximize"} onClick={() => void toggleMaximize()}>
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </CapButton>
        <CapButton label="Close" close onClick={() => void run((w) => w.close())}>
          <X size={15} />
        </CapButton>
      </div>
    </div>
  );
}
