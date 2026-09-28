import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  RefreshCw,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  Check,
  Trash2,
  Pencil,
  Loader2,
  ClipboardList,
  List,
  CalendarDays,
  Rows3,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "lucide-react";

type ReminderFilter = "all" | "overdue" | "today" | "upcoming";
type ReminderView = "list" | "calendar" | "agenda";

type ReminderConversation = Conversation & { reminderDate: Date };

type AgendaItem = {
  conv: ReminderConversation;
  startMin: number;
  endMin: number;
  lane: number;
  laneCount: number;
};

const HOUR_ROW_HEIGHT = 56;
const DEFAULT_EVENT_MINUTES = 45;
const DEFAULT_REMINDER_COLOR = "#06b6d4";

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStartMonday(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, diff));
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getReminderMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function normalizeReminderColor(color?: string | null) {
  const value = (color || "").trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return value;
  return DEFAULT_REMINDER_COLOR;
}

function buildAgendaLayout(reminders: ReminderConversation[]): AgendaItem[] {
  const base = reminders
    .map((conv) => {
      const startMin = getReminderMinutes(conv.reminderDate);
      const endMin = Math.min(startMin + DEFAULT_EVENT_MINUTES, 24 * 60 - 1);
      return { conv, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const laneEnds: number[] = [];
  const placed: Array<AgendaItem & { group: number }> = [];

  for (const item of base) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }

    placed.push({ ...item, lane, laneCount: 1, group: 0 });
  }

  let groupId = 0;
  for (let i = 0; i < placed.length; i++) {
    if (i === 0 || placed[i].startMin >= placed[i - 1].endMin) {
      groupId += 1;
    }
    placed[i].group = groupId;
  }

  const byGroup = new Map<number, AgendaItem[]>();
  for (const item of placed) {
    const list = byGroup.get(item.group) || [];
    list.push(item);
    byGroup.set(item.group, list);
  }

  byGroup.forEach((list) => {
    const lanes = Math.max(...list.map((x: AgendaItem) => x.lane)) + 1;
    list.forEach((entry) => {
      entry.laneCount = lanes;
    });
  });

  return placed;
}

export default function RemindersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReminderFilter>("all");
  const [view, setView] = useState<ReminderView>("list");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingReminder, setEditingReminder] = useState<ReminderConversation | null>(null);
  const [editReminderAtInput, setEditReminderAtInput] = useState("");
  const [editReminderNoteInput, setEditReminderNoteInput] = useState("");
  const [editReminderColorInput, setEditReminderColorInput] = useState(DEFAULT_REMINDER_COLOR);

  const { data: conversations = [], isLoading, isFetching, refetch } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations", "reminders-page"],
    queryFn: async () => {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error("No se pudo cargar recordatorios");
      return res.json();
    },
  });

  const clearReminderMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const res = await fetch(`/api/conversations/${conversationId}/reminder`, { method: "DELETE" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error al eliminar recordatorio");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", "reminders-page"] });
      toast({ title: "Recordatorio eliminado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleReminderDoneMutation = useMutation({
    mutationFn: async ({ conversationId, reminderDone }: { conversationId: number; reminderDone: boolean }) => {
      const res = await fetch(`/api/conversations/${conversationId}/reminder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminderDone }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error actualizando estado");
      }
      return res.json();
    },
    onMutate: async ({ conversationId, reminderDone }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations"] });
      await queryClient.cancelQueries({ queryKey: ["/api/conversations", "reminders-page"] });

      const previousConversations = queryClient.getQueryData<Conversation[]>(["/api/conversations"]);
      const previousReminderPage = queryClient.getQueryData<Conversation[]>(["/api/conversations", "reminders-page"]);

      const patchList = (list?: Conversation[]) =>
        list?.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                reminderDone,
              }
            : conv,
        ) ?? [];

      if (previousConversations) {
        queryClient.setQueryData(["/api/conversations"], patchList(previousConversations));
      }
      if (previousReminderPage) {
        queryClient.setQueryData(["/api/conversations", "reminders-page"], patchList(previousReminderPage));
      }

      return { previousConversations, previousReminderPage };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", "reminders-page"] });
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previousConversations) {
        queryClient.setQueryData(["/api/conversations"], context.previousConversations);
      }
      if (context?.previousReminderPage) {
        queryClient.setQueryData(["/api/conversations", "reminders-page"], context.previousReminderPage);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateReminderMutation = useMutation({
    mutationFn: async ({
      conversationId,
      reminderAt,
      reminderNote,
      reminderColor,
    }: {
      conversationId: number;
      reminderAt: string;
      reminderNote?: string;
      reminderColor?: string;
    }) => {
      const reminderDate = new Date(reminderAt);
      if (Number.isNaN(reminderDate.getTime())) {
        throw new Error("Fecha de recordatorio invalida");
      }
      const res = await fetch(`/api/conversations/${conversationId}/reminder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminderAt: reminderDate.toISOString(),
          reminderNote: reminderNote?.trim() || null,
          reminderColor: normalizeReminderColor(reminderColor),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error al actualizar recordatorio");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", "reminders-page"] });
      setEditingReminder(null);
      toast({ title: "Recordatorio actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const reminderGroups = useMemo(() => {
    const now = new Date();
    const startToday = startOfDay(now);
    const endToday = addDays(startToday, 1);

    const all = conversations
      .filter((c) => !!c.reminderAt)
      .map((c) => ({
        ...c,
        reminderDate: new Date(c.reminderAt as Date | string),
      }))
      .filter((c) => !Number.isNaN(c.reminderDate.getTime()))
      .sort((a, b) => a.reminderDate.getTime() - b.reminderDate.getTime());

    const overdue = all.filter((c) => c.reminderDate < startToday);
    const today = all.filter((c) => c.reminderDate >= startToday && c.reminderDate < endToday);
    const upcoming = all.filter((c) => c.reminderDate >= endToday);

    return { all, overdue, today, upcoming };
  }, [conversations]);

  const visibleReminders = useMemo<ReminderConversation[]>(() => {
    if (filter === "overdue") return reminderGroups.overdue;
    if (filter === "today") return reminderGroups.today;
    if (filter === "upcoming") return reminderGroups.upcoming;
    return reminderGroups.all;
  }, [filter, reminderGroups]);

  const remindersByDay = useMemo(() => {
    const grouped = new Map<string, ReminderConversation[]>();
    for (const reminder of visibleReminders) {
      const key = dayKey(reminder.reminderDate);
      const list = grouped.get(key) || [];
      list.push(reminder);
      grouped.set(key, list);
    }
    return grouped;
  }, [visibleReminders]);

  const reminderDates = useMemo(() => {
    return visibleReminders.map((reminder) => new Date(reminder.reminderDate.getFullYear(), reminder.reminderDate.getMonth(), reminder.reminderDate.getDate()));
  }, [visibleReminders]);

  const selectedDayReminders = useMemo(() => {
    const key = dayKey(selectedDate);
    return remindersByDay.get(key) || [];
  }, [selectedDate, remindersByDay]);

  const selectedDayLayout = useMemo(() => buildAgendaLayout(selectedDayReminders), [selectedDayReminders]);

  const weekDays = useMemo(() => {
    const start = getWeekStartMonday(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const weekLayouts = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const day of weekDays) {
      const key = dayKey(day);
      map.set(key, buildAgendaLayout(remindersByDay.get(key) || []));
    }
    return map;
  }, [weekDays, remindersByDay]);

  const formatReminder = (dateStr: string | Date | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleString("es-BO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatTimeOnly = (dateStr: string | Date | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleTimeString("es-BO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const toDateTimeLocalValue = (value?: string | Date | null) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const tzOffset = parsed.getTimezoneOffset() * 60_000;
    return new Date(parsed.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const openEditReminder = (conv: ReminderConversation) => {
    setEditingReminder(conv);
    setEditReminderAtInput(toDateTimeLocalValue(conv.reminderAt));
    setEditReminderNoteInput(conv.reminderNote || "");
    setEditReminderColorInput(normalizeReminderColor(conv.reminderColor));
  };

  const dayHeight = 24 * HOUR_ROW_HEIGHT;

  const renderReminderCard = (conv: ReminderConversation, compact = false) => (
    <Card
      key={conv.id}
      data-testid={`reminder-card-${conv.id}`}
      className={cn(
        "border-slate-700/60 bg-slate-900/55 backdrop-blur-sm shadow-[0_10px_28px_rgba(2,6,23,.35)]",
        compact ? "ring-1 ring-emerald-500/15" : "hover:border-slate-600/80 transition-colors",
      )}
    >
      <CardHeader className={compact ? "pb-2 pt-4" : "pb-2"}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <CardTitle className={cn("text-sm sm:text-base text-slate-100 truncate", conv.reminderDone && "line-through decoration-2 decoration-red-400 opacity-75")}>
              {conv.contactName || conv.waId}
            </CardTitle>
            {conv.contactName && conv.waId && (
              <p className={cn("text-[11px] text-slate-400 truncate", conv.reminderDone && "line-through decoration-2 decoration-red-400 opacity-75")}>
                {conv.waId}
              </p>
            )}
          </div>
          <Badge variant="outline" className="border-amber-400/70 bg-amber-500/10 text-amber-300 font-semibold">
            {compact ? formatTimeOnly(conv.reminderAt) : formatReminder(conv.reminderAt)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className={cn("text-xs sm:text-sm text-slate-300 break-words", conv.reminderDone && "line-through decoration-2 decoration-red-400 opacity-75")}>
          {conv.reminderNote?.trim() || "Sin nota"}
        </p>
        {conv.reminderDone && (
          <Badge className="mt-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">Completado</Badge>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm border-slate-500/80 bg-slate-800/70 text-slate-100 hover:bg-slate-700/80"
            data-testid={`button-open-chat-${conv.id}`}
          >
            <Link href={`/?conversationId=${conv.id}`}>Ver chat</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
              conv.reminderDone && "bg-emerald-500/25",
            )}
            onClick={() => toggleReminderDoneMutation.mutate({ conversationId: conv.id, reminderDone: !Boolean(conv.reminderDone) })}
            data-testid={`button-toggle-reminder-done-${conv.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            {conv.reminderDone ? "Reabrir" : "Completar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm border-cyan-500/50 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
            onClick={() => openEditReminder(conv)}
            data-testid={`button-edit-reminder-${conv.id}`}
          >
            <Pencil className="h-4 w-4 mr-1" />
            Editar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => clearReminderMutation.mutate(conv.id)}
            disabled={clearReminderMutation.isPending}
            className="h-8 px-2 sm:h-9"
            data-testid={`button-clear-reminder-${conv.id}`}
            title="Eliminar recordatorio"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderAgendaEvent = (
    item: AgendaItem,
    options: { stacked?: boolean; compact?: boolean; showActions?: boolean } = {},
  ) => {
    const { stacked = false, compact = false, showActions = true } = options;
    const top = (item.startMin / 60) * HOUR_ROW_HEIGHT;
    const height = Math.max(((item.endMin - item.startMin) / 60) * HOUR_ROW_HEIGHT, 34);
    const leftPercent = (item.lane / item.laneCount) * 100;
    const widthPercent = 100 / item.laneCount;
    const reminderColor = normalizeReminderColor(item.conv.reminderColor);
    const eventTop = stacked ? top + item.lane * 18 : top;
    const eventHeight = stacked ? Math.max(height, 44) : compact ? Math.max(height, 34) : height;
    const eventLeft = stacked ? "2px" : `calc(${leftPercent}% + ${item.lane * 2}px)`;
    const eventWidth = stacked ? "calc(100% - 4px)" : `calc(${widthPercent}% - 4px)`;

    return (
      <div
        key={item.conv.id}
        className="absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm"
        style={{
          top: eventTop,
          height: eventHeight,
          left: eventLeft,
          width: eventWidth,
          borderColor: `${reminderColor}AA`,
          backgroundColor: item.conv.reminderDone ? `${reminderColor}1F` : `${reminderColor}3D`,
        }}
        data-testid={`agenda-event-${item.conv.id}`}
      >
        <div className={cn("mb-1 flex items-start justify-between gap-1", compact && "mb-0")}>
          <button
            type="button"
            onClick={() => openEditReminder(item.conv)}
            className="min-w-0 flex-1 text-left"
            data-testid={`agenda-event-edit-${item.conv.id}`}
            title="Editar recordatorio"
          >
            <p
              className={cn(
                "truncate text-[11px] font-semibold text-white",
                compact && "text-[10px]",
                item.conv.reminderDone && "line-through decoration-2 decoration-red-300 opacity-75",
              )}
            >
              {item.conv.contactName || item.conv.waId}
            </p>
            {item.conv.contactName && item.conv.waId && (
              <p className={cn("truncate text-[10px] text-white/70", compact && "text-[9px]", item.conv.reminderDone && "line-through decoration-2 decoration-red-300 opacity-75")}>
                {item.conv.waId}
              </p>
            )}
            <p className={cn("truncate text-[10px] text-white/90", compact && "text-[9px]", item.conv.reminderDone && "line-through decoration-2 decoration-red-300 opacity-75")}>
              {formatTimeOnly(item.conv.reminderAt)}
            </p>
          </button>
          {showActions && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6 rounded bg-black/25 text-white hover:bg-black/40", item.conv.reminderDone && "bg-emerald-600/40")}
              onClick={() =>
                toggleReminderDoneMutation.mutate({
                  conversationId: item.conv.id,
                  reminderDone: !Boolean(item.conv.reminderDone),
                })
              }
              data-testid={`agenda-event-toggle-done-${item.conv.id}`}
              title={item.conv.reminderDone ? "Reabrir" : "Completar"}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          {showActions && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded bg-black/25 text-white hover:bg-black/40"
              data-testid={`agenda-event-open-chat-${item.conv.id}`}
              title="Ir al chat"
            >
              <Link href={`/?conversationId=${item.conv.id}`}>
                <MessageSquare className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderWeekColumnEvents = (layout: AgendaItem[], dayKeyValue: string) => {
    const byStart = new Map<number, AgendaItem[]>();
    layout.forEach((item) => {
      const list = byStart.get(item.startMin) || [];
      list.push(item);
      byStart.set(item.startMin, list);
    });

    const nodes: any[] = [];
    const starts = Array.from(byStart.keys()).sort((a, b) => a - b);

    starts.forEach((startMin) => {
      const group = (byStart.get(startMin) || []).sort((a, b) => a.lane - b.lane);
      const visible = group.slice(0, 2);
      visible.forEach((item) => {
        nodes.push(renderAgendaEvent(item, { compact: true, showActions: false }));
      });
      const hidden = group.length - visible.length;
      if (hidden > 0) {
        nodes.push(
          <button
            key={`more-${dayKeyValue}-${startMin}`}
            type="button"
            onClick={() => setSelectedDate(new Date(dayKeyValue))}
            className="absolute left-[2px] right-[2px] rounded border border-slate-500/60 bg-slate-800/80 px-2 py-0.5 text-left text-[10px] text-slate-100"
            style={{ top: (startMin / 60) * HOUR_ROW_HEIGHT + 36 }}
            data-testid={`agenda-event-more-${dayKeyValue}-${startMin}`}
            title={`Ver ${hidden} recordatorio(s) más`}
          >
            +{hidden} más
          </button>,
        );
      }
    });

    return nodes;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header Superior: Título + Acciones + Selector de Vistas */}
        <div className="mb-4 sm:mb-6 space-y-3">
          {/* Fila 1: Título y Acciones principales */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Link href="/">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 active:scale-95 border border-slate-700/40 text-slate-300 hover:text-white transition-all shadow-sm"
                  data-testid="button-back-reminders"
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
                  Recordatorios
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {reminderGroups.all.length}
                </span>
              </div>
            </div>

            {/* Acciones derecha: Seguimiento y Refrescar */}
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/follow-up">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-slate-700/60 bg-slate-800/60 hover:bg-slate-700/70 text-slate-200 hover:text-white text-xs font-medium px-3 transition-all shadow-sm flex items-center gap-1.5"
                  data-testid="button-go-followup"
                >
                  <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
                  <span>Seguimiento</span>
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 active:scale-95 border border-slate-700/40 text-slate-300 hover:text-white transition-all shadow-sm"
                onClick={() => refetch()}
                data-testid="button-refresh-reminders-page"
                title="Actualizar recordatorios"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin text-emerald-400")} />
              </Button>
            </div>
          </div>

          {/* Fila 2: Segmented Control para Vistas (Lista / Calendario / Agenda) */}
          <div className="flex items-center justify-between gap-3">
            <div className="w-full sm:w-auto inline-flex p-1 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-inner">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("list")}
                className={cn(
                  "flex-1 sm:flex-initial h-8 px-3.5 rounded-lg text-xs font-semibold transition-all shadow-none select-none flex items-center justify-center gap-1.5",
                  view === "list"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60",
                )}
                data-testid="button-reminders-view-list"
              >
                <List className="h-3.5 w-3.5" />
                <span>Lista</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("calendar")}
                className={cn(
                  "flex-1 sm:flex-initial h-8 px-3.5 rounded-lg text-xs font-semibold transition-all shadow-none select-none flex items-center justify-center gap-1.5",
                  view === "calendar"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60",
                )}
                data-testid="button-reminders-view-calendar"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span>Calendario</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("agenda")}
                className={cn(
                  "flex-1 sm:flex-initial h-8 px-3.5 rounded-lg text-xs font-semibold transition-all shadow-none select-none flex items-center justify-center gap-1.5",
                  view === "agenda"
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60",
                )}
                data-testid="button-reminders-view-agenda"
              >
                <Rows3 className="h-3.5 w-3.5" />
                <span>Agenda</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Filtros de Estado: Grid simétrico 2x2 en móvil y 4 columnas en desktop */}
        <div className="mb-5 p-2 sm:p-2.5 rounded-2xl border border-slate-800/90 bg-slate-900/70 backdrop-blur-md shadow-[0_8px_24px_rgba(2,6,23,.25)]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter("all")}
              className={cn(
                "h-10 sm:h-11 rounded-xl px-2.5 sm:px-3 text-xs font-medium justify-between transition-all active:scale-[0.98]",
                filter === "all"
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/10"
                  : "border-slate-800/80 bg-slate-950/40 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100",
              )}
              data-testid="filter-reminders-all"
            >
              <span className="flex items-center gap-1.5 truncate min-w-0">
                <Calendar className={cn("h-3.5 w-3.5 shrink-0", filter === "all" ? "text-emerald-400" : "text-slate-400")} />
                <span className="truncate">Todos</span>
              </span>
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0",
                filter === "all"
                  ? "bg-emerald-500/25 text-emerald-200"
                  : "bg-slate-800/80 text-slate-400 border border-slate-700/40",
              )}>
                {reminderGroups.all.length}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter("overdue")}
              className={cn(
                "h-10 sm:h-11 rounded-xl px-2.5 sm:px-3 text-xs font-medium justify-between transition-all active:scale-[0.98]",
                filter === "overdue"
                  ? "bg-rose-500/15 border-rose-500/50 text-rose-300 shadow-sm shadow-rose-500/10"
                  : "border-slate-800/80 bg-slate-950/40 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100",
              )}
              data-testid="filter-reminders-overdue"
            >
              <span className="flex items-center gap-1.5 truncate min-w-0">
                <AlertCircle className={cn("h-3.5 w-3.5 shrink-0", filter === "overdue" ? "text-rose-400" : "text-slate-400")} />
                <span className="truncate">Vencidos</span>
              </span>
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0",
                filter === "overdue"
                  ? "bg-rose-500/25 text-rose-200"
                  : "bg-slate-800/80 text-slate-400 border border-slate-700/40",
              )}>
                {reminderGroups.overdue.length}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter("today")}
              className={cn(
                "h-10 sm:h-11 rounded-xl px-2.5 sm:px-3 text-xs font-medium justify-between transition-all active:scale-[0.98]",
                filter === "today"
                  ? "bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-sm shadow-amber-500/10"
                  : "border-slate-800/80 bg-slate-950/40 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100",
              )}
              data-testid="filter-reminders-today"
            >
              <span className="flex items-center gap-1.5 truncate min-w-0">
                <Clock className={cn("h-3.5 w-3.5 shrink-0", filter === "today" ? "text-amber-400" : "text-slate-400")} />
                <span className="truncate">Hoy</span>
              </span>
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0",
                filter === "today"
                  ? "bg-amber-500/25 text-amber-200"
                  : "bg-slate-800/80 text-slate-400 border border-slate-700/40",
              )}>
                {reminderGroups.today.length}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter("upcoming")}
              className={cn(
                "h-10 sm:h-11 rounded-xl px-2.5 sm:px-3 text-xs font-medium justify-between transition-all active:scale-[0.98]",
                filter === "upcoming"
                  ? "bg-sky-500/15 border-sky-500/50 text-sky-300 shadow-sm shadow-sky-500/10"
                  : "border-slate-800/80 bg-slate-950/40 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100",
              )}
              data-testid="filter-reminders-upcoming"
            >
              <span className="flex items-center gap-1.5 truncate min-w-0">
                <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", filter === "upcoming" ? "text-sky-400" : "text-slate-400")} />
                <span className="truncate">Próximos</span>
              </span>
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0",
                filter === "upcoming"
                  ? "bg-sky-500/25 text-sky-200"
                  : "bg-slate-800/80 text-slate-400 border border-slate-700/40",
              )}>
                {reminderGroups.upcoming.length}
              </span>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : visibleReminders.length === 0 ? (
          <Card className="border-slate-700/60 bg-slate-900/55 backdrop-blur-sm">
            <CardContent className="py-12 text-center text-slate-400">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-60" />
              <p>No hay recordatorios en esta vista</p>
            </CardContent>
          </Card>
        ) : view === "list" ? (
          <div className="space-y-3">{visibleReminders.map((conv) => renderReminderCard(conv))}</div>
        ) : view === "calendar" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
            <Card className="h-fit border-slate-700/60 bg-slate-900/55 backdrop-blur-sm shadow-[0_10px_28px_rgba(2,6,23,.35)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-slate-100">Calendario</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="rounded-xl border border-slate-600/60 bg-slate-800/55 p-1">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => setSelectedDate(date || new Date())}
                    modifiers={{ hasReminders: reminderDates }}
                    modifiersClassNames={{
                      hasReminders:
                        "relative after:absolute after:bottom-1 after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-emerald-400",
                    }}
                    classNames={{
                      caption_label: "text-sm font-semibold text-slate-100",
                      head_cell: "text-slate-400 rounded-md w-9 font-medium text-[0.78rem]",
                      day: "h-9 w-9 p-0 font-medium text-slate-200 aria-selected:opacity-100 hover:bg-slate-700/70",
                      day_selected: "bg-emerald-500 text-white hover:bg-emerald-500 focus:bg-emerald-500",
                      day_today: "bg-cyan-500/20 text-cyan-300",
                      nav_button: "h-7 w-7 bg-slate-800 border border-slate-600/70 text-slate-200 opacity-100 hover:bg-slate-700",
                    }}
                    className="w-full"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-700/60 bg-slate-900/55 backdrop-blur-sm shadow-[0_10px_28px_rgba(2,6,23,.35)]">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base text-slate-100">
                    Agenda del dia: {selectedDate.toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" })}
                  </CardTitle>
                  <Badge variant="secondary" className="bg-slate-700/70 text-slate-100 border border-slate-600/70">
                    {selectedDayReminders.length} recordatorio(s)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {selectedDayReminders.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">No hay recordatorios para este dia en el filtro actual.</div>
                ) : (
                  <div className="space-y-3">{selectedDayReminders.map((conv) => renderReminderCard(conv, true))}</div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-slate-700/60 bg-slate-900/55 backdrop-blur-sm shadow-[0_10px_28px_rgba(2,6,23,.35)]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base text-slate-100">Agenda horaria</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-slate-600/70 bg-slate-800/60"
                    onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                    data-testid="button-agenda-prev-day"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-600/70 bg-slate-800/60"
                    onClick={() => setSelectedDate(new Date())}
                    data-testid="button-agenda-today"
                  >
                    Hoy
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-slate-600/70 bg-slate-800/60"
                    onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                    data-testid="button-agenda-next-day"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-slate-300">
                {selectedDate.toLocaleDateString("es-BO", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="lg:hidden">
                <div className="rounded-lg border border-slate-700/60 bg-slate-950/40">
                  <div className="relative grid grid-cols-[56px_1fr]" style={{ minHeight: dayHeight }}>
                    <div className="relative border-r border-slate-700/60">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={`hour-m-${h}`} className="absolute left-0 right-0 text-[11px] text-slate-400 px-1" style={{ top: h * HOUR_ROW_HEIGHT - 8 }}>
                          {formatHour(h)}
                        </div>
                      ))}
                    </div>
                    <div className="relative">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={`line-m-${h}`} className="absolute left-0 right-0 border-t border-slate-800/80" style={{ top: h * HOUR_ROW_HEIGHT }} />
                      ))}
                      {selectedDayLayout.map((item) => renderAgendaEvent(item, { stacked: true, showActions: true }))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="hidden lg:block overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-950/40">
                <div className="min-w-[1050px]">
                  <div className="grid grid-cols-[64px_repeat(7,minmax(130px,1fr))] border-b border-slate-700/60">
                    <div className="h-12" />
                    {weekDays.map((day) => {
                      const key = dayKey(day);
                      const dayCount = (remindersByDay.get(key) || []).length;
                      const isSelected = key === dayKey(selectedDate);
                      return (
                        <button
                          key={`week-head-${key}`}
                          type="button"
                          onClick={() => setSelectedDate(day)}
                          className={cn(
                            "h-12 border-l border-slate-700/60 px-2 text-left",
                            isSelected ? "bg-violet-500/20" : "hover:bg-slate-800/50",
                          )}
                        >
                          <p className="text-xs text-slate-400 uppercase">{day.toLocaleDateString("es-BO", { weekday: "short" })}</p>
                          <p className="text-sm font-semibold text-slate-100">
                            {day.toLocaleDateString("es-BO", { day: "2-digit", month: "short" })}
                            <span className="ml-1 text-cyan-300">({dayCount})</span>
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-[64px_repeat(7,minmax(130px,1fr))]" style={{ minHeight: dayHeight }}>
                    <div className="relative border-r border-slate-700/60">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={`hour-d-${h}`} className="absolute left-0 right-0 px-1 text-[11px] text-slate-400" style={{ top: h * HOUR_ROW_HEIGHT - 8 }}>
                          {formatHour(h)}
                        </div>
                      ))}
                    </div>

                    {weekDays.map((day) => {
                      const key = dayKey(day);
                      const layout = weekLayouts.get(key) || [];
                      return (
                        <div key={`week-col-${key}`} className="relative border-l border-slate-700/60" style={{ minHeight: dayHeight }}>
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={`line-d-${key}-${h}`} className="absolute left-0 right-0 border-t border-slate-800/80" style={{ top: h * HOUR_ROW_HEIGHT }} />
                          ))}
                          {renderWeekColumnEvents(layout, key)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editingReminder} onOpenChange={(open) => !open && setEditingReminder(null)}>
        <DialogContent className="sm:max-w-md border-slate-700 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Editar recordatorio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-reminder-datetime">Fecha y hora</Label>
              <Input
                id="edit-reminder-datetime"
                type="datetime-local"
                value={editReminderAtInput}
                onChange={(e) => setEditReminderAtInput(e.target.value)}
                className="bg-slate-800/70 border-slate-600/70 text-slate-100"
                data-testid="input-edit-reminder-datetime"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reminder-note">Nota</Label>
              <Textarea
                id="edit-reminder-note"
                rows={3}
                value={editReminderNoteInput}
                onChange={(e) => setEditReminderNoteInput(e.target.value)}
                className="bg-slate-800/70 border-slate-600/70 text-slate-100"
                data-testid="textarea-edit-reminder-note"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reminder-color">Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="edit-reminder-color"
                  type="color"
                  value={editReminderColorInput}
                  onChange={(e) => setEditReminderColorInput(normalizeReminderColor(e.target.value))}
                  className="h-10 w-16 p-1 bg-slate-800/70 border-slate-600/70"
                  data-testid="input-edit-reminder-color"
                />
                <div
                  className="h-8 w-8 rounded-md border border-slate-500/70"
                  style={{ backgroundColor: editReminderColorInput }}
                  aria-hidden
                />
                <span className="text-xs text-slate-300">{editReminderColorInput}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setEditingReminder(null)}
                className="border-slate-600/70 bg-slate-800/60 text-slate-100 hover:bg-slate-700/80"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (!editingReminder) return;
                  if (!editReminderAtInput) {
                    toast({ title: "Fecha requerida", description: "Seleccione fecha y hora", variant: "destructive" });
                    return;
                  }
                  updateReminderMutation.mutate({
                    conversationId: editingReminder.id,
                    reminderAt: editReminderAtInput,
                    reminderNote: editReminderNoteInput,
                    reminderColor: editReminderColorInput,
                  });
                }}
                disabled={updateReminderMutation.isPending}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                data-testid="button-save-edit-reminder"
              >
                {updateReminderMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
