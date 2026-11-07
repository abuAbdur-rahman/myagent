import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../lib/store";
import { projectColor, timeAgo } from "../lib/grouping";
import { Input, Button } from "./ui";

export function ProjectsGrid({ onNew }: { onNew: () => void }) {
  const { projects, conversations, selectProject } = useApp();
  const [query, setQuery] = useState("");

  const q = query.toLowerCase();
  const visible = projects.filter(
    (p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q),
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[920px] px-8 pb-12 pt-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="m-0 font-serif text-[1.75rem] font-normal leading-tight">Projects</h1>
          <Button variant="primary" onClick={onNew}>
            <Plus size={16} /> New project
          </Button>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
          className="max-w-[320px]"
        />
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {visible.map((project) => {
            const chats = conversations.filter((c) => c.project_id === project.id);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => selectProject(project.id)}
                className="flex min-h-[124px] flex-col gap-1.5 rounded-card bg-raised p-4 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: projectColor(project.id) }}
                  />
                  <b className="truncate text-sm font-medium">{project.name}</b>
                </span>
                <span className="line-clamp-2 text-[13px] text-fg-3">
                  {project.description || "No description"}
                </span>
                <span className="mt-auto text-xs text-fg-3">
                  {chats.length} chats · Updated {timeAgo(project.updated_at)}
                </span>
              </button>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div className="py-16 text-center">
            <p className="m-0 text-sm font-medium">No projects found.</p>
            <p className="m-0 mt-1 text-[13px] text-fg-3">Create one to group chats and shared context.</p>
          </div>
        )}
      </div>
    </div>
  );
}
