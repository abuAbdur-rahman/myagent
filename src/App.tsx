import { useState } from "react";
import { AppProvider } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { MessageList } from "./components/MessageList";
import { MessageInput } from "./components/MessageInput";
import { SettingsDialog } from "./components/SettingsDialog";
import { MemoryDialog } from "./components/MemoryDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import type { Artifact } from "./lib/artifacts";

function Shell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProject={(id) => setProjectDialog({ open: true, id })}
        onOpenMemory={() => setMemoryOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex-1 overflow-y-auto">
          <MessageList onOpenArtifact={setArtifact} />
        </div>
        <MessageInput />
      </main>
      <ArtifactsPanel artifact={artifact} onClose={() => setArtifact(null)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MemoryDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      <ProjectDialog
        open={projectDialog.open}
        projectId={projectDialog.id}
        onClose={() => setProjectDialog({ open: false, id: null })}
      />
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
