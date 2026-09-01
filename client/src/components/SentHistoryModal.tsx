import { useMemo, useState } from "react";
import { useConversations } from "@/hooks/use-inbox";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, Search, Phone, Inbox as InboxIcon, UserCheck } from "lucide-react";

const LIMIT = 5000;
const LIMIT_STEP = 100;

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

function daysSince(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function SentHistoryModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [listLimit, setListLimit] = useState(LIMIT_STEP);
  const { data: conversations = [] } = useConversations(listLimit);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [daysPreset, setDaysPreset] = useState<string>("all");
  const [daysMin, setDaysMin] = useState<string>("");
  const [daysMax, setDaysMax] = useState<string>("");
  const [contactedLocal, setContactedLocal] = useState<Record<number, boolean>>({});

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const min = daysMin !== "" ? Math.max(0, Number(daysMin)) : null;
    const max = daysMax !== "" ? Math.max(0, Number(daysMax)) : null;
    const presetNum = daysPreset !== "all" ? Number(daysPreset) : null;

    const list = conversations
      .filter((c) => {
        if (!query) return true;
        return (
          c.contactName?.toLowerCase().includes(query) ||
          c.waId?.includes(query) ||
          c.lastMessage?.toLowerCase().includes(query)
        );
      })
      .map((c) => ({ conv: c, days: daysSince(c.lastMessageTimestamp) }))
      .filter(({ days }) => {
        if (days === null) return false;
        if (presetNum !== null) return days <= presetNum;
        if (min !== null && days < min) return false;
        if (max !== null && days > max) return false;
        return true;
      })
      .sort((a, b) => {
        const at = a.conv.lastMessageTimestamp ? new Date(a.conv.lastMessageTimestamp).getTime() : 0;
        const bt = b.conv.lastMessageTimestamp ? new Date(b.conv.lastMessageTimestamp).getTime() : 0;
        return bt - at;
      });
    return list;
  }, [conversations, search, daysPreset, daysMin, daysMax]);

  const copyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(phone);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  const toggleContacted = async (id: number, current: boolean) => {
    try {
      const res = await fetch(`/api/conversations/${id}/contacted`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacted: !current }),
      });
      if (!res.ok) throw new Error("No se pudo actualizar");
      await res.json();
      setContactedLocal((map) => ({ ...map, [id]: !current }));
    } catch (error) {
      console.error(error);
    }
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

        <div className="grid grid-cols-1 gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, número o mensaje..."
              className="pl-9 bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={daysPreset}
              onChange={(e) => {
                setDaysPreset(e.target.value);
                if (e.target.value !== "all") {
                  setDaysMin("");
                  setDaysMax("");
                }
              }}
              className="h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none"
            >
              <option value="all">Todos los días</option>
              <option value="1">Últimas 24 h</option>
              <option value="3">Últimos 3 días</option>
              <option value="7">Últimos 7 días</option>
              <option value="15">Últimos 15 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
            </select>

            <span className="text-slate-500 text-sm">Rango:</span>
            <Input
              type="number"
              min="0"
              value={daysMin}
              onChange={(e) => {
                setDaysMin(e.target.value);
                setDaysPreset("all");
              }}
              placeholder="Min"
              className="w-20 h-9 bg-slate-950 border-slate-700 text-slate-100 text-sm"
            />
            <span className="text-slate-500 text-sm">–</span>
            <Input
              type="number"
              min="0"
              value={daysMax}
              onChange={(e) => {
                setDaysMax(e.target.value);
                setDaysPreset("all");
              }}
              placeholder="Max"
              className="w-20 h-9 bg-slate-950 border-slate-700 text-slate-100 text-sm"
            />
            <span className="text-slate-500 text-sm">días</span>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Sin resultados.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map(({ conv, days }) => {
                const phone = formatWaPhone(conv.waId);
                const name = conv.contactName || phone || "Sin nombre";
                const isContacted = contactedLocal[conv.id] ?? conv.contacted;
                return (
                  <li key={conv.id}>
                    <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/60 hover:bg-slate-800">
                      <Link
                        href={`/?conversationId=${conv.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-3 flex-1 min-w-0 basis-full sm:basis-auto text-left"
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
                      </Link>
                      <div
                        title="Días desde el último mensaje"
                        className="flex items-center justify-center w-12 h-10 rounded-lg bg-slate-700/40 text-slate-200 text-sm font-semibold tabular-nums"
                      >
                        {days === null ? "—" : days}
                        <span className="ml-0.5 text-[10px] text-slate-400 font-normal">d</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleContacted(conv.id, isContacted)}
                        title={isContacted ? "Contactado" : "Marcar como contactado"}
                        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                          isContacted
                            ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                            : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {isContacted ? "Contactado" : "No contactado"}
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
          <div className="flex items-center justify-center gap-3 pt-3">
            <span className="text-xs text-slate-500">
              {conversations.length} contactos cargados
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={rows.length < listLimit || listLimit >= LIMIT}
              onClick={() => setListLimit((l) => Math.min(l + LIMIT_STEP, LIMIT))}
              className="h-9 border-slate-600 text-slate-200 hover:bg-slate-800"
            >
              Cargar más (+{LIMIT_STEP})
            </Button>
          </div>
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
