import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, Label } from "@shared/schema";
import { useConversation } from "@/hooks/use-inbox";
import { useAuth } from "@/hooks/use-auth";
import { ChatArea } from "./ChatArea";
import { Phone, PhoneOff, Clock, AlertCircle, Truck, CheckCircle, Check, Zap, ArrowLeft, Tag, Package, Search, X, Users, CalendarClock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// CSS animation keyframes - Futuristic style
const pulseAnimation = `
@keyframes pulse-urgent {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes ring-pulse {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
@keyframes glow-line {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes scan-line {
  0% { transform: translateY(-100%); opacity: 0; }
  50% { opacity: 0.5; }
  100% { transform: translateY(100%); opacity: 0; }
}
.animate-pulse-urgent { animation: pulse-urgent 1.5s ease-in-out infinite; }
.animate-ring-pulse { animation: ring-pulse 1.5s ease-in-out infinite; }
.animate-glow-line { 
  background: linear-gradient(90deg, transparent, rgba(16,185,129,0.3), transparent);
  background-size: 200% 100%;
  animation: glow-line 3s ease-in-out infinite;
}
.animate-scan-line { animation: scan-line 4s ease-in-out infinite; }
`;

interface KanbanViewProps {
  conversations: Conversation[];
  isLoading: boolean;
  daysToShow: number;
  onDaysChange: (days: number) => void;
  onLoadMore: () => void;
  hasMoreConversations: boolean;
  maxDays: number;
  columnVisibleLimit: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
}

interface ColumnProps {
  title: string;
  items: Conversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  columnType: "humano" | "nuevo" | "llamar" | "proceso" | "listo" | "entregado";
  labels: Label[];
  showAgentAssignment: boolean;
  getAssignedAgentName: (assignedAgentId: number | null) => string | null;
  enableDrag: boolean;
  draggingConversationId: number | null;
  isDropTarget: boolean;
  onDragStartCard: (conversationId: number) => void;
  onDragEndCard: () => void;
  onDragOverColumn: (columnType: TabType) => void;
  onDropOnColumn: (columnType: TabType) => void;
  unreadIds: Set<number>;
  assignedSpotlightIds: Set<number>;
}

const KANBAN_READ_STATE_KEY = "ryzapp_kanban_read_state_v1";
const KANBAN_ASSIGNMENT_SEEN_STATE_KEY = "ryzapp_kanban_assignment_seen_state_v1";

interface AgentListItem {
  id: number;
  name: string;
}

type CallStatus = "answered" | "missed" | "later" | "clear";

function getInitials(name: string): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDate(timestamp: Date | string | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const timeStr = date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  
  if (isToday) {
    return `Hoy, ${timeStr}`;
  }
  
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${timeStr}`;
}

function readKanbanReadState(): Record<number, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KANBAN_READ_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const normalized: Record<number, number> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const id = Number(key);
      const ts = Number(value);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(ts) && ts > 0) {
        normalized[id] = ts;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistKanbanReadState(state: Record<number, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KANBAN_READ_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function readAssignmentSeenState(): Record<number, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KANBAN_ASSIGNMENT_SEEN_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const normalized: Record<number, number> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const id = Number(key);
      const ts = Number(value);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(ts) && ts > 0) {
        normalized[id] = ts;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistAssignmentSeenState(state: Record<number, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KANBAN_ASSIGNMENT_SEEN_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function getAssignedToMeTimestamp(conv: Conversation): number {
  const raw = (conv as any).assignedToMeAt;
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function KanbanCard({ 
  conv, 
  isActive, 
  onSelect,
  columnType,
  labels,
  showAgentAssignment,
  assignedAgentName,
  enableDrag,
  isDragging,
  onDragStartCard,
  onDragEndCard,
  isUnread,
  isAssignedSpotlight,
}: { 
  conv: Conversation; 
  isActive: boolean; 
  onSelect: () => void;
  columnType: "humano" | "nuevo" | "llamar" | "proceso" | "listo" | "entregado";
  labels: Label[];
  showAgentAssignment: boolean;
  assignedAgentName: string | null;
  enableDrag: boolean;
  isDragging: boolean;
  onDragStartCard: (conversationId: number) => void;
  onDragEndCard: () => void;
  isUnread: boolean;
  isAssignedSpotlight: boolean;
}) {
  const name = conv.contactName || conv.waId;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const callStatusMutation = useMutation({
    mutationFn: async (status: CallStatus) => {
      const res = await fetch(`/api/conversations/${conv.id}/call-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("No se pudo guardar el estado de llamada");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  
  const getBadgeConfig = () => {
    switch (columnType) {
      case "humano":
        return { text: "Urgente", bgColor: "bg-red-500/20", textColor: "text-red-400", dotColor: "bg-red-500" };
      case "llamar":
        return { text: "Llamar", bgColor: "bg-emerald-500/20", textColor: "text-emerald-400", dotColor: "bg-emerald-500" };
      case "proceso":
        return { text: "En Proceso", bgColor: "bg-amber-500/20", textColor: "text-amber-400", dotColor: "bg-amber-500" };
      case "listo":
        return { text: "Listo", bgColor: "bg-cyan-500/20", textColor: "text-cyan-400", dotColor: "bg-cyan-500" };
      case "entregado":
        return { text: "Entregado", bgColor: "bg-slate-500/20", textColor: "text-slate-400", dotColor: "bg-slate-500" };
      default:
        return null;
    }
  };

  const getCardStyle = () => {
    switch (columnType) {
      case "humano":
        return "border-l-2 border-l-red-500 bg-slate-800/80 hover:bg-slate-700/80";
      case "llamar":
        return "border-l-2 border-l-emerald-500 bg-slate-800/80 hover:bg-slate-700/80";
      case "proceso":
        return "border-l-2 border-l-amber-500 bg-slate-800/80 hover:bg-slate-700/80";
      case "listo":
        return "border-l-2 border-l-cyan-500 bg-slate-800/80 hover:bg-slate-700/80";
      case "entregado":
        return "border-l-2 border-l-slate-500 bg-slate-800/80 hover:bg-slate-700/80";
      default:
        return "bg-slate-800/80 hover:bg-slate-700/80";
    }
  };

  const getAvatarColor = () => {
    switch (columnType) {
      case "humano": return "bg-gradient-to-br from-red-500 to-rose-600";
      case "llamar": return "bg-gradient-to-br from-emerald-500 to-teal-600";
      case "proceso": return "bg-gradient-to-br from-amber-500 to-orange-600";
      case "listo": return "bg-gradient-to-br from-cyan-500 to-blue-600";
      case "entregado": return "bg-gradient-to-br from-slate-500 to-slate-600";
      default: return "bg-gradient-to-br from-emerald-500 to-cyan-600";
    }
  };
  
  const badge = getBadgeConfig();
  const showPhone = conv.shouldCall || columnType === "llamar";
  const isUrgent = columnType === "humano";
  const callStatus = ((conv as any).callStatus || "") as Exclude<CallStatus, "clear"> | "";
  const callAttempts = Number((conv as any).callAttempts || 0);
  const showCallChip = true;
  const callChipConfig = (() => {
    if (callStatus === "answered") {
      return {
        label: "Contesto",
        icon: CheckCircle,
        className: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
      };
    }
    if (callStatus === "missed") {
      return {
        label: `No contesto${callAttempts > 0 ? ` · ${callAttempts}` : ""}`,
        icon: PhoneOff,
        className: "bg-red-500/15 text-red-300 border-red-400/30",
      };
    }
    if (callStatus === "later") {
      return {
        label: "Otro dia",
        icon: CalendarClock,
        className: "bg-amber-500/15 text-amber-300 border-amber-400/30",
      };
    }
    return {
      label: "Pendiente",
      icon: Phone,
      className: "bg-slate-700/60 text-slate-300 border-slate-600/70",
    };
  })();
  const CallChipIcon = callChipConfig.icon;
  
  return (
    <div
      draggable={enableDrag}
      onDragStart={() => onDragStartCard(conv.id)}
      onDragEnd={onDragEndCard}
      onClick={onSelect}
      className={cn(
        "relative rounded-xl p-4 cursor-pointer backdrop-blur-sm select-none",
        enableDrag && "cursor-grab active:cursor-grabbing",
        "border border-slate-700/50 shadow-lg shadow-black/20",
        "transition-transform duration-100 active:scale-[0.97]",
        getCardStyle(),
        isActive && "ring-2 ring-emerald-500/50 shadow-emerald-500/20",
        isAssignedSpotlight && "border-cyan-300/80 bg-cyan-950/30 shadow-cyan-500/20 ring-1 ring-cyan-300/40",
        isUrgent && "animate-ring-pulse",
        isDragging && "opacity-40 scale-[0.98]",
        isUnread && "shadow-cyan-500/10"
      )}
      data-testid={`kanban-card-${conv.id}`}
    >
      {isUnread && (
        <div
          className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-cyan-400/90 shadow-[0_0_12px_rgba(34,211,238,0.6)]"
          aria-hidden="true"
        />
      )}
      {isAssignedSpotlight && (
        <div
          className="absolute inset-x-3 top-0 h-px bg-cyan-300/80 shadow-[0_0_14px_rgba(103,232,249,0.75)]"
          aria-hidden="true"
        />
      )}
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-lg",
          getAvatarColor()
        )}>
          {getInitials(name)}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white truncate">
              {name}
            </span>
            <div className="flex items-center gap-1">
              {isUrgent && (
                <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 animate-pulse-urgent" />
              )}
              {showPhone && (
                <Phone className="h-5 w-5 text-emerald-400 flex-shrink-0 animate-pulse-urgent" fill="currentColor" />
              )}
              {columnType === "listo" && (
                <CheckCircle className="h-5 w-5 text-cyan-400 flex-shrink-0" />
              )}
              {columnType === "entregado" && (
                <Truck className="h-5 w-5 text-slate-400 flex-shrink-0" />
              )}
            </div>
          </div>
          
          {badge && (
            <div className={cn(
              "inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-current/20",
              badge.bgColor, badge.textColor
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", badge.dotColor)} />
              {badge.text}
            </div>
          )}

          {showCallChip && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className={cn(
                    "ml-1.5 mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                    "transition-colors hover:bg-slate-700/80",
                    callChipConfig.className,
                  )}
                  title="Cambiar resultado de llamada"
                  data-testid={`button-call-status-${conv.id}`}
                >
                  <CallChipIcon className="h-3 w-3" />
                  {callChipConfig.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                onClick={(event) => event.stopPropagation()}
                className="w-44 !bg-slate-900 !border-slate-700 !text-slate-200 [&_svg]:!text-slate-300"
              >
                <DropdownMenuItem
                  onClick={() => callStatusMutation.mutate("answered")}
                  className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
                >
                  <CheckCircle className="h-4 w-4 mr-2 text-emerald-300" />
                  Contesto
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => callStatusMutation.mutate("missed")}
                  className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
                >
                  <PhoneOff className="h-4 w-4 mr-2 text-red-300" />
                  No contesto
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => callStatusMutation.mutate("later")}
                  className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
                >
                  <CalendarClock className="h-4 w-4 mr-2 text-amber-300" />
                  Otro dia
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => callStatusMutation.mutate("clear")}
                  className="!text-slate-400 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Limpiar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showAgentAssignment && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
              {assignedAgentName ? `Agente: ${assignedAgentName}` : "Sin agente"}
            </div>
          )}
          
          {(() => {
            const labelIds = [conv.labelId, conv.labelId2].filter(
              (value): value is number => typeof value === "number" && value > 0,
            );
            if (labelIds.length === 0) return null;
            const colorMap: Record<string, string> = {
              blue: "bg-blue-500/20 text-blue-400",
              green: "bg-green-500/20 text-green-400",
              yellow: "bg-yellow-500/20 text-yellow-400",
              red: "bg-red-500/20 text-red-400",
              purple: "bg-purple-500/20 text-purple-400",
              orange: "bg-orange-500/20 text-orange-400",
            };
            return (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {labelIds.slice(0, 2).map((labelId) => {
                  const label = labels.find((item) => item.id === labelId);
                  if (!label) return null;
                  return (
                    <div
                      key={label.id}
                      className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", colorMap[label.color] || "bg-slate-500/20 text-slate-400")}
                      data-testid={`text-label-${label.id}-conv-${conv.id}`}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {label.name}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {conv.reminderAt && (
            <div className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-400/30">
              <Clock className="h-2.5 w-2.5" />
              {formatDate(conv.reminderAt)}
            </div>
          )}

          {columnType === "nuevo" && conv.lastMessage && (
            <p className="text-sm text-slate-400 mt-2 line-clamp-2">
              {conv.lastMessage}
            </p>
          )}
          
          <div className="flex items-center gap-1 mt-2 text-xs text-slate-500">
            {columnType === "nuevo" && <Clock className="h-3 w-3" />}
            <span>{formatDate(conv.lastMessageTimestamp)}</span>
            {enableDrag && (
              <span className="ml-auto rounded-full border border-slate-600/60 bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-slate-400">
                arrastrar
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({ title, items, activeId, onSelect, columnType, labels, showAgentAssignment, getAssignedAgentName, enableDrag, draggingConversationId, isDropTarget, onDragStartCard, onDragEndCard, onDragOverColumn, onDropOnColumn, unreadIds, assignedSpotlightIds }: ColumnProps) {
  const getColumnHeaderStyle = () => {
    switch (columnType) {
      case "humano":
        return "from-red-600/80 to-rose-600/80";
      case "llamar":
        return "from-emerald-600/80 to-teal-600/80";
      case "proceso":
        return "from-amber-600/80 to-orange-600/80";
      case "listo":
        return "from-cyan-600/80 to-blue-600/80";
      case "entregado":
        return "from-slate-600/80 to-slate-700/80";
      default:
        return "from-slate-700/80 to-slate-800/80";
    }
  };

  const getColumnGlow = () => {
    switch (columnType) {
      case "humano": return "shadow-red-500/20";
      case "llamar": return "shadow-emerald-500/20";
      case "proceso": return "shadow-amber-500/20";
      case "listo": return "shadow-cyan-500/20";
      case "entregado": return "shadow-slate-500/20";
      default: return "shadow-slate-500/20";
    }
  };

  const getColumnIcon = () => {
    switch (columnType) {
      case "humano":
        return <AlertCircle className="h-4 w-4" />;
      case "llamar":
        return <Phone className="h-4 w-4" />;
      case "proceso":
        return <Package className="h-4 w-4" />;
      case "listo":
        return <CheckCircle className="h-4 w-4" />;
      case "entregado":
        return <Truck className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <div className={cn(
      "flex flex-col h-full min-w-0 flex-1 mx-1.5 first:ml-0 last:mr-0",
      "bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30",
      "shadow-xl", getColumnGlow(),
      isDropTarget && "ring-2 ring-emerald-400/70 border-emerald-400/60"
    )}
      onDragOver={(e) => {
        if (!enableDrag || draggingConversationId === null) return;
        e.preventDefault();
        onDragOverColumn(columnType);
      }}
      onDrop={(e) => {
        if (!enableDrag || draggingConversationId === null) return;
        e.preventDefault();
        onDropOnColumn(columnType);
      }}
    >
      <div className={cn(
        "flex items-center gap-2 px-4 py-3 rounded-t-2xl relative overflow-hidden",
        "bg-gradient-to-r backdrop-blur-sm text-white",
        getColumnHeaderStyle()
      )}>
        <div className="absolute inset-0 animate-glow-line" />
        <div className="relative flex items-center gap-2">
          {getColumnIcon()}
          <span className="font-semibold text-sm">{title}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm font-bold">
            {items.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {isDropTarget && draggingConversationId !== null && (
          <div className="rounded-xl border border-dashed border-emerald-400/60 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
            Suelta aqui para mover
          </div>
        )}
        {items.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-800/50 flex items-center justify-center border border-slate-700/50">
              <Zap className="h-5 w-5 text-slate-600" />
            </div>
            <p className="text-xs text-slate-500">Sin conversaciones</p>
          </div>
        ) : (
          items.map((conv) => (
            <KanbanCard
              key={conv.id}
              conv={conv}
              isActive={activeId === conv.id}
              onSelect={() => onSelect(conv.id)}
              columnType={columnType}
              labels={labels}
              showAgentAssignment={showAgentAssignment}
              assignedAgentName={getAssignedAgentName(conv.assignedAgentId)}
              enableDrag={enableDrag}
              isDragging={draggingConversationId === conv.id}
              onDragStartCard={onDragStartCard}
              onDragEndCard={onDragEndCard}
              isUnread={unreadIds.has(conv.id) && (columnType === "nuevo" || columnType === "proceso")}
              isAssignedSpotlight={assignedSpotlightIds.has(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

type TabType = "humano" | "nuevo" | "llamar" | "proceso" | "listo" | "entregado";

const tabConfig: { key: TabType; label: string; shortLabel: string; icon: typeof AlertCircle }[] = [
  { key: "humano", label: "Interaccion Humana", shortLabel: "Humano", icon: AlertCircle },
  { key: "nuevo", label: "Esperando Confirmaci.", shortLabel: "Nuevos", icon: Clock },
  { key: "llamar", label: "Llamar", shortLabel: "Llamar", icon: Phone },
  { key: "proceso", label: "Pedido en Proceso", shortLabel: "Proceso", icon: Package },
  { key: "listo", label: "Listo para Enviar", shortLabel: "Listo", icon: CheckCircle },
  { key: "entregado", label: "Enviados y Entregados", shortLabel: "Enviado", icon: Truck },
];

export function KanbanView({ conversations, isLoading, daysToShow, onDaysChange, onLoadMore, hasMoreConversations, maxDays, columnVisibleLimit, searchQuery, onSearchChange, onClearSearch }: KanbanViewProps) {
  const { isAdmin, isAgent, user } = useAuth();
  const canDragKanban = isAdmin || isAgent;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [readStateByConversation, setReadStateByConversation] = useState<Record<number, number>>(() => readKanbanReadState());
  const [assignmentSeenStateByConversation, setAssignmentSeenStateByConversation] = useState<Record<number, number>>(() => readAssignmentSeenState());
  const [mobileTab, setMobileTab] = useState<TabType>("nuevo");
  const [filterLabelId, setFilterLabelId] = useState<number | null>(null);
  const [filterAgentId, setFilterAgentId] = useState<number | null>(null);
  const [draggingConversationId, setDraggingConversationId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TabType | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const hasAppliedUrlConversation = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const tabRefs = useRef<Record<TabType, HTMLButtonElement | null>>({
    humano: null,
    nuevo: null,
    llamar: null,
    proceso: null,
    listo: null,
    entregado: null,
  });
  const { data: activeConversation } = useConversation(activeId);
  const isMobileChatOpen = !!(activeId && activeConversation);
  const { data: labels = [] } = useQuery<Label[]>({ queryKey: ["/api/labels"] });
  const ownedLabels = useMemo(
    () =>
      labels.filter((label) =>
        user?.role === "agent" ? label.agentId === user.agentId : !label.agentId
      ),
    [labels, user?.role, user?.agentId],
  );
  const { data: agents = [] } = useQuery<AgentListItem[]>({
    queryKey: ["/api/agents"],
    enabled: isAdmin,
  });

  const agentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const agent of agents) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agents]);

  const getAssignedAgentName = (assignedAgentId: number | null) => {
    if (!assignedAgentId) return null;
    return agentNameById.get(assignedAgentId) || null;
  };
  const selectedAgentName = filterAgentId ? (agentNameById.get(filterAgentId) || `Agente ${filterAgentId}`) : "Todos";

  const markConversationRead = (conversationId: number, lastMessageTimestamp?: Date | string | null) => {
    const ts = lastMessageTimestamp ? new Date(lastMessageTimestamp).getTime() : Date.now();
    if (!Number.isFinite(ts) || ts <= 0) return;
    setReadStateByConversation((prev) => {
      if ((prev[conversationId] || 0) >= ts) return prev;
      const next = { ...prev, [conversationId]: ts };
      persistKanbanReadState(next);
      return next;
    });
  };

  const markAssignmentSeen = (conversationId: number, assignedToMeTimestamp: number) => {
    if (!Number.isFinite(assignedToMeTimestamp) || assignedToMeTimestamp <= 0) return;
    setAssignmentSeenStateByConversation((prev) => {
      if ((prev[conversationId] || 0) >= assignedToMeTimestamp) return prev;
      const next = { ...prev, [conversationId]: assignedToMeTimestamp };
      persistAssignmentSeenState(next);
      return next;
    });
  };

  const conversationsByAgent = useMemo(() => {
    if (!isAdmin || !filterAgentId) return conversations;
    return conversations.filter((conversation) => conversation.assignedAgentId === filterAgentId);
  }, [conversations, isAdmin, filterAgentId]);

  const unreadIds = useMemo(() => {
    const unread = new Set<number>();
    for (const conv of conversationsByAgent) {
      const lastTs = conv.lastMessageTimestamp ? new Date(conv.lastMessageTimestamp).getTime() : 0;
      const seenTs = readStateByConversation[conv.id] || 0;
      if (lastTs > 0 && lastTs > seenTs) {
        unread.add(conv.id);
      }
    }
    return unread;
  }, [conversationsByAgent, readStateByConversation]);

  const assignedSpotlightIds = useMemo(() => {
    const spotlight = new Set<number>();
    for (const conv of conversationsByAgent) {
      const assignedTs = getAssignedToMeTimestamp(conv);
      if (assignedTs > 0 && assignedTs > (assignmentSeenStateByConversation[conv.id] || 0)) {
        spotlight.add(conv.id);
      }
    }
    return spotlight;
  }, [conversationsByAgent, assignmentSeenStateByConversation]);

  const handleSelectConversation = (id: number) => {
    const selected = conversationsByAgent.find((conv) => conv.id === id);
    if (selected) {
      markConversationRead(id, selected.lastMessageTimestamp);
      markAssignmentSeen(id, getAssignedToMeTimestamp(selected));
    }
    setActiveId(id);
  };

  useEffect(() => {
    if (hasAppliedUrlConversation.current) return;
    hasAppliedUrlConversation.current = true;

    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("conversationId");
    if (!rawId) return;

    const conversationId = Number(rawId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return;

    handleSelectConversation(conversationId);
  }, [conversationsByAgent]);

  useEffect(() => {
    const openedConversationId = activeConversation?.conversation?.id;
    if (!activeId || openedConversationId !== activeId) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("conversationId") !== String(activeId)) return;

    params.delete("conversationId");
    const cleanQuery = params.toString();
    const cleanUrl = cleanQuery ? `${window.location.pathname}?${cleanQuery}` : window.location.pathname;
    window.history.replaceState(window.history.state, "", cleanUrl);
  }, [activeId, activeConversation?.conversation?.id]);

  useEffect(() => {
    if (filterAgentId && !agents.some((agent) => agent.id === filterAgentId)) {
      setFilterAgentId(null);
    }
  }, [filterAgentId, agents]);

  useEffect(() => {
    if (!isAdmin && filterAgentId !== null) {
      setFilterAgentId(null);
    }
  }, [isAdmin, filterAgentId]);

  useEffect(() => {
    const pendingUrlConversationId = new URLSearchParams(window.location.search).get("conversationId");
    if (
      activeId &&
      pendingUrlConversationId !== String(activeId) &&
      !conversationsByAgent.some((conversation) => conversation.id === activeId)
    ) {
      setActiveId(null);
    }
  }, [activeId, conversationsByAgent]);

  useEffect(() => {
    if (activeId && activeConversation?.conversation) {
      markConversationRead(activeId, activeConversation.conversation.lastMessageTimestamp);
    }
  }, [activeId, activeConversation?.conversation?.lastMessageTimestamp]);

  const getConversationColumn = (conv: Conversation): TabType => {
    if (conv.needsHumanAttention) return "humano";
    if (conv.orderStatus === "delivered") return "entregado";
    if (conv.orderStatus === "ready") return "listo";
    if (conv.orderStatus === "pending") return "proceso";
    if (conv.shouldCall) return "llamar";
    return "nuevo";
  };

  const moveCardMutation = useMutation({
    mutationFn: async ({ conversationId, targetColumn }: { conversationId: number; targetColumn: TabType }) => {
      const res = await fetch(`/api/conversations/${conversationId}/kanban-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: targetColumn }),
      });
      if (!res.ok) throw new Error("No se pudo mover la tarjeta");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error al mover", description: error.message, variant: "destructive" });
    },
  });

  const filtered = filterLabelId
    ? conversationsByAgent.filter((c) => c.labelId === filterLabelId || c.labelId2 === filterLabelId)
    : conversationsByAgent;

  const getConversationSortTimestamp = (conv: Conversation) => {
    if (assignedSpotlightIds.has(conv.id)) {
      const assignedTs = getAssignedToMeTimestamp(conv);
      if (assignedTs > 0) return assignedTs;
    }
    if (conv.lastMessageTimestamp) {
      const lastTs = new Date(conv.lastMessageTimestamp).getTime();
      if (Number.isFinite(lastTs)) return lastTs;
    }
    if (conv.updatedAt) {
      const updatedTs = new Date(conv.updatedAt).getTime();
      if (Number.isFinite(updatedTs)) return updatedTs;
    }
    return 0;
  };

  const sortByRecent = (items: Conversation[]) =>
    [...items].sort((a, b) => getConversationSortTimestamp(b) - getConversationSortTimestamp(a));

  const displayLimit = Math.max(1, columnVisibleLimit);

  const humano = sortByRecent(filtered.filter((c) => c.needsHumanAttention)).slice(0, displayLimit);
  const entregados = sortByRecent(
    filtered.filter((c) => c.orderStatus === "delivered" && !c.needsHumanAttention),
  ).slice(0, displayLimit);
  const listos = sortByRecent(
    filtered.filter((c) => c.orderStatus === "ready" && !c.needsHumanAttention),
  ).slice(0, displayLimit);
  const llamar = sortByRecent(
    filtered.filter(
      (c) =>
        c.shouldCall &&
        !c.needsHumanAttention &&
        c.orderStatus !== "pending" &&
        c.orderStatus !== "ready" &&
        c.orderStatus !== "delivered",
    ),
  ).slice(0, displayLimit);
  const enProceso = sortByRecent(
    filtered.filter((c) => c.orderStatus === "pending" && !c.needsHumanAttention),
  ).slice(0, displayLimit);
  const nuevos = sortByRecent(filtered.filter((c) => !c.orderStatus && !c.shouldCall && !c.needsHumanAttention)).slice(0, displayLimit);

  const columnData: Record<TabType, { items: Conversation[]; title: string }> = {
    humano: { items: humano, title: "Interaccion Humana" },
    nuevo: { items: nuevos, title: "Esperando Confirmaci." },
    llamar: { items: llamar, title: "Llamar" },
    proceso: { items: enProceso, title: "Pedido en Proceso" },
    listo: { items: listos, title: "Listo para Enviar" },
    entregado: { items: entregados, title: "Enviados y Entregados" },
  };

  const getTabColor = (tab: TabType, isActive: boolean) => {
    const colors: Record<TabType, string> = {
      humano: isActive ? "bg-red-500/20 text-red-400 border-red-500/50" : "text-slate-500 border-transparent",
      nuevo: isActive ? "bg-slate-600/30 text-slate-300 border-slate-500/50" : "text-slate-500 border-transparent",
      llamar: isActive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50" : "text-slate-500 border-transparent",
      proceso: isActive ? "bg-amber-500/20 text-amber-400 border-amber-500/50" : "text-slate-500 border-transparent",
      listo: isActive ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50" : "text-slate-500 border-transparent",
      entregado: isActive ? "bg-slate-500/20 text-slate-400 border-slate-500/50" : "text-slate-500 border-transparent",
    };
    return colors[tab];
  };

  const moveMobileTab = (direction: "next" | "prev") => {
    const order: TabType[] = ["humano", "nuevo", "llamar", "proceso", "listo", "entregado"];
    const currentIndex = order.indexOf(mobileTab);
    const nextIndex = direction === "next"
      ? Math.min(order.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    if (nextIndex !== currentIndex) {
      setMobileTab(order[nextIndex]);
    }
  };

  const handleMobileTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
    touchStartY.current = e.changedTouches[0]?.clientY ?? null;
    setIsSwiping(true);
  };

  const handleMobileTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const currentY = e.changedTouches[0]?.clientY ?? touchStartY.current;
    const dx = currentX - touchStartX.current;
    const dy = currentY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy)) {
      const resisted = Math.max(-56, Math.min(56, dx * 0.35));
      setSwipeOffset(resisted);
    }
  };

  const handleMobileTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
    const dx = endX - touchStartX.current;
    const dy = endY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    setIsSwiping(false);
    setSwipeOffset(0);
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) moveMobileTab("next");
    if (dx > 0) moveMobileTab("prev");
  };

  const handleMobileTouchCancel = () => {
    touchStartX.current = null;
    touchStartY.current = null;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  useEffect(() => {
    const activeTab = tabRefs.current[mobileTab];
    activeTab?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [mobileTab]);

  useEffect(() => {
    if (filterLabelId && !ownedLabels.some((label) => label.id === filterLabelId)) {
      setFilterLabelId(null);
    }
  }, [filterLabelId, ownedLabels]);

  const handleDragStartCard = (conversationId: number) => {
    if (!canDragKanban) return;
    setDraggingConversationId(conversationId);
  };

  const handleDragEndCard = () => {
    setDraggingConversationId(null);
    setDragOverColumn(null);
  };

  const handleDragOverColumn = (columnType: TabType) => {
    setDragOverColumn(columnType);
  };

  const handleDropOnColumn = (targetColumn: TabType) => {
    if (!canDragKanban || draggingConversationId === null) return;
    const conversation = conversationsByAgent.find((c) => c.id === draggingConversationId);
    if (!conversation) {
      handleDragEndCard();
      return;
    }
    const currentColumn = getConversationColumn(conversation);
    if (currentColumn !== targetColumn) {
      moveCardMutation.mutate({ conversationId: draggingConversationId, targetColumn });
    }
    handleDragEndCard();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin h-10 w-10 border-3 border-emerald-500 border-t-transparent rounded-full" />
          <span className="text-slate-400 text-sm">Cargando datos...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col w-full bg-gradient-to-br from-slate-900 via-emerald-950/30 to-slate-900 relative overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: pulseAnimation }} />
      
      {/* Animated background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-violet-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '4s' }} />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>
      
      <div className={cn(
        "relative z-10 flex items-center gap-2 px-3 py-2 bg-slate-800/50 backdrop-blur-lg border-b border-slate-700/30",
        isMobileChatOpen && "hidden md:flex",
      )}>
        <div className="md:hidden relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            type="text"
            placeholder="Buscar chat..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-8 pr-7 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-emerald-500"
            data-testid="input-search-mobile-inline"
          />
          {searchQuery && (
            <button
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 border-slate-600/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700/80"
              data-testid="button-filter-labels"
              title="Etiquetas"
            >
              <Tag className="h-4 w-4 text-slate-300" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 !bg-slate-900 !border-slate-700 !text-slate-200 [&_svg]:!text-slate-300">
            <DropdownMenuItem onClick={() => setFilterLabelId(null)} data-testid="filter-label-all" className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100">
              <span className={cn("mr-2 inline-flex", !filterLabelId ? "text-emerald-400" : "text-transparent")}>
                <Check className="h-3.5 w-3.5" />
              </span>
              Todas
            </DropdownMenuItem>
            {ownedLabels.map((label) => (
              <DropdownMenuItem
                key={label.id}
                onClick={() => setFilterLabelId(filterLabelId === label.id ? null : label.id)}
                data-testid={`filter-label-${label.id}`}
                className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
              >
                <span className={cn("mr-2 inline-flex", filterLabelId === label.id ? "text-emerald-400" : "text-transparent")}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                {label.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 border-slate-600/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700/80"
              data-testid="button-filter-dates"
              title="Filtro fechas"
            >
              <Clock className="h-4 w-4 text-slate-300" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 !bg-slate-900 !border-slate-700 !text-slate-200 [&_svg]:!text-slate-300">
            {[7, 14, 30].map((d) => (
              <DropdownMenuItem
                key={d}
                onClick={() => onDaysChange(d)}
                data-testid={`filter-days-${d}`}
                className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
              >
                <span className={cn("mr-2 inline-flex", daysToShow === d ? "text-cyan-400" : "text-transparent")}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                Ultimos {d} dias
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 border-slate-600/70 bg-slate-800/70 px-2 md:px-3 text-slate-200 hover:bg-slate-700/80"
                data-testid="button-filter-agents"
                title={`Agente: ${selectedAgentName}`}
              >
                <Users className="h-4 w-4 text-slate-300" />
                <span className="hidden md:inline ml-2 text-xs text-slate-200 max-w-[140px] truncate">
                  {selectedAgentName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 !bg-slate-900 !border-slate-700 !text-slate-200 [&_svg]:!text-slate-300">
              <DropdownMenuItem
                onClick={() => setFilterAgentId(null)}
                data-testid="filter-agent-all"
                className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
              >
                <span className={cn("mr-2 inline-flex", !filterAgentId ? "text-emerald-400" : "text-transparent")}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                Todos
              </DropdownMenuItem>
              {agents.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onClick={() => setFilterAgentId(filterAgentId === agent.id ? null : agent.id)}
                  data-testid={`filter-agent-${agent.id}`}
                  className="!text-slate-300 focus:bg-slate-700 !focus:text-slate-100 data-[highlighted]:bg-slate-700 !data-[highlighted]:text-slate-100"
                >
                  <span className={cn("mr-2 inline-flex", filterAgentId === agent.id ? "text-emerald-400" : "text-transparent")}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {agent.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {hasMoreConversations && (
          <Button
            onClick={onLoadMore}
            variant="outline"
            className="md:hidden h-9 border-slate-600/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700/80"
            data-testid="button-load-more-conversations-mobile"
          >
            Ver mas (+20)
          </Button>
        )}
      </div>

      {/* Mobile: Tab bar - Futuristic */}
      <div className={cn(
        "md:hidden flex overflow-x-auto bg-slate-800/80 backdrop-blur-lg border-b border-slate-700/50 gap-1 p-2",
        isMobileChatOpen && "hidden",
      )}>
        {tabConfig.map((tab) => {
          const Icon = tab.icon;
          const count = columnData[tab.key].items.length;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              onClick={() => setMobileTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap border select-none",
                "transition-transform duration-100 active:scale-95",
                getTabColor(tab.key, mobileTab === tab.key)
              )}
              data-testid={`tab-${tab.key}`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.shortLabel}</span>
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full font-bold",
                mobileTab === tab.key ? "bg-white/20" : "bg-slate-700"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile: Single column view */}
      <div
        className="md:hidden flex-1 overflow-hidden relative"
        onTouchStart={handleMobileTouchStart}
        onTouchMove={handleMobileTouchMove}
        onTouchEnd={handleMobileTouchEnd}
        onTouchCancel={handleMobileTouchCancel}
      >
        <div
          className="h-full will-change-transform relative"
          style={{
            transform: `translateX(${swipeOffset}px)`,
            transition: isSwiping ? "none" : "transform 180ms ease-out",
          }}
        >
          <div className={cn("h-full", isMobileChatOpen && "pointer-events-none opacity-0")}>
            <KanbanColumn
              title={columnData[mobileTab].title}
              items={columnData[mobileTab].items}
              activeId={activeId}
              onSelect={handleSelectConversation}
              columnType={mobileTab}
              labels={labels}
              showAgentAssignment={isAdmin}
              getAssignedAgentName={getAssignedAgentName}
              enableDrag={false}
              draggingConversationId={draggingConversationId}
              isDropTarget={false}
              onDragStartCard={handleDragStartCard}
              onDragEndCard={handleDragEndCard}
              onDragOverColumn={handleDragOverColumn}
              onDropOnColumn={handleDropOnColumn}
              unreadIds={unreadIds}
              assignedSpotlightIds={assignedSpotlightIds}
            />
          </div>

          {activeId && activeConversation ? (
            <div className="absolute inset-0 z-10 h-full flex flex-col bg-slate-900">
              <button
                onClick={() => setActiveId(null)}
                className="group px-3 py-2.5 border-b border-slate-700 text-left text-sm text-emerald-400 font-medium flex items-center gap-2 bg-slate-800/50 select-none transition-all duration-75 active:scale-90 active:bg-slate-700 active:text-emerald-200 active:shadow-inner active:brightness-90"
                data-testid="button-back-kanban"
              >
                <ArrowLeft className="h-4 w-4 transition-transform duration-100 group-active:-translate-x-0.5" />
                <span className="transition-transform duration-100 group-active:translate-x-0.5">Volver al Kanban</span>
              </button>
              <div className="flex-1 overflow-hidden">
                <ChatArea
                  conversation={activeConversation.conversation}
                  messages={activeConversation.messages}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Desktop: Grid view with glassmorphism */}
      <div className="hidden md:flex flex-1 min-h-0">
        <div className="flex-1 flex gap-0 min-h-0 overflow-hidden p-3">
          <KanbanColumn
            title="Interaccion Humana"
            items={humano}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="humano"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "humano"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
          <KanbanColumn
            title="Esperando Confirmaci."
            items={nuevos}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="nuevo"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "nuevo"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
          <KanbanColumn
            title="Llamar"
            items={llamar}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="llamar"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "llamar"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
          <KanbanColumn
            title="Pedido en Proceso"
            items={enProceso}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="proceso"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "proceso"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
          <KanbanColumn
            title="Listo para Enviar"
            items={listos}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="listo"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "listo"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
          <KanbanColumn
            title="Enviados y Entregados"
            items={entregados}
            activeId={activeId}
            onSelect={handleSelectConversation}
            columnType="entregado"
            labels={labels}
            showAgentAssignment={isAdmin}
            getAssignedAgentName={getAssignedAgentName}
            enableDrag={canDragKanban}
            draggingConversationId={draggingConversationId}
            isDropTarget={dragOverColumn === "entregado"}
            onDragStartCard={handleDragStartCard}
            onDragEndCard={handleDragEndCard}
            onDragOverColumn={handleDragOverColumn}
            onDropOnColumn={handleDropOnColumn}
            unreadIds={unreadIds}
            assignedSpotlightIds={assignedSpotlightIds}
          />
        </div>

        {activeId && activeConversation ? (
          <div className="w-[420px] border-l border-slate-700/50 flex-shrink-0 bg-slate-900/80 backdrop-blur-xl">
            <ChatArea
              conversation={activeConversation.conversation}
              messages={activeConversation.messages}
              onClose={() => setActiveId(null)}
            />
          </div>
        ) : null}
      </div>

      
    </div>
  );
}



