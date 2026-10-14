import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ChatHeader } from "./components/ChatHeader";
import { ContextBar } from "./components/ContextBar";
import { ProjectsGrid } from "./components/ProjectsGrid";
import { ProjectDetail } from "./components/ProjectDetail";
import { Welcome } from "./components/Welcome";
import { Composer } from "./components/Composer";
import { TurnCards } from "./components/TurnCards";
import { MessageList } from "./components/MessageList";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { OnboardingDialog } from "./components/OnboardingDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { Toaster } from "./components/Toaster";
import { ConfirmHost } from "./components/ConfirmDialog";
import { MenuHost } from "./components/Menu";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "./lib/toast";

function Shell() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    paletteOpen,
    setPaletteOpen,
    setSettingsPage,
    newConversation,
    stopStream,
    streaming,
    messages,
    activeConversationId,
    togglePanel,
    panelOpen,
    view,
    setView,
  } = useApp();
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  const showWelcome = activeConversationId === null && messages.length === 0;

  useEffect(() => {
    let live = true;
    check()
      .then((update) => {
        if (live && update) {
          toast(`MyAgent ${update.version} is ready — see About to install.`);
        }
        update?.close().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (!e.ctrlKey || e.altKey || e.metaKey) {
        if (e.key === "Escape" && !inField && streaming) {
          stopStream();
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === "n" && !e.shiftKey && !inField) {
        e.preventDefault();
        void newConversation().catch(() => undefined);
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsPage("general");
      } else if (key === "b" && !e.shiftKey && !inField) {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "a" && e.shiftKey) {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newConversation, setPaletteOpen, setSettingsPage, stopStream, streaming, toggleSidebar, togglePanel]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TitleBar />
      <div
        className="shell-grid grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${sidebarCollapsed ? 56 : 260}px minmax(0, 1fr) ${panelOpen ? 420 : 0}px`,
        }}
      >
        <Sidebar onOpenProject={(id) => setProjectDialog({ open: true, id })} />
        <main className="flex min-w-0 flex-col overflow-hidden bg-surface">
          {view === "projects" ? (
            <ProjectsGrid onNew={() => setProjectDialog({ open: true, id: null })} />
          ) : view === "project" ? (
            <ProjectDetail onBack={() => setView("projects")} />
          ) : showWelcome ? (
            <Welcome />
          ) : (
            <>
              <ChatHeader />
              <div className="min-h-0 flex-1">
                <MessageList />
              </div>
              <div className="flex-none px-4 pb-2">
                <div className="mx-auto w-full max-w-[760px]">
                  <TurnCards />
                  <ContextBar />
                  <Composer />
                </div>
              </div>
            </>
          )}
        </main>
        <ArtifactsPanel />
      </div>
      <SettingsDialog />
      <OnboardingDialog />
      <ProjectDialog
        open={projectDialog.open}
        projectId={projectDialog.id}
        onClose={() => setProjectDialog({ open: false, id: null })}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
      <Toaster />
      <ConfirmHost />
      <MenuHost />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
