import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { projectInputSchema, type Memory } from "../lib/types";
import { MemoryEditor } from "./MemoryEditor";
import { Button, Dialog, Input, Textarea } from "./ui";

export function ProjectDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}) {
  const {
    projects,
    saveProject,
    removeProject,
    loadMemories,
    addMemory,
    editMemory,
    deleteMemory,
  } = useApp();

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const [currentId, setCurrentId] = useState<string | null>(projectId);
  const [form, setForm] = useState({ name: "", description: "", instructions: "" });
  const [memories, setMemories] = useState<Memory[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadMemories = useCallback(
    async (id: string | null) => {
      setMemories(id ? await loadMemories("project", id) : []);
    },
    [loadMemories],
  );

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setCurrentId(projectId);
    const project = projectId
      ? projectsRef.current.find((p) => p.id === projectId)
      : undefined;
    setForm(
      project
        ? {
            name: project.name,
            description: project.description,
            instructions: project.instructions,
          }
        : { name: "", description: "", instructions: "" },
    );
    void reloadMemories(projectId ?? null);
  }, [open, projectId, reloadMemories]);

  const save = async () => {
    const parsed = projectInputSchema.safeParse({
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
    });
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Invalid project");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveProject(parsed.data, currentId ?? undefined);
      setCurrentId(saved.id);
      await reloadMemories(saved.id);
      setStatus("Saved.");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!currentId) return;
    if (
      !window.confirm(
        "Delete this project? Its chats are kept but detached, and its memory is removed. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await removeProject(currentId);
      setCurrentId(null);
      setForm({ name: "", description: "", instructions: "" });
      setMemories([]);
      setStatus("Project deleted.");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={currentId ? "Edit project" : "New project"}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-text-muted">Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Vault migration"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-muted">
            Description <span className="text-text-faint">(shown to the model)</span>
          </label>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this project is about."
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-muted">
            Instructions <span className="text-text-faint">(sent with every chat in this project)</span>
          </label>
          <Textarea
            rows={4}
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            placeholder="How the assistant should behave here."
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Project memory</h3>
          {currentId ? (
            <MemoryEditor
              memories={memories}
              emptyHint="No memory for this project yet."
              onAdd={async (draft) => {
                await addMemory({ scope: "project", project_id: currentId, ...draft });
                await reloadMemories(currentId);
              }}
              onUpdate={async (id, draft) => {
                await editMemory(id, draft);
                await reloadMemories(currentId);
              }}
              onDelete={async (id) => {
                await deleteMemory(id);
                await reloadMemories(currentId);
              }}
            />
          ) : (
            <p className="rounded-control border border-vault-line px-3 py-3 text-xs text-text-faint">
              Save the project first, then add memory to it.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-text-muted" role="status">
            {status}
          </div>
          <div className="flex gap-2">
            {currentId && (
              <Button variant="dangerFill" onClick={() => void remove()} disabled={busy}>
                Delete
              </Button>
            )}
            <Button onClick={() => void save()} disabled={busy}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
