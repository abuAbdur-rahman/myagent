import { useApp } from "../lib/store";
import { Button } from "./ui";
import { cn } from "../lib/utils";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    conversations,
    activeConversationId,
    selectConversation,
    newConversation,
    removeConversation,
    activeConnection,
    ready,
  } = useApp();

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await removeConversation(id);
    } catch {
      // surfaced by the store error banner on next read
    }
  };

  const handleSelect = (id: string) => {
    void selectConversation(id).catch(() => undefined);
  };

  const handleNew = () => {
    void newConversation().catch(() => undefined);
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-vault-line bg-vault-surface/40">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold text-text-primary">Chats</span>
        <Button variant="secondary" size="sm" onClick={handleNew}>
          New
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2" aria-label="Conversations">
        {ready && conversations.length === 0 && (
          <p className="px-2 py-6 text-xs text-text-faint">No chats yet.</p>
        )}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              "group mb-1 flex items-center gap-1 rounded-control px-2 py-2",
              activeConversationId === conversation.id
                ? "bg-vault-raised"
                : "hover:bg-vault-raised/60",
            )}
          >
            <button
              type="button"
              onClick={() => handleSelect(conversation.id)}
              className="min-w-0 flex-1 truncate rounded-control text-left text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              title={conversation.title}
            >
              {conversation.title}
            </button>
            <button
              type="button"
              aria-label={`Delete ${conversation.title}`}
              onClick={() => void handleDelete(conversation.id, conversation.title)}
              className="rounded-control px-1 text-text-faint opacity-0 transition-opacity hover:text-alarm focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-vault-line p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full rounded-control px-2 py-2 text-left text-xs text-text-muted hover:bg-vault-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <div className="font-medium text-text-primary">
            {activeConnection ? activeConnection.name : "No connection"}
          </div>
          <div className="truncate">{activeConnection?.base_url ?? "Open settings to add one"}</div>
        </button>
      </div>
    </aside>
  );
}
