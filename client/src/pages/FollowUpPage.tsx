import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  ArrowLeft, 
  Phone, 
  Send, 
  RefreshCw, 
  Calendar,
  MessageSquare,
  Loader2,
  CheckCircle,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
  Clock
} from "lucide-react";

interface FollowUpConversation {
  id: number;
  waId: string;
  contactName: string | null;
  lastMessage: string | null;
  shouldCall: boolean;
  lastOutboundMessage: {
    text: string | null;
    createdAt: string | null;
  };
  messageCount: number;
}

interface PurchaseAnalysis {
  id: number;
  conversationId: number;
  probability: string;
  reasoning: string | null;
  createdAt: string;
}

interface FollowUpSettings {
  enabled: boolean | null;
  followUpEnabled: boolean | null;
  followUpMinutes: number | null;
  followUpCheckIntervalMinutes: number | null;
  followUpBatchSize: number | null;
  followUpMessageMode: string | null;
  followUpFixedMessage: string | null;
}

export default function FollowUpPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeFilter, setTimeFilter] = useState<string>("today");
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [generating, setGenerating] = useState<number | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<number, { probability: string; reason: string }>>({});
  const [followUpMessages, setFollowUpMessages] = useState<Record<number, string>>({});
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<Record<number, PurchaseAnalysis[]>>({});
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMinutes, setFollowUpMinutes] = useState(20);
  const [followUpCheckIntervalMinutes, setFollowUpCheckIntervalMinutes] = useState(5);
  const [followUpBatchSize, setFollowUpBatchSize] = useState(10);
  const [followUpMessageMode, setFollowUpMessageMode] = useState<"ai" | "fixed">("ai");
  const [followUpFixedMessage, setFollowUpFixedMessage] = useState("");
  const [settingsEdited, setSettingsEdited] = useState(false);

  const { data: settings } = useQuery<FollowUpSettings>({
    queryKey: ["/api/ai/settings"],
  });

  useEffect(() => {
    if (!settings || settingsEdited) return;
    setFollowUpEnabled(settings.followUpEnabled || false);
    setFollowUpMinutes(settings.followUpMinutes || 20);
    setFollowUpCheckIntervalMinutes(settings.followUpCheckIntervalMinutes || 5);
    setFollowUpBatchSize(settings.followUpBatchSize || 10);
    setFollowUpMessageMode(settings.followUpMessageMode === "fixed" ? "fixed" : "ai");
    setFollowUpFixedMessage(settings.followUpFixedMessage || "");
  }, [settings, settingsEdited]);

  const { data: conversations = [], isLoading, refetch } = useQuery<FollowUpConversation[]>({
    queryKey: ["/api/follow-up", timeFilter],
    queryFn: async () => {
      const res = await fetch(`/api/follow-up?timeFilter=${timeFilter}`);
      return res.json();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, message }: { conversationId: number; message: string }) => {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) throw new Error("Conversation not found");
      
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: conv.waId, type: "text", text: message }),
      });
      if (!res.ok) throw new Error("Error al enviar mensaje");
      return res.json();
    },
    onSuccess: (_, { conversationId }) => {
      toast({ title: "Mensaje enviado" });
      setFollowUpMessages(prev => {
        const copy = { ...prev };
        delete copy[conversationId];
        return copy;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/follow-up"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", "/api/ai/settings", {
        followUpEnabled,
        followUpMinutes,
        followUpCheckIntervalMinutes,
        followUpBatchSize,
        followUpMessageMode,
        followUpFixedMessage: followUpMessageMode === "fixed" ? (followUpFixedMessage.trim() || null) : null,
      });
    },
    onSuccess: () => {
      toast({ title: "Configuración de seguimiento guardada" });
      setSettingsEdited(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/follow-up"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    },
  });

  const toggleShouldCallMutation = useMutation({
    mutationFn: async ({ id, shouldCall }: { id: number; shouldCall: boolean }) => {
      const res = await fetch(`/api/conversations/${id}/should-call`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shouldCall }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-up"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  const analyzeConversation = async (id: number) => {
    setAnalyzing(id);
    try {
      const res = await fetch(`/api/conversations/${id}/analyze-purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      setAnalysisResults(prev => ({ ...prev, [id]: result }));
      
      if (result.shouldCall) {
        queryClient.invalidateQueries({ queryKey: ["/api/follow-up"] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
    } catch (error) {
      toast({ title: "Error al analizar", variant: "destructive" });
    }
    setAnalyzing(null);
  };

  const generateFollowUp = async (id: number) => {
    setGenerating(id);
    try {
      const res = await fetch(`/api/conversations/${id}/generate-followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      setFollowUpMessages(prev => ({ ...prev, [id]: result.message }));
    } catch (error) {
      toast({ title: "Error al generar mensaje", variant: "destructive" });
    }
    setGenerating(null);
  };

  const toggleHistory = async (id: number) => {
    if (expandedHistory === id) {
      setExpandedHistory(null);
    } else {
      setExpandedHistory(id);
      if (!historyData[id]) {
        try {
          const res = await fetch(`/api/conversations/${id}/purchase-history`);
          const data = await res.json();
          setHistoryData(prev => ({ ...prev, [id]: data }));
        } catch (error) {
          toast({ title: "Error al cargar historial", variant: "destructive" });
        }
      }
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleString("es-MX", { 
      hour: "2-digit", 
      minute: "2-digit",
      day: "2-digit",
      month: "short"
    });
  };

  const getProbabilityColor = (prob: string) => {
    if (prob === "ALTA") return "bg-green-500";
    if (prob === "MEDIA") return "bg-yellow-500";
    return "bg-gray-500";
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Seguimiento</h1>
          <Link href="/reminders">
            <Button variant="outline" size="sm" data-testid="button-go-reminders">
              <Clock className="h-4 w-4 mr-2" />
              Recordatorios
            </Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <Button 
            variant={timeFilter === "today" ? "default" : "outline"}
            onClick={() => setTimeFilter("today")}
            data-testid="filter-today"
          >
            <Calendar className="h-4 w-4 mr-2" />
            Hoy
          </Button>
          <Button 
            variant={timeFilter === "yesterday" ? "default" : "outline"}
            onClick={() => setTimeFilter("yesterday")}
            data-testid="filter-yesterday"
          >
            Ayer
          </Button>
          <Button 
            variant={timeFilter === "before_yesterday" ? "default" : "outline"}
            onClick={() => setTimeFilter("before_yesterday")}
            data-testid="filter-before-yesterday"
          >
            Antes de ayer
          </Button>
          <Button 
            variant={timeFilter === "" ? "default" : "outline"}
            onClick={() => setTimeFilter("")}
            data-testid="filter-all"
          >
            Todos
          </Button>
        </div>

        <Card className="mb-6" data-testid="follow-up-settings-card">
          <CardHeader>
            <CardTitle>Automatización de Re-enganche</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="follow-up-enabled">Re-enganche automático</Label>
                <p className="text-sm text-muted-foreground">
                  Si el cliente te dejó en visto, el CRM le escribe para retomar la conversación.
                </p>
              </div>
              <Switch
                id="follow-up-enabled"
                checked={followUpEnabled}
                onCheckedChange={(checked) => {
                  setFollowUpEnabled(checked);
                  setSettingsEdited(true);
                }}
                data-testid="switch-follow-up-enabled-page"
              />
            </div>

            {followUpEnabled && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <Label htmlFor="follow-up-minutes">Minutos de espera</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="follow-up-minutes"
                      type="range"
                      min={5}
                      max={60}
                      value={followUpMinutes}
                      onChange={(e) => {
                        setFollowUpMinutes(parseInt(e.target.value) || 20);
                        setSettingsEdited(true);
                      }}
                      className="flex-1 accent-emerald-500"
                      data-testid="slider-follow-up-minutes-page"
                    />
                    <span className="min-w-[4rem] text-center font-semibold text-emerald-600">{followUpMinutes} min</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Este es el tiempo mínimo que debe pasar sin respuesta del cliente antes del primer re-enganche.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="follow-up-check-interval">Revisar cada</Label>
                    <div className="flex items-center gap-3">
                      <input
                        id="follow-up-check-interval"
                        type="range"
                        min={1}
                        max={30}
                        value={followUpCheckIntervalMinutes}
                        onChange={(e) => {
                          setFollowUpCheckIntervalMinutes(parseInt(e.target.value) || 5);
                          setSettingsEdited(true);
                        }}
                        className="flex-1 accent-emerald-500"
                        data-testid="slider-follow-up-check-interval"
                      />
                      <span className="min-w-[4rem] text-center font-semibold text-emerald-600">{followUpCheckIntervalMinutes} min</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Frecuencia con la que el sistema revisa si hay conversaciones listas para re-enganchar.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="follow-up-batch-size">Máximo por corrida</Label>
                    <div className="flex items-center gap-3">
                      <input
                        id="follow-up-batch-size"
                        type="range"
                        min={1}
                        max={50}
                        value={followUpBatchSize}
                        onChange={(e) => {
                          setFollowUpBatchSize(parseInt(e.target.value) || 10);
                          setSettingsEdited(true);
                        }}
                        className="flex-1 accent-emerald-500"
                        data-testid="slider-follow-up-batch-size"
                      />
                      <span className="min-w-[4rem] text-center font-semibold text-emerald-600">{followUpBatchSize}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Límite de conversaciones que el sistema puede procesar en cada revisión automática.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Mensaje del primer re-enganche</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={followUpMessageMode === "ai" ? "default" : "outline"}
                      onClick={() => {
                        setFollowUpMessageMode("ai");
                        setSettingsEdited(true);
                      }}
                      data-testid="button-follow-up-mode-ai"
                    >
                      Generado por IA
                    </Button>
                    <Button
                      type="button"
                      variant={followUpMessageMode === "fixed" ? "default" : "outline"}
                      onClick={() => {
                        setFollowUpMessageMode("fixed");
                        setSettingsEdited(true);
                      }}
                      data-testid="button-follow-up-mode-fixed"
                    >
                      Texto pregrabado
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Se enviará como máximo un seguimiento automático hasta que el cliente vuelva a responder.
                  </p>
                </div>

                {followUpMessageMode === "fixed" && (
                  <div className="space-y-2">
                    <Label htmlFor="follow-up-fixed-message">Texto pregrabado</Label>
                    <Textarea
                      id="follow-up-fixed-message"
                      value={followUpFixedMessage}
                      onChange={(e) => {
                        setFollowUpFixedMessage(e.target.value);
                        setSettingsEdited(true);
                      }}
                      className="min-h-[110px]"
                      placeholder="Ej: Quedo atento por si desea que le confirme precio y envío según su ciudad."
                      data-testid="textarea-follow-up-fixed-message"
                    />
                    <p className="text-sm text-muted-foreground">
                      Si lo dejas vacío, el sistema hará fallback al mensaje generado por IA.
                    </p>
                  </div>
                )}
              </div>
            )}

            {settingsEdited && (
              <Button
                onClick={() => saveSettingsMutation.mutate()}
                disabled={saveSettingsMutation.isPending}
                data-testid="button-save-follow-up-settings"
              >
                {saveSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Guardar automatización
              </Button>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay conversaciones pendientes de respuesta</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {conversations.map((conv) => (
              <Card 
                key={conv.id} 
                className={conv.shouldCall ? "border-green-500 border-2" : ""}
                data-testid={`followup-card-${conv.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">
                        {conv.contactName || conv.waId}
                      </CardTitle>
                      {conv.shouldCall && (
                        <Badge className="bg-green-500 text-white">
                          <Phone className="h-3 w-3 mr-1" />
                          Llamar
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {formatTime(conv.lastOutboundMessage?.createdAt)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    Último mensaje: {conv.lastOutboundMessage?.text || conv.lastMessage || "Sin mensaje"}
                  </p>

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeConversation(conv.id)}
                      disabled={analyzing === conv.id}
                      data-testid={`button-analyze-${conv.id}`}
                    >
                      {analyzing === conv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <AlertCircle className="h-4 w-4 mr-2" />
                      )}
                      Analizar
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateFollowUp(conv.id)}
                      disabled={generating === conv.id}
                      data-testid={`button-generate-${conv.id}`}
                    >
                      {generating === conv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <MessageSquare className="h-4 w-4 mr-2" />
                      )}
                      Generar recordatorio
                    </Button>

                    <Button
                      variant={conv.shouldCall ? "default" : "outline"}
                      size="sm"
                      className={conv.shouldCall ? "bg-green-500" : ""}
                      onClick={() => toggleShouldCallMutation.mutate({ 
                        id: conv.id, 
                        shouldCall: !conv.shouldCall 
                      })}
                      data-testid={`button-call-${conv.id}`}
                    >
                      <Phone className="h-4 w-4 mr-2" />
                      {conv.shouldCall ? "Quitar llamar" : "Marcar llamar"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleHistory(conv.id)}
                      data-testid={`button-history-${conv.id}`}
                    >
                      <History className="h-4 w-4 mr-2" />
                      Historial
                      {expandedHistory === conv.id ? (
                        <ChevronUp className="h-4 w-4 ml-1" />
                      ) : (
                        <ChevronDown className="h-4 w-4 ml-1" />
                      )}
                    </Button>

                    <Link href="/">
                      <Button variant="ghost" size="sm" data-testid={`button-goto-${conv.id}`}>
                        Ver chat
                      </Button>
                    </Link>
                  </div>

                  {expandedHistory === conv.id && historyData[conv.id] && (
                    <div className="p-3 rounded-md bg-muted space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <History className="h-4 w-4" />
                        Historial de Análisis
                      </div>
                      {historyData[conv.id].length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin análisis previos</p>
                      ) : (
                        <div className="space-y-2">
                          {historyData[conv.id].map((analysis) => (
                            <div 
                              key={analysis.id} 
                              className="flex items-center gap-2 text-sm p-2 rounded bg-background"
                            >
                              <Badge className={getProbabilityColor(analysis.probability)}>
                                {analysis.probability}
                              </Badge>
                              <span className="flex-1">{analysis.reasoning || "Sin detalle"}</span>
                              <span className="text-muted-foreground text-xs">
                                {formatTime(analysis.createdAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {analysisResults[conv.id] && (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted">
                      <Badge className={getProbabilityColor(analysisResults[conv.id].probability)}>
                        {analysisResults[conv.id].probability}
                      </Badge>
                      <span className="text-sm">{analysisResults[conv.id].reason}</span>
                    </div>
                  )}

                  {followUpMessages[conv.id] && (
                    <div className="space-y-2">
                      <Textarea
                        value={followUpMessages[conv.id]}
                        onChange={(e) => setFollowUpMessages(prev => ({
                          ...prev,
                          [conv.id]: e.target.value
                        }))}
                        className="min-h-[80px] text-sm"
                        placeholder="Edita el mensaje antes de enviar..."
                        data-testid={`textarea-message-${conv.id}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => sendMessageMutation.mutate({ 
                            conversationId: conv.id, 
                            message: followUpMessages[conv.id] 
                          })}
                          disabled={sendMessageMutation.isPending || !followUpMessages[conv.id]?.trim()}
                          data-testid={`button-send-${conv.id}`}
                        >
                          {sendMessageMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Send className="h-4 w-4 mr-2" />
                          )}
                          Enviar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFollowUpMessages(prev => {
                            const copy = { ...prev };
                            delete copy[conv.id];
                            return copy;
                          })}
                          data-testid={`button-cancel-${conv.id}`}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
