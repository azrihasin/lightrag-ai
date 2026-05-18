import { useEffect, useState, type FC } from "react";
import { PlusIcon, MessageSquareIcon, ArchiveIcon, PencilIcon, CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/lib/session-store";
import type { ChatSession } from "@/lib/chat-history-api";

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
}

const SessionItem: FC<SessionItemProps> = ({ session, isActive, onSelect, onRename, onArchive }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground",
      )}
      onClick={() => { if (!editing) onSelect(); }}
    >
      <MessageSquareIcon className="size-4 shrink-0 opacity-60" />

      {editing ? (
        <input
          autoFocus
          className="flex-1 bg-transparent outline-none text-foreground text-sm min-w-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setDraft(session.title); setEditing(false); }
          }}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate">{session.title}</span>
      )}

      <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        {editing ? (
          <>
            <button
              type="button"
              className="p-0.5 rounded hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); commitRename(); }}
            >
              <CheckIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="p-0.5 rounded hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setDraft(session.title); setEditing(false); }}
            >
              <XIcon className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="p-0.5 rounded hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setDraft(session.title); setEditing(true); }}
            >
              <PencilIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="p-0.5 rounded hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            >
              <ArchiveIcon className="size-3.5" />
            </button>
          </>
        )}
      </span>
    </div>
  );
};

interface SessionSidebarProps {
  onSessionSelected: (sessionId: string) => void;
  onNewSession: () => void;
}

export const SessionSidebar: FC<SessionSidebarProps> = ({ onSessionSelected, onNewSession }) => {
  const { sessions, activeSessionId, loading, loadSessions, selectSession, renameSession, archiveSession } =
    useSessionStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleSelect = async (id: string) => {
    await selectSession(id);
    onSessionSelected(id);
  };

  const handleArchive = async (id: string) => {
    await archiveSession(id);
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chats</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onNewSession} title="New chat">
          <PlusIcon className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {loading && sessions.length === 0 && (
          <div className="space-y-1.5 px-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">No chats yet</p>
        )}

        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={() => handleSelect(session.id)}
            onRename={(title) => renameSession(session.id, title)}
            onArchive={() => handleArchive(session.id)}
          />
        ))}
      </div>
    </aside>
  );
};
