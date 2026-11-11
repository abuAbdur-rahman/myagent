import { useState } from "react";
import { Brain, ChevronRight, FolderKanban, Plus, Search } from "lucide-react";
import { useApp } from "../lib/store";
import { projectColor, timeAgo } from "../lib/grouping";
import { EmptyState, Input, Button } from "./ui";

export function ProjectsGrid({ onNew }: { onNew: () => void }) {
  const { projects, conversations, pendingMemories, selectProject } = useApp();
  const [query, setQuery] = useState("");

  const q = query.toLowerCase();
  const visible = projects.filter(
    (p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q),
  );
  const chatCount = (id: string) => conversations.filter((c) => c.project_id === id).length;
  const totalChats = projects.reduce((sum, project) => sum + chatCount(project.id), 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-8 pb-16 pt-10">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="m-0 font-serif text-[1.75rem] font-normal leading-tight">Projects</h1>
            <p className="mb-0 mt-1.5 text-sm text-fg-3">
              {projects.length} project{projects.length === 1 ? "" : "s"} · {totalChats} chat
              {totalChats === 1 ? "" : "s"}
            </p>
          </div>
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              className="w-[220px] pl-8"
            />
          </div>
        </header>

        {visible.length > 0 && (
          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-3">
            {visible.map((project) => {
              const chats = chatCount(project.id);
              const review = pendingMemories.filter(
                (memory) => memory.scope === "project" && memory.project_id === project.id,
              ).length;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => selectProject(project.id)}
                  className="group flex min-h-[148px] flex-col rounded-card bg-raised p-4 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-overlay hover:shadow-[inset_0_0_0_1px_var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <span className="flex items-start gap-2.5">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: projectColor(project.id) }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-medium">{project.name}</b>
                      <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-fg-2">
                        {project.description || "No description yet"}
                      </span>
                    </span>
                    <ChevronRight
                      size={15}
                      aria-hidden="true"
                      className="mt-0.5 flex-none text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-5 text-xs text-fg-3">
                    <span className="inline-flex h-5 items-center rounded-full bg-fill-1 px-2 font-medium text-fg-2">
                      {chats} chat{chats === 1 ? "" : "s"}
                    </span>
                    {review > 0 && (
                      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--warning-soft)] px-2 font-medium text-warning">
                        <Brain size={12} aria-hidden="true" /> {review} to review
                      </span>
                    )}
                    <span>Updated {timeAgo(project.updated_at)}</span>
                  </span>
                </button>
              );
            })}
            {!q && (
              <button
                type="button"
                onClick={onNew}
                className="group flex min-h-[148px] flex-col items-center justify-center rounded-card bg-fill-1 p-4 text-center shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-fill-2 hover:shadow-[inset_0_0_0_1px_var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-text">
                  <Plus size={18} aria-hidden="true" />
                </span>
                <b className="mt-2 text-sm font-medium">New project</b>
                <span className="mt-1 text-xs text-fg-3">Group chats, files and memory</span>
              </button>
            )}
          </div>
        )}

        {visible.length === 0 && (
          <EmptyState
            icon={<FolderKanban size={32} />}
            title={projects.length === 0 ? "No projects yet" : "No projects found"}
            body={
              projects.length === 0
                ? "Create one to group chats and shared context."
                : "Try a different search, or start a new project."
            }
            action={
              <Button variant="primary" onClick={onNew}>
                <Plus size={16} /> New project
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
