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

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold text-neutral-200">Chats</span>
        <Button variant="secondary" size="sm" onClick={() => void newConversation()}>
          New
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {ready && conversations.length === 0 && (
          <p className="px-2 py-6 text-xs text-neutral-500">No chats yet.</p>
        )}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              "group mb-1 flex items-center gap-1 rounded-md px-2 py-2",
              activeConversationId === conversation.id
                ? "bg-neutral-800"
                : "hover:bg-neutral-800/60",
            )}
          >
            <button
              type="button"
              onClick={() => void selectConversation(conversation.id)}
              className="min-w-0 flex-1 truncate text-left text-sm text-neutral-200"
              title={conversation.title}
            >
              {conversation.title}
            </button>
            <button
              type="button"
              aria-label={`Delete ${conversation.title}`}
              onClick={() => void removeConversation(conversation.id)}
              className="hidden text-neutral-500 hover:text-red-400 group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-neutral-800 p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full rounded-md px-2 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <div className="font-medium text-neutral-300">
            {activeConnection ? activeConnection.name : "No connection"}
          </div>
          <div className="truncate">{activeConnection?.base_url ?? "Open settings to add one"}</div>
        </button>
      </div>
    </aside>
  );
}
