import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../lib/store";
import { projectColor, timeAgo } from "../lib/grouping";
import { Input } from "./ui";

export function ProjectsGrid({ onNew }: { onNew: () => void }) {
  const { projects, conversations, selectProject } = useApp();
  const [query, setQuery] = useState("");

  const q = query.toLowerCase();
  const visible = projects.filter(
    (p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q),
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-3.5 flex items-center justify-between">
          <h1 className="m-0 font-serif text-[28px] font-semibold">Projects</h1>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-8 items-center gap-1.5 rounded-control border border-accent bg-accent px-3 text-[13px] font-medium text-accent-contrast hover:brightness-110"
          >
            <Plus size={16} /> New project
          </button>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
        />
        <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {visible.map((project) => {
            const chats = conversations.filter((c) => c.project_id === project.id);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => selectProject(project.id)}
                className="flex min-h-[120px] flex-col gap-1.5 rounded-card border border-border bg-surface p-3 text-left hover:bg-hover"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: projectColor(project.id) }}
                  />
                  <b className="truncate text-sm">{project.name}</b>
                </span>
                <span className="line-clamp-2 text-[13px] text-muted">
                  {project.description || "No description"}
                </span>
                <span className="mt-auto text-xs text-muted">
                  {chats.length} chats · Updated {timeAgo(project.updated_at)}
                </span>
              </button>
            );
          })}
        </div>
        {visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No projects found.</p>
        )}
      </div>
    </div>
  );
}
