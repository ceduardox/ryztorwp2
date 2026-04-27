import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  ArrowLeft,
  Users,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Eye,
  EyeOff,
  Pencil,
  Save,
  X,
  Zap,
  Bot,
  BotOff,
  MessageSquare,
  Clock,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";

interface AgentWithStats extends Agent {
  assignedConversations?: number;
  inboundMessages?: number;
  inboundChats?: number;
  newLeads?: number;
  shouldCallCount?: number;
  lastActivityAt?: string | null;
}

interface AgentAiColumnStatus {
  exists: boolean;
}

interface AdRoutingRule {
  id: number;
  adId: string;
  agentIds: number[];
  isActive: boolean;
  isExclusive: boolean;
  productRoute?: string | null;
  updatedAt?: string | null;
}

interface DailyCostSetting {
  date: string;
  unitCostBs: number;
  officialRateBs: number;
  parallelRateBs: number;
  updatedAt?: string | null;
}

interface AnalyticsViewPermission {
  viewerAgentId: number;
  visibleAgentIds: number[];
  updatedAt?: string | null;
}

const glowAnimation = `
@keyframes glow-line {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.animate-glow-line { 
  background: linear-gradient(90deg, transparent, rgba(16,185,129,0.3), transparent);
  background-size: 200% 100%;
  animation: glow-line 3s ease-in-out infinite;
}
`;

const AD_PRODUCT_ROUTE_OPTIONS = [
  { value: "diabetes", label: "Berberina" },
  { value: "diabetes_y_peso", label: "Berberina + Bitter Melon" },
  { value: "dolor_y_estres", label: "Citrato de Magnesio" },
  { value: "dolor_articular", label: "Boswellia Serrata" },
] as const;

function getAdProductRouteLabel(route?: string | null): string {
  return AD_PRODUCT_ROUTE_OPTIONS.find((option) => option.value === route)?.label || "Sin producto directo";
}

