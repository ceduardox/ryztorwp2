import { useMemo, useState } from "react";
import { useConversations } from "@/hooks/use-inbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, Search, Phone, Inbox as InboxIcon } from "lucide-react";

const LIMIT = 5000;

function initialOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase();
}

function formatWaPhone(raw?: string | null) {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return "+" + digits;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-BO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SentHistoryModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: conversations = [] } = useConversations(LIMIT);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = conversations
      .filter((c) => {
        if (!query) return true;
        return (
          c.contactName?.toLowerCase().includes(query) ||
          c.waId?.includes(query) ||
          c.lastMessage?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const at = a.lastMessageTimestamp ? new Date(a.lastMessageTimestamp).getTime() : 0;
        const bt = b.lastMessageTimestamp ? new Date(b.lastMessageTimestamp).getTime() : 0;
        return bt - at;
      });
    return list;
  }, [conversations, search]);

  const copyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(phone);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <InboxIcon className="h-5 w-5 text-emerald-400" />
            Enviados y entregados
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Toca el nombre para abrir el chat. Toca el número para copiarlo.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, número o mensaje..."
            className="pl-9 bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Sin resultados.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((conv) => {
                const phone = formatWaPhone(conv.waId);
                const name = conv.contactName || phone || "Sin nombre";
                return (
                  <li key={conv.id}>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/60 hover:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          window.location.href = `/?conversationId=${conv.id}`;
                        }}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        title="Abrir chat"
                      >
                        <div className="h-10 w-10 flex-0 flex items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 font-semibold text-sm">
                          {initialOf(conv.contactName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-100 truncate">{name}</div>
                          <div className="text-xs text-slate-400 truncate">
                            {formatDateTime(conv.lastMessageTimestamp)}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => copyPhone(phone)}
                        title="Copiar número"
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-200 transition-colors"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span className="tabular-nums">{phone || "—"}</span>
                        {copied === phone ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HistoryModalButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Enviados y entregados"
      onClick={onClick}
      className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
    >
      <Copy className="h-5 w-5" />
    </Button>
  );
}