function parsePositiveNumber(value: string, fallback = 0): number {
  const normalized = String(value || "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBs(value: number): string {
  return `${value.toLocaleString("es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Bs`;
}

function formatUsd(value: number): string {
  return `USD ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AgentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [weight, setWeight] = useState(1);
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [routingAdId, setRoutingAdId] = useState("");
  const [routingIsActive, setRoutingIsActive] = useState(true);
  const [routingIsExclusive, setRoutingIsExclusive] = useState(true);
  const [routingProductRoute, setRoutingProductRoute] = useState("");
  const [routingAgentIds, setRoutingAgentIds] = useState<number[]>([]);
  const [costDate, setCostDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [costPerInboundChatBs, setCostPerInboundChatBs] = useState("");
  const [officialRateBs, setOfficialRateBs] = useState("");
  const [parallelRateBs, setParallelRateBs] = useState("");
  const [analyticsPermissionsDraft, setAnalyticsPermissionsDraft] = useState<Record<number, number[]>>({});
  const [selectedAnalyticsViewerId, setSelectedAnalyticsViewerId] = useState<number | null>(null);
  const [analyticsTargetSearch, setAnalyticsTargetSearch] = useState("");

  const { data: agents = [], isLoading } = useQuery<AgentWithStats[]>({
    queryKey: ["/api/agents", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const suffix = params.toString();
      const res = await fetch(`/api/agents${suffix ? `?${suffix}` : ""}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("No se pudo cargar la lista de agentes");
      return res.json();
    },
  });

  const { data: agentAiColumnStatus } = useQuery<AgentAiColumnStatus>({
    queryKey: ["/api/agents/ai-column-status"],
    queryFn: async () => {
      const res = await fetch("/api/agents/ai-column-status", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("No se pudo verificar la columna de IA por agente");
      return res.json();
    },
  });

  const { data: adRoutingRules = [] } = useQuery<AdRoutingRule[]>({
    queryKey: ["/api/ad-routing-rules"],
    queryFn: async () => {
      const res = await fetch("/api/ad-routing-rules", { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo cargar reglas por anuncio");
      return res.json();
    },
  });

  const { data: analyticsViewPermissions = [] } = useQuery<AnalyticsViewPermission[]>({
    queryKey: ["/api/analytics-view-permissions"],
    queryFn: async () => {
      const res = await fetch("/api/analytics-view-permissions", { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo cargar permisos de analytics");
      return res.json();
    },
  });

  const { data: costSettingsForDate = [] } = useQuery<DailyCostSetting[]>({
    queryKey: ["/api/daily-cost-settings", costDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("dateFrom", costDate);
      params.set("dateTo", costDate);
      const res = await fetch(`/api/daily-cost-settings?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("No se pudo cargar el costo diario");
      return res.json();
    },
    enabled: Boolean(costDate),
  });

  useEffect(() => {
    const row = costSettingsForDate[0];
    if (!row) {
      setCostPerInboundChatBs("");
      setOfficialRateBs("");
      setParallelRateBs("");
      return;
    }
    setCostPerInboundChatBs(String(row.unitCostBs));
    setOfficialRateBs(String(row.officialRateBs));
    setParallelRateBs(String(row.parallelRateBs));
  }, [costSettingsForDate]);

  useEffect(() => {
    const next: Record<number, number[]> = {};
    const fromServer = new Map<number, number[]>(
      analyticsViewPermissions.map((row) => [Number(row.viewerAgentId), Array.isArray(row.visibleAgentIds) ? row.visibleAgentIds : []]),
    );
    for (const agent of agents) {
      next[agent.id] = fromServer.get(agent.id) ?? [];
    }
    setAnalyticsPermissionsDraft(next);
  }, [agents, analyticsViewPermissions]);

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedAnalyticsViewerId(null);
      return;
    }
    setSelectedAnalyticsViewerId((prev) => {
      if (prev != null && agents.some((agent) => agent.id === prev)) return prev;
      return agents[0].id;
    });
  }, [agents]);

  const saveDailyCostMutation = useMutation({
    mutationFn: async () => {
      const unitCostBs = parsePositiveNumber(costPerInboundChatBs, 0);
      const officialRate = parsePositiveNumber(officialRateBs, 0);
      const parallelRate = parsePositiveNumber(parallelRateBs, 0);

      if (!costDate) {
        throw new Error("Seleccione una fecha");
      }
      if (unitCostBs <= 0) {
        throw new Error("Costo por chat invalido");
      }
      if (officialRate <= 0) {
        throw new Error("Tipo de cambio oficial invalido");
      }
      if (parallelRate <= 0) {
        throw new Error("Dolar paralelo invalido");
      }

      const res = await fetch(`/api/daily-cost-settings/${costDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          unitCostBs,
          officialRateBs: officialRate,
          parallelRateBs: parallelRate,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || "No se pudo guardar el costo diario");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-cost-settings", costDate] });
      toast({ title: "Costo diario guardado" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; username: string; password: string; weight: number }) => {
      return apiRequest("POST", "/api/agents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      resetForm();
      toast({ title: "Agente creado" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; [key: string]: any }) => {
      return apiRequest("PATCH", `/api/agents/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setEditingId(null);
      toast({ title: "Agente actualizado" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/agents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Agente eliminado" });
    },
  });

  const upsertAdRoutingMutation = useMutation({
    mutationFn: async (data: { adId: string; agentIds: number[]; isActive: boolean; isExclusive: boolean; productRoute: string | null }) => {
      return apiRequest("PUT", "/api/ad-routing-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-routing-rules"] });
      setRoutingAdId("");
      setRoutingAgentIds([]);
      setRoutingIsActive(true);
      setRoutingIsExclusive(true);
      setRoutingProductRoute("");
      toast({ title: "Regla de anuncio guardada" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteAdRoutingMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ad-routing-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-routing-rules"] });
      toast({ title: "Regla eliminada" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveAnalyticsPermissionMutation = useMutation({
    mutationFn: async (data: { viewerAgentId: number; visibleAgentIds: number[] }) => {
      const res = await apiRequest(
        "PUT",
        `/api/analytics-view-permissions/${data.viewerAgentId}`,
        { visibleAgentIds: data.visibleAgentIds },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics-view-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-stats"] });
      toast({ title: "Permiso de analytics guardado" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setName("");
    setUsername("");
    setPassword("");
    setWeight(1);
  };

  const handleCreate = () => {
    if (!name || !username || !password) {
      toast({ title: "Completa todos los campos", variant: "destructive" });
      return;
    }
    createMutation.mutate({ name, username, password, weight });
  };

  const toggleActive = (agent: Agent) => {
    updateMutation.mutate({ id: agent.id, isActive: !agent.isActive });
  };

  const toggleAgentAiAutoReply = (agent: Agent) => {
    updateMutation.mutate({
      id: agent.id,
      isAiAutoReplyEnabled: !agent.isAiAutoReplyEnabled,
    });
  };

  const formatDateInput = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const setQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(end));
  };

  const activeAgents = agents.filter(a => a.isActive);
  const inactiveAgents = agents.filter(a => !a.isActive);
  const totalInboundMessages = agents.reduce((acc, agent) => acc + (agent.inboundMessages || 0), 0);
  const totalInboundChats = agents.reduce((acc, agent) => acc + (agent.inboundChats || 0), 0);
  const totalShouldCall = agents.reduce((acc, agent) => acc + (agent.shouldCallCount || 0), 0);
  const activeAgentIdSet = new Set(activeAgents.map((a) => a.id));
  const unitCostBs = parsePositiveNumber(costPerInboundChatBs, 0);
  const officialRate = parsePositiveNumber(officialRateBs, 0);
  const parallelRate = parsePositiveNumber(parallelRateBs, 0);
  const hasValidCostConfig = unitCostBs > 0 && officialRate > 0 && parallelRate > 0;
  const totalBaseCostBs = hasValidCostConfig ? totalInboundChats * unitCostBs : null;
  const totalCostUsd = hasValidCostConfig && totalBaseCostBs != null ? totalBaseCostBs / officialRate : null;
  const totalParallelCostBs =
    hasValidCostConfig && totalCostUsd != null ? totalCostUsd * parallelRate : null;

  const toggleRoutingAgent = (agentId: number) => {
    setRoutingAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  };

  const toggleAnalyticsVisibleAgent = (viewerAgentId: number, visibleAgentId: number) => {
    setAnalyticsPermissionsDraft((prev) => {
      const current = Array.isArray(prev[viewerAgentId]) ? prev[viewerAgentId] : [];
      const next = current.includes(visibleAgentId)
        ? current.filter((id) => id !== visibleAgentId)
        : [...current, visibleAgentId];
      return { ...prev, [viewerAgentId]: next };
    });
  };

  const getAgentName = (id: number) => agents.find((a) => a.id === id)?.name || `Agente ${id}`;
  const selectedAnalyticsViewer =
    agents.find((agent) => agent.id === selectedAnalyticsViewerId) ?? agents[0] ?? null;
  const selectedViewerId = selectedAnalyticsViewer?.id ?? null;
  const selectedVisibleIds = selectedViewerId == null
    ? []
    : (analyticsPermissionsDraft[selectedViewerId] || []).filter((id) => id !== selectedViewerId);
  const selectedSummary = selectedVisibleIds.length > 0
    ? selectedVisibleIds.map(getAgentName).join(", ")
    : "Solo sus propias metricas";
  const savingSelectedViewer =
    saveAnalyticsPermissionMutation.isPending &&
    saveAnalyticsPermissionMutation.variables?.viewerAgentId === selectedViewerId;
  const normalizedAnalyticsSearch = analyticsTargetSearch.trim().toLowerCase();
  const analyticsTargetAgents = selectedAnalyticsViewer
    ? agents.filter((agent) => agent.id !== selectedAnalyticsViewer.id)
    : [];
  const filteredAnalyticsTargetAgents = analyticsTargetAgents.filter((agent) => {
    if (!normalizedAnalyticsSearch) return true;
    return (
      agent.name.toLowerCase().includes(normalizedAnalyticsSearch) ||
      agent.username.toLowerCase().includes(normalizedAnalyticsSearch)
    );
  });
  const allFilteredTargetsSelected =
    filteredAnalyticsTargetAgents.length > 0 &&
    filteredAnalyticsTargetAgents.every((agent) => selectedVisibleIds.includes(agent.id));

  const performanceData = agents
    .map((agent) => ({
      name: agent.name.split(" ")[0],
      mensajes: agent.inboundMessages || 0,
      chats: agent.assignedConversations || 0,
    }))
    .sort((a, b) => b.mensajes - a.mensajes)
    .slice(0, 8);

  const distributionData = activeAgents
    .map((agent) => ({
      name: agent.name.split(" ")[0],
      value: agent.assignedConversations || 0,
    }))
    .filter((item) => item.value > 0);

  const pieColors = ["#10b981", "#06b6d4", "#0ea5e9", "#22d3ee", "#14b8a6", "#0891b2"];

  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: glowAnimation }} />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-80 h-80 bg-cyan-500/8 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto p-4 md:p-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-slate-400" data-testid="button-back-agents">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Gestión de Agentes</h1>
            <p className="text-xs text-slate-500">Crea y administra agentes que atienden mensajes</p>
          </div>
        </div>

        {agentAiColumnStatus && (
          <div
            className={cn(
              "mb-5 rounded-2xl border px-4 py-3 text-sm",
              agentAiColumnStatus.exists
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-red-500/30 bg-red-500/10 text-red-100",
            )}
            data-testid="alert-agent-ai-column-status"
          >
            {agentAiColumnStatus.exists
              ? "Columna OK: is_ai_auto_reply_enabled existe en la base de datos. El toggle IA auto por agente puede guardarse."
              : "Alerta: falta la columna is_ai_auto_reply_enabled en la base de datos. El toggle IA auto por agente no se guardara bien hasta corregir eso."}
          </div>
        )}

        <div className="mb-5 rounded-2xl border border-slate-700/30 bg-slate-800/30 backdrop-blur-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Desde</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-agents-date-from"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Hasta</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-agents-date-to"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-slate-600 text-slate-200"
              onClick={() => setQuickRange(1)}
              data-testid="button-agents-range-today"
            >
              Hoy
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-slate-600 text-slate-200"
              onClick={() => setQuickRange(7)}
              data-testid="button-agents-range-7d"
            >
              7 dias
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-slate-600 text-slate-200"
              onClick={() => setQuickRange(30)}
              data-testid="button-agents-range-30d"
            >
              30 dias
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-slate-400"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              data-testid="button-agents-range-clear"
            >
              Limpiar
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {dateFrom || dateTo
              ? `Mostrando metricas del rango ${dateFrom || "..."} a ${dateTo || "..."}` 
              : "Mostrando metricas acumuladas (sin filtro de fechas)"}
          </p>
        </div>

        <div className="mb-5 rounded-2xl border border-slate-700/30 bg-slate-800/30 backdrop-blur-xl p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Costo por agente (base: Chats con inbound)</h3>
            <p className="text-xs text-slate-400">
              Formula: (Chats con inbound * costo unitario Bs) / TC oficial * TC paralelo
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Fecha de costo diario</label>
              <Input
                type="date"
                value={costDate}
                onChange={(e) => setCostDate(e.target.value)}
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-cost-date"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Costo por chat con inbound (Bs)</label>
              <Input
                value={costPerInboundChatBs}
                onChange={(e) => setCostPerInboundChatBs(e.target.value)}
                placeholder="Ej. 1.23"
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-cost-per-inbound-chat-bs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Tipo de cambio oficial (Bs/USD)</label>
              <Input
                value={officialRateBs}
                onChange={(e) => setOfficialRateBs(e.target.value)}
                placeholder="Ej. 6.6"
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-official-rate-bs-usd"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Dolar paralelo (Bs/USD)</label>
              <Input
                value={parallelRateBs}
                onChange={(e) => setParallelRateBs(e.target.value)}
                placeholder="Ej. 9.23"
                className="h-9 bg-slate-800/60 border-slate-700/50 text-white"
                data-testid="input-parallel-rate-bs-usd"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => saveDailyCostMutation.mutate()}
              disabled={saveDailyCostMutation.isPending || !costDate}
              className="h-9 bg-gradient-to-r from-emerald-600 to-cyan-600 border-0"
              data-testid="button-save-daily-cost"
            >
              {saveDailyCostMutation.isPending ? "Guardando..." : "Guardar dia"}
            </Button>
            <p className="text-xs text-slate-500">
              Si no guarda precio para una fecha, el monto se muestra como `—`.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-cyan-300">Costo base total</p>
              <p className="text-lg font-semibold text-white mt-1">
                {totalBaseCostBs == null ? "—" : formatBs(totalBaseCostBs)}
              </p>
            </div>
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-violet-200">Equivalente USD</p>
              <p className="text-lg font-semibold text-white mt-1">
                {totalCostUsd == null ? "—" : formatUsd(totalCostUsd)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-emerald-300">Costo paralelo total</p>
              <p className="text-lg font-semibold text-white mt-1">
                {totalParallelCostBs == null ? "—" : formatBs(totalParallelCostBs)}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-slate-700/30 bg-slate-800/30 backdrop-blur-xl p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Asignacion por anuncio (ad_id)</h3>
            <p className="text-xs text-slate-400">
              Opcional: si no hay regla o agentes activos en esa regla, el sistema usa la asignacion normal actual.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-3">
            <Input
              value={routingAdId}
              onChange={(e) => setRoutingAdId(e.target.value)}
              placeholder="ad_id del anuncio (ej: 120221998877665)"
              className="bg-slate-800/60 border-slate-700/50 text-white"
              data-testid="input-ad-routing-ad-id"
            />
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
              <span className="text-xs text-slate-300">Activo</span>
              <Switch
                checked={routingIsActive}
                onCheckedChange={setRoutingIsActive}
                data-testid="switch-ad-routing-active"
              />
            </div>
          </div>
          <div className="mb-3">
            <p className="text-xs text-slate-400 mb-2">Modo de asignacion</p>
            <ToggleGroup
              type="single"
              value={routingIsExclusive ? "exclusive" : "mixed"}
              onValueChange={(value) => {
                if (!value) return;
                setRoutingIsExclusive(value === "exclusive");
              }}
              className="justify-start flex-wrap"
            >
              <ToggleGroupItem
                value="exclusive"
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-200 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
                data-testid="toggle-ad-routing-exclusive"
              >
                Solo anuncio
              </ToggleGroupItem>
              <ToggleGroupItem
                value="mixed"
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-200 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
                data-testid="toggle-ad-routing-mixed"
              >
                Anuncio + general
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[11px] text-slate-500 mt-2">
              "Solo anuncio" = no recibe la rotacion general. "Anuncio + general" = recibe ambos.
            </p>
          </div>
          <div className="mb-3">
            <p className="text-xs text-slate-400 mb-2">Producto inicial del anuncio</p>
            <select
              value={routingProductRoute}
              onChange={(e) => setRoutingProductRoute(e.target.value)}
              className="h-10 w-full rounded-md border border-slate-700/50 bg-slate-800/60 px-3 text-sm text-white outline-none focus:border-emerald-500"
              data-testid="select-ad-routing-product-route"
            >
              <option value="">Sin producto directo</option>
              {AD_PRODUCT_ROUTE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-2">
              Si el lead nuevo llega con este ad_id y mensaje generico, se envia este producto antes del menu inicial.
            </p>
          </div>
          <div className="mb-3">
            <p className="text-xs text-slate-400 mb-2">Agentes destino</p>
            <div className="flex flex-wrap gap-2">
              {activeAgents.map((agent) => {
                const selected = routingAgentIds.includes(agent.id);
                return (
                  <Button
                    key={`routing-agent-${agent.id}`}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    className={selected ? "bg-emerald-600 hover:bg-emerald-500" : "border-slate-600 text-slate-300"}
                    onClick={() => toggleRoutingAgent(agent.id)}
                    data-testid={`button-ad-routing-agent-${agent.id}`}
                  >
                    {agent.name}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                const cleanAdId = routingAdId.trim();
                const selectedActiveAgents = routingAgentIds.filter((id) => activeAgentIdSet.has(id));
                if (!cleanAdId) {
                  toast({ title: "Ingrese ad_id", variant: "destructive" });
                  return;
                }
                if (selectedActiveAgents.length === 0) {
                  toast({ title: "Seleccione al menos un agente activo", variant: "destructive" });
                  return;
                }
                upsertAdRoutingMutation.mutate({
                  adId: cleanAdId,
                  agentIds: selectedActiveAgents,
                  isActive: routingIsActive,
                  isExclusive: routingIsExclusive,
                  productRoute: routingProductRoute || null,
                });
              }}
              disabled={upsertAdRoutingMutation.isPending}
              className="bg-gradient-to-r from-emerald-600 to-cyan-600 border-0"
              data-testid="button-save-ad-routing-rule"
            >
              {upsertAdRoutingMutation.isPending ? "Guardando..." : "Guardar regla"}
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {adRoutingRules.length === 0 ? (
              <p className="text-xs text-slate-500">Sin reglas por anuncio. Todo sigue con asignacion normal.</p>
            ) : (
              adRoutingRules.map((rule) => (
                <div
                  key={`ad-rule-${rule.id}`}
                  className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2 flex flex-wrap items-center gap-2 justify-between"
                  data-testid={`card-ad-routing-rule-${rule.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium break-all">ad_id: {rule.adId}</p>
                    <p className="text-xs text-slate-400">
                      {rule.isActive ? "Activo" : "Inactivo"} |{" "}
                      {rule.isExclusive ? "Solo anuncio" : "Anuncio + general"} |{" "}
                      {getAdProductRouteLabel(rule.productRoute)} |{" "}
                      {rule.agentIds.map(getAgentName).join(", ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-red-500/50 text-red-300 hover:bg-red-500/10"
                    onClick={() => {
                      if (confirm(`Eliminar regla ad_id ${rule.adId}?`)) {
                        deleteAdRoutingMutation.mutate(rule.id);
                      }
                    }}
                    disabled={deleteAdRoutingMutation.isPending}
                    data-testid={`button-delete-ad-routing-rule-${rule.id}`}
                  >
                    Eliminar
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-slate-700/30 bg-slate-800/30 backdrop-blur-xl p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Permisos de Analytics entre agentes</h3>
            <p className="text-xs text-slate-400">
              Defina que agentes puede ver cada agente en la pagina de Analytics. Cada agente siempre mantiene acceso a sus propios datos.
            </p>
          </div>
          {agents.length === 0 || !selectedAnalyticsViewer ? (
            <p className="text-xs text-slate-500">No hay agentes para configurar.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
                <p className="text-xs text-slate-400 mb-2">Agente a configurar</p>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {agents.map((viewerAgent) => {
                    const viewerVisibleIds = (analyticsPermissionsDraft[viewerAgent.id] || []).filter((id) => id !== viewerAgent.id);
                    const isSelectedViewer = selectedAnalyticsViewer.id === viewerAgent.id;
                    return (
                      <button
                        key={`analytics-viewer-${viewerAgent.id}`}
                        type="button"
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition",
                          isSelectedViewer
                            ? "border-emerald-500/60 bg-emerald-500/10"
                            : "border-slate-700/70 bg-slate-800/40 hover:border-slate-500/70",
                        )}
                        onClick={() => setSelectedAnalyticsViewerId(viewerAgent.id)}
                        data-testid={`button-select-analytics-viewer-${viewerAgent.id}`}
                      >
                        <p className="text-sm font-medium text-white">{viewerAgent.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Puede ver: {viewerVisibleIds.length} agente{viewerVisibleIds.length === 1 ? "" : "s"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3"
                data-testid={`card-analytics-permissions-${selectedAnalyticsViewer.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{selectedAnalyticsViewer.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 break-words">
                      Puede ver: {selectedSummary}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 bg-gradient-to-r from-emerald-600 to-cyan-600 border-0"
                    disabled={saveAnalyticsPermissionMutation.isPending || selectedViewerId == null}
                    onClick={() => {
                      if (selectedViewerId == null) return;
                      saveAnalyticsPermissionMutation.mutate({
                        viewerAgentId: selectedViewerId,
                        visibleAgentIds: selectedVisibleIds,
                      });
                    }}
                    data-testid={`button-save-analytics-permissions-${selectedAnalyticsViewer.id}`}
                  >
                    {savingSelectedViewer ? "Guardando..." : "Guardar"}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Input
                    value={analyticsTargetSearch}
                    onChange={(e) => setAnalyticsTargetSearch(e.target.value)}
                    placeholder="Buscar agente..."
                    className="h-9 max-w-xs bg-slate-800/60 border-slate-700/50 text-white"
                    data-testid="input-analytics-target-search"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 border-slate-600 text-slate-200"
                    onClick={() => {
                      if (selectedViewerId == null) return;
                      setAnalyticsPermissionsDraft((prev) => {
                        const current = Array.isArray(prev[selectedViewerId]) ? prev[selectedViewerId] : [];
                        if (allFilteredTargetsSelected) {
                          const filteredSet = new Set(filteredAnalyticsTargetAgents.map((agent) => agent.id));
                          const next = current.filter((id) => !filteredSet.has(id));
                          return { ...prev, [selectedViewerId]: next };
                        }
                        const nextSet = new Set(current);
                        for (const target of filteredAnalyticsTargetAgents) {
                          nextSet.add(target.id);
                        }
                        return { ...prev, [selectedViewerId]: Array.from(nextSet) };
                      });
                    }}
                    data-testid="button-analytics-targets-select-toggle"
                  >
                    {allFilteredTargetsSelected ? "Quitar visibles" : "Marcar visibles"}
                  </Button>
                </div>

                <div className="mt-3 flex max-h-56 flex-wrap content-start gap-2 overflow-y-auto pr-1">
                  {filteredAnalyticsTargetAgents.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin resultados para ese filtro.</p>
                  ) : (
                    filteredAnalyticsTargetAgents.map((targetAgent) => {
                      const selected = selectedVisibleIds.includes(targetAgent.id);
                      return (
                        <Button
                          key={`analytics-permission-target-${selectedAnalyticsViewer.id}-${targetAgent.id}`}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className={selected ? "bg-emerald-600 hover:bg-emerald-500" : "border-slate-600 text-slate-300"}
                          onClick={() => toggleAnalyticsVisibleAgent(selectedAnalyticsViewer.id, targetAgent.id)}
                          data-testid={`button-analytics-permission-target-${selectedAnalyticsViewer.id}-${targetAgent.id}`}
                        >
                          {targetAgent.name}
                        </Button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="text-[11px] uppercase tracking-wide text-emerald-300">Agentes activos</p>
            <p className="text-2xl font-bold text-white mt-1">{activeAgents.length}</p>
          </div>
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3">
            <p className="text-[11px] uppercase tracking-wide text-sky-300">Chats con inbound</p>
            <p className="text-2xl font-bold text-white mt-1">{totalInboundChats}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-300">Pendientes llamar</p>
            <p className="text-2xl font-bold text-white mt-1">{totalShouldCall}</p>
          </div>
        </div>

        {!showForm ? (
          <Button
            onClick={() => setShowForm(true)}
            className="mb-5 bg-gradient-to-r from-emerald-600 to-cyan-600 border-0 shadow-lg shadow-emerald-500/20"
            data-testid="button-add-agent"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Agente
          </Button>
        ) : (
          <div className="mb-5 bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30 shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600/80 to-cyan-600/80 px-5 py-3 relative overflow-hidden">
              <div className="absolute inset-0 animate-glow-line" />
              <h3 className="relative text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Crear Agente
              </h3>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Nombre</label>
                  <Input
                    placeholder="Ej: María García"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white placeholder:text-slate-600"
                    data-testid="input-agent-name"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Usuario</label>
                  <Input
                    placeholder="Ej: maria"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white placeholder:text-slate-600"
                    data-testid="input-agent-username"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Contraseña</label>
                  <Input
                    type="text"
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white placeholder:text-slate-600"
                    data-testid="input-agent-password"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Peso (proporción de chats)</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={weight}
                    onChange={(e) => setWeight(parseInt(e.target.value) || 1)}
                    className="bg-slate-800/60 border-slate-700/50 text-white placeholder:text-slate-600"
                    data-testid="input-agent-weight"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-600 mb-4">
                Peso = proporción de chats. Agente con peso 3 recibe 3x más que uno con peso 1.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="bg-gradient-to-r from-emerald-600 to-cyan-600 border-0"
                  data-testid="button-save-agent"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createMutation.isPending ? "Creando..." : "Crear Agente"}
                </Button>
                <Button variant="ghost" onClick={resetForm} className="text-slate-400" data-testid="button-cancel-agent">
                  <X className="h-4 w-4 mr-2" />
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin h-10 w-10 border-3 border-emerald-500 border-t-transparent rounded-full" />
            <span className="text-slate-500 text-sm mt-4">Cargando agentes...</span>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30">
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-slate-800/50 flex items-center justify-center border border-slate-700/50">
              <Users className="h-6 w-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm">No hay agentes creados</p>
            <p className="text-slate-600 text-xs mt-1">Los mensajes se manejan solo desde la cuenta admin</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30 shadow-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Mensajes por agente</h3>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={performanceData} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(16,185,129,0.08)" }}
                        contentStyle={{
                          background: "rgba(15,23,42,0.95)",
                          border: "1px solid rgba(148,163,184,0.25)",
                          borderRadius: "12px",
                          color: "#e2e8f0",
                        }}
                      />
                      <Bar dataKey="mensajes" radius={[8, 8, 0, 0]} fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30 shadow-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Distribucion de chats (activos)</h3>
                </div>
                <div className="h-56">
                  {distributionData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-slate-500">
                      Sin chats asignados aun
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={distributionData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={58}
                          outerRadius={82}
                          paddingAngle={2}
                        >
                          {distributionData.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={pieColors[index % pieColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(148,163,184,0.25)",
                            borderRadius: "12px",
                            color: "#e2e8f0",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {activeAgents.length > 0 && (
              <div className="bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30 shadow-xl shadow-emerald-500/10 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-600/80 to-teal-600/80 px-4 py-3 relative overflow-hidden">
                  <div className="absolute inset-0 animate-glow-line" />
                  <div className="relative flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    <span className="font-semibold text-sm text-white">Agentes Activos</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm font-bold">
                      {activeAgents.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {activeAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      editingId={editingId}
                      setEditingId={setEditingId}
                      showPassword={showPasswords[agent.id] || false}
                      togglePassword={() => setShowPasswords(p => ({ ...p, [agent.id]: !p[agent.id] }))}
                      onToggleActive={() => toggleActive(agent)}
                      onToggleAgentAiAutoReply={() => toggleAgentAiAutoReply(agent)}
                      onDelete={() => {
                        if (confirm(`¿Eliminar agente "${agent.name}"?`)) {
                          deleteMutation.mutate(agent.id);
                        }
                      }}
                      onUpdate={(updates) => updateMutation.mutate({ id: agent.id, ...updates })}
                      isPending={updateMutation.isPending}
                      unitCostBs={unitCostBs}
                      officialRate={officialRate}
                      parallelRate={parallelRate}
                    />
                  ))}
                </div>
              </div>
            )}

            {inactiveAgents.length > 0 && (
              <div className="bg-slate-800/30 backdrop-blur-xl rounded-2xl border border-slate-700/30 shadow-xl shadow-slate-500/10 overflow-hidden">
                <div className="bg-gradient-to-r from-slate-600/80 to-slate-700/80 px-4 py-3 relative overflow-hidden">
                  <div className="absolute inset-0 animate-glow-line" />
                  <div className="relative flex items-center gap-2">
                    <PowerOff className="h-4 w-4" />
                    <span className="font-semibold text-sm text-white">Inactivos</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm font-bold">
                      {inactiveAgents.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {inactiveAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      editingId={editingId}
                      setEditingId={setEditingId}
                      showPassword={showPasswords[agent.id] || false}
                      togglePassword={() => setShowPasswords(p => ({ ...p, [agent.id]: !p[agent.id] }))}
                      onToggleActive={() => toggleActive(agent)}
                      onToggleAgentAiAutoReply={() => toggleAgentAiAutoReply(agent)}
                      onDelete={() => {
                        if (confirm(`¿Eliminar agente "${agent.name}"?`)) {
                          deleteMutation.mutate(agent.id);
                        }
                      }}
                      onUpdate={(updates) => updateMutation.mutate({ id: agent.id, ...updates })}
                      isPending={updateMutation.isPending}
                      unitCostBs={unitCostBs}
                      officialRate={officialRate}
                      parallelRate={parallelRate}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  editingId,
  setEditingId,
  showPassword,
  togglePassword,
  onToggleActive,
  onToggleAgentAiAutoReply,
  onDelete,
  onUpdate,
  isPending,
  unitCostBs,
  officialRate,
  parallelRate,
}: {
  agent: AgentWithStats;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  showPassword: boolean;
  togglePassword: () => void;
  onToggleActive: () => void;
  onToggleAgentAiAutoReply: () => void;
  onDelete: () => void;
  onUpdate: (updates: Record<string, any>) => void;
  isPending: boolean;
  unitCostBs: number;
  officialRate: number;
  parallelRate: number;
}) {
  const isEditing = editingId === agent.id;
  const [editName, setEditName] = useState(agent.name);
  const [editUsername, setEditUsername] = useState(agent.username);
  const [editWeight, setEditWeight] = useState(agent.weight || 1);
  const [editPassword, setEditPassword] = useState(agent.password);
  const [showMobileStats, setShowMobileStats] = useState(false);
  const inboundChats = agent.inboundChats || 0;
  const baseCostBs = inboundChats * unitCostBs;
  const equivalentUsd = officialRate > 0 ? baseCostBs / officialRate : 0;
  const parallelCostBs = equivalentUsd * parallelRate;
  const formatLastActivity = (value?: string | null) => {
    if (!value) return "Sin actividad";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sin actividad";
    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const startEdit = () => {
    setEditName(agent.name);
    setEditUsername(agent.username);
    setEditWeight(agent.weight || 1);
    setEditPassword(agent.password);
    setEditingId(agent.id);
  };

  return (
    <div
      className={cn(
        "rounded-xl p-4 backdrop-blur-sm border border-slate-700/50 shadow-lg shadow-black/20",
        "transition-transform duration-100 active:scale-[0.98]",
        agent.isActive
          ? "border-l-2 border-l-emerald-500 bg-slate-800/80"
          : "border-l-2 border-l-slate-600 bg-slate-800/40 opacity-70"
      )}
      data-testid={`agent-card-${agent.id}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 min-w-0 w-full">
          <div className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-lg",
            agent.isActive
              ? "bg-gradient-to-br from-emerald-500 to-cyan-600"
              : "bg-gradient-to-br from-slate-500 to-slate-600"
          )}>
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white h-8 w-40"
                    placeholder="Nombre"
                    data-testid="input-edit-agent-name"
                  />
                  <Input
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white h-8 w-32"
                    placeholder="Usuario"
                    data-testid="input-edit-agent-username"
                  />
                  <Input
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="bg-slate-800/60 border-slate-700/50 text-white h-8 w-32"
                    placeholder="Contraseña"
                    data-testid="input-edit-agent-password"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={editWeight}
                    onChange={(e) => setEditWeight(parseInt(e.target.value) || 1)}
                    className="bg-slate-800/60 border-slate-700/50 text-white h-8 w-20"
                    data-testid="input-edit-agent-weight"
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      const nextName = editName.trim();
                      const nextUsername = editUsername.trim();
                      const nextPassword = editPassword.trim();
                      if (!nextName || !nextUsername || !nextPassword) return;
                      onUpdate({ name: nextName, username: nextUsername, password: nextPassword, weight: editWeight });
                      setEditingId(null);
                    }}
                    disabled={isPending || !editName.trim() || !editUsername.trim() || !editPassword.trim()}
                    className="bg-gradient-to-r from-emerald-600 to-cyan-600 border-0 h-7 text-xs"
                    data-testid="button-save-edit-agent"
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    className="text-slate-400 h-7 text-xs"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-semibold text-white truncate">{agent.name}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                  <span>@{agent.username}</span>
                  <span className="flex items-center gap-1">
                    {showPassword ? agent.password : "••••••"}
                    <button onClick={togglePassword} className="text-slate-500">
                      {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-medium border border-current/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                    Peso: {agent.weight || 1}
                  </span>
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-current/20",
                    agent.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                  )}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", agent.isActive ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                    {agent.isActive ? "Activo" : "Inactivo"}
                  </span>
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-current/20",
                    agent.isAiAutoReplyEnabled ? "bg-cyan-500/20 text-cyan-400" : "bg-red-500/20 text-red-400"
                  )}>
                    {agent.isAiAutoReplyEnabled ? <Bot className="h-3 w-3" /> : <BotOff className="h-3 w-3" />}
                    {agent.isAiAutoReplyEnabled ? "IA auto ON" : "IA auto OFF"}
                  </span>
                </div>
                {!isEditing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMobileStats((prev) => !prev)}
                    className="md:hidden mt-2 h-7 px-2 text-xs text-cyan-300"
                    data-testid={`button-toggle-agent-stats-${agent.id}`}
                  >
                    {showMobileStats ? "Ocultar info" : "Ver info"}
                  </Button>
                )}
                <div className={cn(
                  "mt-3 gap-2.5",
                  showMobileStats ? "grid grid-cols-1" : "hidden",
                  "md:grid md:grid-cols-2 lg:grid-cols-4",
                )}>
                  <div className="group relative overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5">
                    <div className="absolute left-0 top-0 h-0.5 w-full bg-emerald-400/80" />
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1">
                      <MessageSquare className="h-3 w-3 text-emerald-300" />
                      Chats con inbound
                    </p>
                    <p className="mt-1 text-xl font-black text-white tabular-nums">{inboundChats}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">chats unicos con inbound</p>
                  </div>

                  <div className="group relative overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5">
                    <div className="absolute left-0 top-0 h-0.5 w-full bg-cyan-400/80" />
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Costo estimado</p>
                    <p className="mt-1 text-[11px] text-slate-200">Base: <span className="font-semibold text-white">{formatBs(baseCostBs)}</span></p>
                    <p className="text-[11px] text-slate-300">USD: <span className="font-semibold text-white">{formatUsd(equivalentUsd)}</span></p>
                    <p className="text-[11px] text-slate-300">Paralelo: <span className="font-semibold text-white">{formatBs(parallelCostBs)}</span></p>
                  </div>

                  <div className="group relative overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5">
                    <div className="absolute left-0 top-0 h-0.5 w-full bg-amber-400/80" />
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Por llamar</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-xl font-black text-white tabular-nums">{agent.shouldCallCount || 0}</p>
                      <span className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold border",
                        (agent.shouldCallCount || 0) > 0
                          ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                          : "border-slate-600/60 bg-slate-800/70 text-slate-400"
                      )}>
                        {(agent.shouldCallCount || 0) > 0 ? "accion" : "ok"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">seguimiento comercial</p>
                  </div>

                  <div className="group relative overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5">
                    <div className="absolute left-0 top-0 h-0.5 w-full bg-violet-300/70" />
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-violet-200" />
                      Ultima actividad
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-100 leading-tight">{formatLastActivity(agent.lastActivityAt)}</p>
                    <p className="text-[10px] text-slate-500 mt-1">timestamp de mensajes</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 self-end md:self-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={startEdit}
              title="Editar"
              className="text-slate-400"
              data-testid={`button-edit-agent-${agent.id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleAgentAiAutoReply}
              title={agent.isAiAutoReplyEnabled ? "Desactivar IA automática" : "Activar IA automática"}
              className={agent.isAiAutoReplyEnabled ? "text-cyan-400" : "text-red-400"}
              data-testid={`button-toggle-agent-ai-${agent.id}`}
            >
              {agent.isAiAutoReplyEnabled ? <Bot className="h-4 w-4" /> : <BotOff className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleActive}
              title={agent.isActive ? "Desactivar" : "Activar"}
              className={agent.isActive ? "text-emerald-400" : "text-red-400"}
              data-testid={`button-toggle-agent-${agent.id}`}
            >
              {agent.isActive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              title="Eliminar"
              className="text-slate-400"
              data-testid={`button-delete-agent-${agent.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
