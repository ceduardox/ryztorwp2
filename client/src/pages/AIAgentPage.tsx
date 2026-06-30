import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { 
  ArrowLeft, 
  Bot, 
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  Save,
  Plus,
  Trash2,
  Pencil,
  Package,
  X,
  Check,
  MessageSquare,
  Clock
} from "lucide-react";

interface AiSettings {
  id?: number;
  enabled: boolean;
  systemPrompt: string | null;
  catalog: string | null;
  maxTokens: number | null;
  temperature: number | null;
  aiProvider: string | null;
  model: string | null;
  maxPromptChars: number | null;
  conversationHistory: number | null;
  audioResponseEnabled: boolean | null;
  audioVoice: string | null;
  ttsProvider: string | null;
  elevenlabsVoiceId: string | null;
  ttsSpeed: number | null;
  ttsInstructions: string | null;
  learningMode: boolean | null;
  followUpEnabled: boolean | null;
  followUpMinutes: number | null;
}

interface PromptProfiles {
  primaryPrompt: string;
  secondaryPrompt: string;
  tertiaryPrompt: string;
  activeSlot: "primary" | "secondary" | "tertiary";
}

interface Product {
  id: number;
  name: string;
  keywords: string | null;
  description: string | null;
  price: string | null;
  imageUrl: string | null;
  imageBottleUrl?: string | null;
  imageDoseUrl?: string | null;
  imageIngredientsUrl?: string | null;
  createdAt: string;
}

interface AiLog {
  id: number;
  conversationId: number | null;
  userMessage: string | null;
  aiResponse: string | null;
  tokensUsed: number | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}

interface LearnedRule {
  id: number;
  rule: string;
  learnedFrom: string | null;
  conversationId: number | null;
  isActive: boolean;
  createdAt: string;
}

interface PushLog {
  timestamp: string;
  title: string;
  message: string;
  event: string;
  success: boolean;
  error?: string;
}

interface PushSettings {
  notifyNewMessages: boolean;
  notifyPending: boolean;
}

export default function AIAgentPage() {
  const { toast } = useToast();
  const [primaryPrompt, setPrimaryPrompt] = useState("");
  const [secondaryPrompt, setSecondaryPrompt] = useState("");
  const [tertiaryPrompt, setTertiaryPrompt] = useState("");
  const [activePromptSlot, setActivePromptSlot] = useState<"primary" | "secondary" | "tertiary">("primary");
  const [promptEdited, setPromptEdited] = useState(false);
  
  // AI config state
  const [maxTokens, setMaxTokens] = useState(120);
  const [temperature, setTemperature] = useState(70);
  const [aiProvider, setAiProvider] = useState<"openai" | "gemini">("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [maxPromptChars, setMaxPromptChars] = useState(2000);
  const [conversationHistory, setConversationHistory] = useState(3);
  const [audioResponseEnabled, setAudioResponseEnabled] = useState(false);
  const [audioVoice, setAudioVoice] = useState("nova");
  const [ttsProvider, setTtsProvider] = useState("openai");
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState("JBFqnCBsd6RMkjVDRZzb");
  const [voiceSearchQuery, setVoiceSearchQuery] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<{ saved: boolean; free: boolean; cache: "hit" | "miss" | null } | null>(null);
  const [previewStatusLoading, setPreviewStatusLoading] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const [ttsSpeed, setTtsSpeed] = useState(100);
  const [ttsInstructions, setTtsInstructions] = useState("");
  const [fixedCommerceFlowEnabled, setFixedCommerceFlowEnabled] = useState(true);
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMinutes, setFollowUpMinutes] = useState(20);
  const [configEdited, setConfigEdited] = useState(false);

  const openAiModelOptions = [
    { value: "gpt-4o-mini", label: "GPT-4o Mini (rapido, economico)" },
    { value: "gpt-4o", label: "GPT-4o (mas inteligente)" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ];
  const geminiModelOptions = [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (rapido)" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (economico)" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (mas completo)" },
  ];
  const modelOptions = aiProvider === "gemini" ? geminiModelOptions : openAiModelOptions;

  const getDefaultModelForProvider = (provider: "openai" | "gemini") =>
    provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini";
  
  // Product form state
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newImageBottleUrl, setNewImageBottleUrl] = useState("");
  const [newImageDoseUrl, setNewImageDoseUrl] = useState("");
  const [newImageIngredientsUrl, setNewImageIngredientsUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadingSlots, setUploadingSlots] = useState<Record<string, boolean>>({});
  
  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editImageBottleUrl, setEditImageBottleUrl] = useState("");
  const [editImageDoseUrl, setEditImageDoseUrl] = useState("");
  const [editImageIngredientsUrl, setEditImageIngredientsUrl] = useState("");

  const { data: settings, isLoading: settingsLoading } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  const { data: promptProfiles } = useQuery<PromptProfiles>({
    queryKey: ["/api/ai/prompt-profiles"],
  });

  interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    category: string;
    labels: Record<string, string>;
    preview_url: string;
    source?: "library" | "shared";
  }

  const { data: elevenLabsVoices = [], isLoading: elVoicesLoading, isError: elVoicesError } = useQuery<ElevenLabsVoice[]>({
    queryKey: ["/api/elevenlabs/voices"],
    enabled: ttsProvider === "elevenlabs" && audioResponseEnabled,
    staleTime: 5 * 60 * 1000,
  });
  const selectedElevenVoice = elevenLabsVoices.find((voice) => voice.voice_id === elevenlabsVoiceId);
  const selectedElevenPreviewUrl = selectedElevenVoice?.preview_url;

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<AiLog[]>({
    queryKey: ["/api/ai/logs"],
    refetchInterval: 10000,
  });

  const { data: learnedRules = [], isLoading: rulesLoading } = useQuery<LearnedRule[]>({
    queryKey: ["/api/ai/rules"],
  });

  const { data: pushLogs = [], isLoading: pushLogsLoading, refetch: refetchPushLogs } = useQuery<PushLog[]>({
    queryKey: ["/api/push-logs"],
    refetchInterval: 10000,
  });
  const { data: pushSettings } = useQuery<PushSettings>({
    queryKey: ["/api/push-settings"],
  });

  const openAiVoiceOptions = [
    { value: "marin", label: "Marin", desc: "Realista", realistic: true },
    { value: "cedar", label: "Cedar", desc: "Realista", realistic: true },
    { value: "ash", label: "Ash", desc: "Realista", realistic: true },
    { value: "ballad", label: "Ballad", desc: "Realista", realistic: true },
    { value: "sage", label: "Sage", desc: "Realista", realistic: true },
    { value: "verse", label: "Verse", desc: "Realista", realistic: true },
    { value: "coral", label: "Coral", desc: "Basica", realistic: false },
    { value: "nova", label: "Nova", desc: "Basica", realistic: false },
    { value: "alloy", label: "Alloy", desc: "Basica", realistic: false },
    { value: "echo", label: "Echo", desc: "Basica", realistic: false },
    { value: "shimmer", label: "Shimmer", desc: "Basica", realistic: false },
    { value: "fable", label: "Fable", desc: "Basica", realistic: false },
    { value: "onyx", label: "Onyx", desc: "Basica", realistic: false },
  ];
  const normalizedVoiceSearch = voiceSearchQuery.toLowerCase().trim();
  const filteredOpenAiVoices = openAiVoiceOptions.filter((voice) => {
    if (!normalizedVoiceSearch) return true;
    return (
      voice.label.toLowerCase().includes(normalizedVoiceSearch) ||
      voice.desc.toLowerCase().includes(normalizedVoiceSearch) ||
      voice.value.toLowerCase().includes(normalizedVoiceSearch)
    );
  });
  const filteredElevenLabsVoices = elevenLabsVoices.filter((voice) => {
    if (!normalizedVoiceSearch) return true;
    const description = String(
      voice.labels?.description || voice.labels?.accent || voice.labels?.use_case || voice.category || "",
    ).toLowerCase();
    return (
      voice.name.toLowerCase().includes(normalizedVoiceSearch) ||
      description.includes(normalizedVoiceSearch) ||
      voice.voice_id.toLowerCase().includes(normalizedVoiceSearch)
    );
  });

  // State for editing rules
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleText, setEditRuleText] = useState("");

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ai/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
      toast({ title: "Regla eliminada" });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, rule, isActive }: { id: number; rule?: string; isActive?: boolean }) => {
      return apiRequest("PATCH", `/api/ai/rules/${id}`, { rule, isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
      toast({ title: "Regla actualizada" });
      setEditingRuleId(null);
    },
  });

  const updatePushSettingsMutation = useMutation({
    mutationFn: async (data: Partial<PushSettings>) => {
      return apiRequest("PATCH", "/api/push-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/push-settings"] });
      toast({ title: "Preferencias de push guardadas" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar push", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (promptProfiles && !promptEdited) {
      setPrimaryPrompt(promptProfiles.primaryPrompt || "");
      setSecondaryPrompt(promptProfiles.secondaryPrompt || "");
      setTertiaryPrompt(promptProfiles.tertiaryPrompt || "");
      setActivePromptSlot(promptProfiles.activeSlot || "primary");
    }
    if (settings && !configEdited) {
      setMaxTokens(settings.maxTokens || 120);
      setTemperature(settings.temperature || 70);
      const provider = settings.aiProvider === "gemini" ? "gemini" : "openai";
      setAiProvider(provider);
      setModel(settings.model || getDefaultModelForProvider(provider));
      setMaxPromptChars(settings.maxPromptChars || 2000);
      setConversationHistory(settings.conversationHistory || 3);
      setAudioResponseEnabled(settings.audioResponseEnabled || false);
      setAudioVoice(settings.audioVoice || "nova");
      setTtsProvider(settings.ttsProvider || "openai");
      setElevenlabsVoiceId(settings.elevenlabsVoiceId || "JBFqnCBsd6RMkjVDRZzb");
      setTtsSpeed(settings.ttsSpeed || 100);
      setTtsInstructions(settings.ttsInstructions || "");
      setFixedCommerceFlowEnabled(settings.learningMode !== true);
      setFollowUpEnabled(settings.followUpEnabled || false);
      setFollowUpMinutes(settings.followUpMinutes || 20);
    }
  }, [settings, promptProfiles, promptEdited, configEdited]);

  useEffect(() => {
    const validModels = new Set(modelOptions.map((option) => option.value));
    if (!validModels.has(model)) {
      setModel(getDefaultModelForProvider(aiProvider));
      setConfigEdited(true);
    }
  }, [aiProvider]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AiSettings>) => {
      return apiRequest("PATCH", "/api/ai/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "Configuración guardada" });
      setConfigEdited(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    },
  });

  const updatePromptProfilesMutation = useMutation({
    mutationFn: async (data: PromptProfiles) => {
      const response = await apiRequest("PATCH", "/api/ai/prompt-profiles", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/prompt-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "Prompts guardados" });
      setPromptEdited(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar prompts", description: error.message, variant: "destructive" });
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: Partial<Product>) => {
      return apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setNewName("");
      setNewKeywords("");
      setNewDescription("");
      setNewPrice("");
      setNewImageUrl("");
      setNewImageBottleUrl("");
      setNewImageDoseUrl("");
      setNewImageIngredientsUrl("");
      setUploadProgress({});
      setUploadingSlots({});
      toast({ title: "Producto agregado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al agregar producto", description: error.message, variant: "destructive" });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Product> }) => {
      return apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingId(null);
      toast({ title: "Producto actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar producto", description: error.message, variant: "destructive" });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Producto eliminado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar producto", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (enabled: boolean) => {
    updateSettingsMutation.mutate({ enabled });
  };

  const handleSavePrompt = () => {
    updatePromptProfilesMutation.mutate({
      primaryPrompt,
      secondaryPrompt,
      tertiaryPrompt,
      activeSlot: activePromptSlot,
    });
  };

  const handleSaveConfig = () => {
    console.log("Saving config:", { maxTokens, temperature, model, maxPromptChars, conversationHistory, fixedCommerceFlowEnabled });
    updateSettingsMutation.mutate({ aiProvider, maxTokens, temperature, model, maxPromptChars, conversationHistory, audioResponseEnabled, audioVoice, ttsProvider, elevenlabsVoiceId, ttsSpeed, ttsInstructions: ttsInstructions || null, learningMode: !fixedCommerceFlowEnabled, followUpEnabled, followUpMinutes });
  };

  const stopPreviewAudio = useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (previewAudioUrlRef.current) {
      URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = null;
    }
    previewAudioRef.current = null;
    setPreviewPlaying(false);
  }, []);

  const buildPreviewPayload = () => {
    const previewText = "Hola, esta es una prueba de voz para tu CRM.";
    if (ttsProvider === "elevenlabs") {
      return {
        provider: "elevenlabs",
        elevenlabsVoiceId,
        previewUrl: selectedElevenPreviewUrl,
        text: previewText,
      };
    }
    return {
      provider: "openai",
      voice: audioVoice,
      speed: ttsSpeed,
      instructions: ttsInstructions || null,
      text: previewText,
    };
  };

  useEffect(() => {
    let cancelled = false;
    const loadPreviewStatus = async () => {
      stopPreviewAudio();
      setPreviewStatusLoading(true);
      setPreviewMeta(null);
      try {
        const response = await fetch("/api/tts/preview-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(buildPreviewPayload()),
        });
        if (!response.ok) {
          throw new Error("No se pudo verificar la muestra");
        }
        const data = await response.json();
        if (cancelled) return;
        const saved = Boolean(data?.saved);
        const free = Boolean(data?.free);
        setPreviewMeta({ saved, free, cache: saved ? "hit" : "miss" });
      } catch {
        if (cancelled) return;
        setPreviewMeta({
          saved: false,
          free: ttsProvider === "elevenlabs" && Boolean(selectedElevenPreviewUrl),
          cache: "miss",
        });
      } finally {
        if (!cancelled) {
          setPreviewStatusLoading(false);
        }
      }
    };

    if (!audioResponseEnabled) {
      stopPreviewAudio();
      setPreviewMeta(null);
      setPreviewStatusLoading(false);
      return;
    }

    loadPreviewStatus();
    return () => {
      cancelled = true;
    };
  }, [ttsProvider, audioVoice, elevenlabsVoiceId, ttsSpeed, ttsInstructions, audioResponseEnabled, selectedElevenPreviewUrl, stopPreviewAudio]);

  const playVoicePreview = async () => {
    try {
      stopPreviewAudio();
      setPreviewPlaying(true);
      setPreviewStatusLoading(false);
      setPreviewMeta(null);
      const payload = buildPreviewPayload();

      const response = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = "No se pudo generar la muestra de voz";
        try {
          const errorData = await response.json();
          message = errorData.details || errorData.message || message;
        } catch {
          message = await response.text();
        }
        throw new Error(message);
      }

      const cacheHeader = response.headers.get("X-TTS-Cache");
      const freeHeader = response.headers.get("X-TTS-Preview-Free");
      const cacheStatus = cacheHeader === "hit" || cacheHeader === "miss" ? cacheHeader : null;
      const isFreePreview = freeHeader === "1";

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      previewAudioUrlRef.current = url;
      setPreviewMeta({ saved: true, free: isFreePreview, cache: cacheStatus });
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        if (previewAudioUrlRef.current) {
          URL.revokeObjectURL(previewAudioUrlRef.current);
          previewAudioUrlRef.current = null;
        }
        previewAudioRef.current = null;
        setPreviewPlaying(false);
      };
      audio.onerror = () => {
        if (previewAudioUrlRef.current) {
          URL.revokeObjectURL(previewAudioUrlRef.current);
          previewAudioUrlRef.current = null;
        }
        previewAudioRef.current = null;
        setPreviewPlaying(false);
        toast({ title: "Error", description: "No se pudo reproducir la muestra", variant: "destructive" });
      };
      await audio.play();
    } catch (error: any) {
      setPreviewPlaying(false);
      toast({
        title: "Error al generar muestra",
        description: error?.message || "No se pudo generar la muestra de voz",
        variant: "destructive",
      });
    }
  };

  const renderPreviewStatusBadges = () => {
    if (!previewStatusLoading && !previewMeta) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {previewStatusLoading && (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-slate-200">
            Verificando...
          </span>
        )}
        {!previewStatusLoading && previewMeta && (
          <>
            {previewMeta.saved ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200"
                title="Se guardó en la base de datos para reutilizar el audio"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Guardado en base
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-200"
                title="Aún no está guardado en la base de datos"
              >
                <XCircle className="h-3.5 w-3.5" />
                No guardado
              </span>
            )}
            {previewMeta.free && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-cyan-200"
                title="Este preview es gratis y no consume créditos"
              >
                Preview gratis
              </span>
            )}
            {previewMeta.cache === "hit" && previewMeta.saved && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-slate-200"
                title="Se reutilizó un audio previamente guardado"
              >
                Cache
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  const uploadProductImageWithProgress = (file: File, slotKey: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("image", file);
      const xhr = new XMLHttpRequest();

      setUploadingSlots((prev) => ({ ...prev, [slotKey]: true }));
      setUploadProgress((prev) => ({ ...prev, [slotKey]: 0 }));

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress((prev) => ({ ...prev, [slotKey]: percent }));
      };

      xhr.onerror = () => {
        setUploadingSlots((prev) => ({ ...prev, [slotKey]: false }));
        reject(new Error("No se pudo subir la imagen"));
      };

      xhr.onload = () => {
        setUploadingSlots((prev) => ({ ...prev, [slotKey]: false }));
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(xhr.responseText || "Error subiendo imagen"));
          return;
        }
        try {
          const parsed = JSON.parse(xhr.responseText) as { url?: string };
          if (!parsed.url) {
            reject(new Error("Respuesta de subida sin URL"));
            return;
          }
          setUploadProgress((prev) => ({ ...prev, [slotKey]: 100 }));
          resolve(parsed.url);
        } catch {
          reject(new Error("Respuesta invalida del servidor al subir imagen"));
        }
      };

      xhr.open("POST", "/api/products/upload-image");
      xhr.withCredentials = true;
      xhr.send(formData);
    });

  const handleSelectAndUploadProductImage = async (
    file: File | null,
    slotKey: string,
    setter: (url: string) => void
  ) => {
    if (!file) return;
    try {
      const uploadedUrl = await uploadProductImageWithProgress(file, slotKey);
      setter(uploadedUrl);
      toast({ title: "Imagen subida", description: uploadedUrl });
    } catch (error: any) {
      toast({
        title: "Error al subir imagen",
        description: error?.message || "No se pudo subir la imagen",
        variant: "destructive",
      });
    }
  };

  const resolveProductImageUrl = (rawUrl?: string | null) => {
    const value = (rawUrl || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) {
      if (typeof window !== "undefined") {
        return `${window.location.origin}${value}`;
      }
      return `https://ryzapp.org${value}`;
    }
    return value;
  };

  const renderImagePreview = (rawUrl: string, label: string, testId: string) => {
    const absoluteUrl = resolveProductImageUrl(rawUrl);
    if (!absoluteUrl) return null;
    return (
      <div className="rounded-md border border-slate-700/50 bg-slate-950/60 p-2 space-y-1" data-testid={testId}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-300">{label}</span>
          <a href={absoluteUrl} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-300 hover:text-cyan-200 underline">
            Abrir
          </a>
        </div>
        <img
          src={absoluteUrl}
          alt={label}
          className="h-16 w-16 rounded object-cover border border-slate-700/60 bg-slate-900"
          loading="lazy"
        />
        <p className="text-[10px] text-slate-400 break-all">{absoluteUrl}</p>
      </div>
    );
  };

  const handleAddProduct = () => {
    if (!newName.trim()) {
      toast({ title: "El nombre es requerido", variant: "destructive" });
      return;
    }
    createProductMutation.mutate({
      name: newName,
      keywords: newKeywords || null,
      description: newDescription || null,
      price: newPrice || null,
      imageUrl: newImageUrl || null,
      imageBottleUrl: newImageBottleUrl || null,
      imageDoseUrl: newImageDoseUrl || null,
      imageIngredientsUrl: newImageIngredientsUrl || null,
    });
  };

  const startEditing = (product: Product) => {
    setEditingId(product.id);
    setEditName(product.name);
    setEditKeywords(product.keywords || "");
    setEditDescription(product.description || "");
    setEditPrice(product.price || "");
    setEditImageUrl(product.imageUrl || "");
    setEditImageBottleUrl(product.imageBottleUrl || "");
    setEditImageDoseUrl(product.imageDoseUrl || "");
    setEditImageIngredientsUrl(product.imageIngredientsUrl || "");
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateProductMutation.mutate({
      id: editingId,
      data: {
        name: editName,
        keywords: editKeywords || null,
        description: editDescription || null,
        price: editPrice || null,
        imageUrl: editImageUrl || null,
        imageBottleUrl: editImageBottleUrl || null,
        imageDoseUrl: editImageDoseUrl || null,
        imageIngredientsUrl: editImageIngredientsUrl || null,
      },
    });
  };

  if (settingsLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Futuristic Header */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-slate-800/90 via-slate-800/80 to-slate-800/90 backdrop-blur-xl border-b border-emerald-500/20">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-cyan-500/5 to-emerald-500/5" />
        <div className="container mx-auto px-4 py-4 flex items-center gap-4 relative">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back" className="text-slate-400 hover:text-white hover:bg-slate-700/50">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Agente IA</h1>
              <p className="text-xs text-slate-400">Configuración inteligente</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className={`text-sm font-medium ${settings?.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
              {settings?.enabled ? "Activo" : "Inactivo"}
            </span>
            <Switch
              checked={settings?.enabled || false}
              onCheckedChange={handleToggle}
              disabled={updateSettingsMutation.isPending}
              data-testid="switch-ai-enabled"
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6 max-w-4xl pb-20">
        {/* Instructions Card - 3D Style */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 hover:shadow-2xl transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/5 to-transparent rounded-2xl" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Instrucciones del Agente</h3>
                <p className="text-xs text-slate-400">Define cómo debe comportarse (máx: {maxPromptChars} caracteres)</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="active-prompt-slot" className="text-slate-300">Prompt activo</Label>
                <Select
                  value={activePromptSlot}
                  onValueChange={(value: "primary" | "secondary" | "tertiary") => {
                    setActivePromptSlot(value);
                    setPromptEdited(true);
                  }}
                >
                  <SelectTrigger
                    id="active-prompt-slot"
                    className="bg-slate-900/50 border-slate-600/50 text-white"
                    data-testid="select-active-prompt-slot"
                  >
                    <SelectValue placeholder="Seleccione prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Prompt principal</SelectItem>
                    <SelectItem value="secondary">Prompt alternativo</SelectItem>
                    <SelectItem value="tertiary">Prompt Antigravity (Berberina 1.0)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">
                  El prompt activo es el que usa la IA ahora. El otro queda guardado para cuando quiera volver a usarlo.
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="primary-prompt" className="text-slate-300">Prompt principal</Label>
                    {activePromptSlot === "primary" && (
                      <span className="text-[11px] font-medium text-emerald-300">Activo ahora</span>
                    )}
                  </div>
                  <Textarea
                    id="primary-prompt"
                    placeholder="Ej: Eres Isabella, asistente de ventas amigable. Responde siempre en espanol. Si quieren comprar, pide ubicacion..."
                    value={primaryPrompt}
                    onChange={(e) => {
                      const newValue = e.target.value.slice(0, maxPromptChars);
                      setPrimaryPrompt(newValue);
                      setPromptEdited(true);
                    }}
                    rows={6}
                    data-testid="textarea-primary-prompt"
                    className="bg-slate-900/50 border-slate-600/50 text-white placeholder:text-slate-500"
                  />
                  <div className={`text-xs ${primaryPrompt.length >= maxPromptChars ? 'text-red-400' : 'text-slate-500'}`}>
                    {primaryPrompt.length} / {maxPromptChars} caracteres
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="secondary-prompt" className="text-slate-300">Prompt alternativo</Label>
                    {activePromptSlot === "secondary" && (
                      <span className="text-[11px] font-medium text-cyan-300">Activo ahora</span>
                    )}
                  </div>
                  <Textarea
                    id="secondary-prompt"
                    placeholder="Use este espacio para otro flujo, por ejemplo reclutamiento o filtros informativos."
                    value={secondaryPrompt}
                    onChange={(e) => {
                      const newValue = e.target.value.slice(0, maxPromptChars);
                      setSecondaryPrompt(newValue);
                      setPromptEdited(true);
                    }}
                    rows={6}
                    data-testid="textarea-secondary-prompt"
                    className="bg-slate-900/50 border-slate-600/50 text-white placeholder:text-slate-500"
                  />
                  <div className={`text-xs ${secondaryPrompt.length >= maxPromptChars ? 'text-red-400' : 'text-slate-500'}`}>
                    {secondaryPrompt.length} / {maxPromptChars} caracteres
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="tertiary-prompt" className="text-slate-300">Prompt Antigravity (Berberina 1.0)</Label>
                    {activePromptSlot === "tertiary" && (
                      <span className="text-[11px] font-medium text-violet-300">Activo ahora</span>
                    )}
                  </div>
                  <Textarea
                    id="tertiary-prompt"
                    placeholder="Escriba aquí el prompt conversacional y amigable para Berberina 1.0..."
                    value={tertiaryPrompt}
                    onChange={(e) => {
                      const newValue = e.target.value.slice(0, maxPromptChars);
                      setTertiaryPrompt(newValue);
                      setPromptEdited(true);
                    }}
                    rows={6}
                    data-testid="textarea-tertiary-prompt"
                    className="bg-slate-900/50 border-slate-600/50 text-white placeholder:text-slate-500"
                  />
                  <div className={`text-xs ${tertiaryPrompt.length >= maxPromptChars ? 'text-red-400' : 'text-slate-500'}`}>
                    {tertiaryPrompt.length} / {maxPromptChars} caracteres
                  </div>
                </div>
              </div>
            </div>
            {promptEdited && (
              <Button onClick={handleSavePrompt} disabled={updatePromptProfilesMutation.isPending} data-testid="button-save-prompt" className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white shadow-lg shadow-emerald-500/30">
                {updatePromptProfilesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar Prompts
              </Button>
            )}
          </div>
        </div>

        {/* Interactive Messages Guide */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-violet-500/5 to-transparent rounded-2xl" />
          <div className="relative space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Botones y Listas Interactivas</h3>
                <p className="text-xs text-slate-400">Usa estos formatos en las instrucciones para que el agente envíe botones o listas</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700/30">
                <p className="text-violet-400 font-medium mb-1">Botones de respuesta rápida (máx. 3)</p>
                <code className="text-xs text-slate-300 block bg-black/30 rounded p-2">
                  [BOTONES: Opción 1, Opción 2, Opción 3]
                </code>
                <p className="text-xs text-slate-400 mt-2">Ejemplo en instrucciones: <em className="text-slate-300">"Cuando el cliente pregunte por productos, responde: ¿Qué te interesa? [BOTONES: Ver catálogo, Ver precios, Hablar con asesor]"</em></p>
                <p className="text-xs text-yellow-400/80 mt-1">Máx. 20 caracteres por botón. El cliente toca y su respuesta llega al IA.</p>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700/30">
                <p className="text-violet-400 font-medium mb-1">Lista de opciones (máx. 10)</p>
                <code className="text-xs text-slate-300 block bg-black/30 rounded p-2">
                  [LISTA: Título del botón | Opción 1, Opción 2, Opción 3, ...]
                </code>
                <p className="text-xs text-slate-400 mt-2">Ejemplo en instrucciones: <em className="text-slate-300">"Cuando pregunten qué hay disponible, responde: Estos son nuestros productos: [LISTA: Ver productos | Creatina, Proteína, Vitaminas, Pre-entreno, BCAA]"</em></p>
                <p className="text-xs text-yellow-400/80 mt-1">El título del botón máx. 20 caracteres. Cada opción máx. 24 caracteres.</p>
              </div>
              <p className="text-xs text-slate-400">El texto antes de [BOTONES:] o [LISTA:] se envía como mensaje. Cuando el cliente elige una opción, el IA recibe el texto de la opción elegida y responde según tus instrucciones.</p>
            </div>
          </div>
        </div>

        {/* Model Config Card - 3D Style */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 hover:shadow-2xl transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/5 to-transparent rounded-2xl" />
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
                <RefreshCw className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Configuración del Modelo</h3>
                <p className="text-xs text-slate-400">Ajusta tokens, creatividad, modelo y contexto</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="maxTokens" className="text-slate-300">Máx. Tokens (respuesta)</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  min={50}
                  max={500}
                  value={maxTokens}
                  onChange={(e) => {
                    setMaxTokens(parseInt(e.target.value) || 120);
                    setConfigEdited(true);
                  }}
                  data-testid="input-max-tokens"
                  className="bg-slate-800/50 border-slate-600/50 text-white"
                />
                <p className="text-xs text-slate-500 mt-1">50-500. Más tokens = respuestas más largas</p>
              </div>
              <div>
                <Label htmlFor="temperature" className="text-slate-300">Temperatura (%)</Label>
                <Input
                  id="temperature"
                  type="number"
                  min={0}
                  max={100}
                  value={temperature}
                  onChange={(e) => {
                    setTemperature(parseInt(e.target.value) || 70);
                    setConfigEdited(true);
                  }}
                  data-testid="input-temperature"
                  className="bg-slate-800/50 border-slate-600/50 text-white"
                />
                <p className="text-xs text-slate-500 mt-1">0=preciso, 100=creativo</p>
              </div>
              <div>
                <Label className="text-slate-300">Proveedor de respuesta</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAiProvider("openai");
                      setConfigEdited(true);
                    }}
                    className={`rounded-xl border-2 p-3 text-left transition-all ${
                      aiProvider === "openai"
                        ? "border-emerald-500 bg-emerald-500/15 shadow-lg shadow-emerald-500/10"
                        : "border-slate-600/50 bg-slate-800/50 hover:border-emerald-500/40"
                    }`}
                    data-testid="provider-response-openai"
                  >
                    <div className="font-semibold text-sm text-white">OpenAI</div>
                    <div className="text-xs text-slate-400">Actual y estable</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiProvider("gemini");
                      setConfigEdited(true);
                    }}
                    className={`rounded-xl border-2 p-3 text-left transition-all ${
                      aiProvider === "gemini"
                        ? "border-cyan-500 bg-cyan-500/15 shadow-lg shadow-cyan-500/10"
                        : "border-slate-600/50 bg-slate-800/50 hover:border-cyan-500/40"
                    }`}
                    data-testid="provider-response-gemini"
                  >
                    <div className="font-semibold text-sm text-white">Gemini</div>
                    <div className="text-xs text-slate-400">Test con rollback rapido</div>
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">Solo cambia la IA que redacta. El audio sigue aparte.</p>
              </div>
              <div>
                <Label htmlFor="model" className="text-slate-300">Modelo</Label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setConfigEdited(true);
                  }}
                  className="w-full h-9 rounded-md border border-slate-600/50 bg-slate-800/50 px-3 text-sm text-white"
                  data-testid="select-model"
                >
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {aiProvider === "gemini" ? "Modelo de Gemini para testeo" : "Modelo de OpenAI a usar"}
                </p>
              </div>
              <div>
                <Label htmlFor="maxPromptChars" className="text-slate-300">Máx. Caracteres (instrucciones)</Label>
                <Input
                  id="maxPromptChars"
                  type="number"
                  min={500}
                  max={20000}
                  value={maxPromptChars}
                  onChange={(e) => {
                    setMaxPromptChars(parseInt(e.target.value) || 2000);
                    setConfigEdited(true);
                  }}
                  data-testid="input-max-prompt-chars"
                  className="bg-slate-800/50 border-slate-600/50 text-white"
                />
                <p className="text-xs text-slate-500 mt-1">500-20000. Límite de texto en instrucciones</p>
              </div>
              <div>
                <Label htmlFor="conversationHistory" className="text-slate-300">Mensajes de contexto</Label>
                <Input
                  id="conversationHistory"
                  type="number"
                  min={1}
                  max={20}
                  value={conversationHistory}
                  onChange={(e) => {
                    setConversationHistory(parseInt(e.target.value) || 3);
                    setConfigEdited(true);
                  }}
                  data-testid="input-conversation-history"
                  className="bg-slate-800/50 border-slate-600/50 text-white"
                />
                <p className="text-xs text-slate-500 mt-1">1-20. Cuántos mensajes previos lee la IA</p>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-4 border border-slate-700/50 rounded-xl bg-slate-800/30">
              <div className="space-y-1">
                <Label htmlFor="fixedCommerceFlow" className="text-slate-300">Usar Flujo Comercial Fijo</Label>
                <p className="text-xs text-slate-500">
                  Mantiene activos los menus y respuestas fijas de productos. Si lo apaga, la IA usa solo prompt y contexto.
                </p>
              </div>
              <Switch
                id="fixedCommerceFlow"
                checked={fixedCommerceFlowEnabled}
                onCheckedChange={(checked) => {
                  setFixedCommerceFlowEnabled(checked);
                  setConfigEdited(true);
                }}
                data-testid="switch-fixed-commerce-flow"
              />
            </div>

            <div className="flex items-center justify-between p-4 border border-slate-700/50 rounded-xl bg-slate-800/30">
              <div className="space-y-1">
                <Label htmlFor="audioResponse" className="text-slate-300">Responder con Audio</Label>
                <p className="text-xs text-slate-500">
                  Cuando el cliente envía un audio, la IA responde también con audio
                </p>
              </div>
              <Switch
                id="audioResponse"
                checked={audioResponseEnabled}
                onCheckedChange={(checked) => {
                  setAudioResponseEnabled(checked);
                  setConfigEdited(true);
                }}
                data-testid="switch-audio-response"
              />
            </div>
            
            {audioResponseEnabled && (
              <div className="space-y-3">
                <Label className="font-medium text-slate-300">Proveedor de Voz</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setTtsProvider("openai"); setConfigEdited(true); }}
                    className={`flex-1 p-3 rounded-xl border-2 text-center transition-all ${
                      ttsProvider === "openai"
                        ? "border-emerald-500 bg-emerald-500/20 shadow-lg shadow-emerald-500/20"
                        : "border-slate-600/50 bg-slate-800/50 hover:border-cyan-500/50"
                    }`}
                    data-testid="provider-openai"
                  >
                    <div className="font-semibold text-sm text-white">OpenAI</div>
                    <div className="text-xs text-slate-400">Voces básicas y realistas</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTtsProvider("elevenlabs"); setConfigEdited(true); }}
                    className={`flex-1 p-3 rounded-xl border-2 text-center transition-all ${
                      ttsProvider === "elevenlabs"
                        ? "border-violet-500 bg-violet-500/20 shadow-lg shadow-violet-500/20"
                        : "border-slate-600/50 bg-slate-800/50 hover:border-violet-500/50"
                    }`}
                    data-testid="provider-elevenlabs"
                  >
                    <div className="font-semibold text-sm text-white">ElevenLabs</div>
                    <div className="text-xs text-slate-400">Voces ultra-realistas</div>
                  </button>
                </div>

                                {ttsProvider === "openai" && (
                  <>
                    <Label className="font-medium text-slate-300">Voz de OpenAI</Label>
                    <p className="text-xs text-slate-500">Voces realistas usan modelo avanzado (mayor calidad y costo)</p>
                    <Input
                      type="text"
                      placeholder="Buscar voz OpenAI..."
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                      data-testid="input-search-voice-openai"
                    />
	                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
	                      {filteredOpenAiVoices.map((voice) => (
                        <button
                          key={voice.value}
                          type="button"
                          onClick={() => {
                            setAudioVoice(voice.value);
                            setConfigEdited(true);
                          }}
                          className={`p-3 rounded-xl border-2 text-left transition-all ${
                            audioVoice === voice.value
                              ? "border-emerald-500 bg-emerald-500/20 shadow-lg shadow-emerald-500/20"
                              : voice.realistic
                                ? "border-amber-500/30 bg-amber-500/10 hover:border-amber-500 hover:bg-amber-500/20"
                                : "border-slate-600/50 bg-slate-800/50 hover:border-cyan-500/50 hover:bg-slate-700/50"
                          }`}
                          data-testid={`voice-${voice.value}`}
                        >
                          <div className="font-semibold text-sm text-white">{voice.label}</div>
                          <div className={`text-xs ${voice.realistic ? "text-amber-400" : "text-slate-400"}`}>{voice.desc}</div>
                        </button>
	                      ))}
	                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={playVoicePreview}
                      disabled={previewPlaying}
                      className="border-emerald-500/40 hover:bg-emerald-500/10"
                      data-testid="button-preview-openai-voice"
                    >
                      {previewPlaying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Probar voz seleccionada
                    </Button>
                    {renderPreviewStatusBadges()}
                  </>
                )}

                {ttsProvider === "elevenlabs" && (
                  <>
                    <Label className="font-medium text-slate-300">Voz de ElevenLabs</Label>
                    <p className="text-xs text-slate-500">Selecciona una voz ultra-realista de tu cuenta ElevenLabs</p>
                    <Input
                      type="text"
                      placeholder="Buscar voz ElevenLabs..."
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                      data-testid="input-search-voice-elevenlabs"
                    />
                    {elVoicesError ? (
                      <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-center">
                        <p className="text-sm text-red-300">Error al cargar voces. Verifica tu conexión con ElevenLabs.</p>
                      </div>
                    ) : elVoicesLoading || elevenLabsVoices.length === 0 ? (
                      <div className="p-4 rounded-xl border border-violet-500/30 bg-violet-500/10 text-center">
                        <p className="text-sm text-violet-300">Cargando voces de ElevenLabs...</p>
                      </div>
                    ) : (
                      <>
	                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
	                        {filteredElevenLabsVoices.map((voice) => (
                          <button
                            key={voice.voice_id}
                            type="button"
                            onClick={() => {
                              setElevenlabsVoiceId(voice.voice_id);
                              setConfigEdited(true);
                            }}
                            className={`p-3 rounded-xl border-2 text-left transition-all ${
                              elevenlabsVoiceId === voice.voice_id
                                ? "border-violet-500 bg-violet-500/20 shadow-lg shadow-violet-500/20"
                                : voice.source === "shared"
                                  ? "border-pink-500/30 bg-pink-500/5 hover:border-pink-500/60"
                                  : "border-slate-600/50 bg-slate-800/50 hover:border-violet-500/50"
                            }`}
                            data-testid={`voice-el-${voice.voice_id}`}
                          >
                            <div className="font-semibold text-sm text-white flex items-center gap-1.5">
                              {voice.name}
                              {voice.source === "shared" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-400 font-normal">Latina</span>
                              )}
                            </div>
                            <div className="text-xs text-violet-400 truncate">{voice.labels?.description || voice.labels?.accent || voice.labels?.use_case || voice.category || "Custom"}</div>
                          </button>
	                        ))}
	                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={playVoicePreview}
                        disabled={previewPlaying}
                        className="border-violet-500/40 hover:bg-violet-500/10"
                        data-testid="button-preview-elevenlabs-voice"
                      >
                        {previewPlaying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Probar voz seleccionada
                      </Button>
                      {renderPreviewStatusBadges()}
                      </>
	                    )}
	                  </>
	                )}
                
                <div className="grid gap-4 sm:grid-cols-2 mt-4 pt-4 border-t border-slate-700/50">
                  {ttsProvider === "openai" && (
                    <div>
                      <Label htmlFor="ttsSpeed" className="text-slate-300">Velocidad de habla</Label>
                      <div className="flex items-center gap-3">
                        <Input
                          id="ttsSpeed"
                          type="range"
                          min={50}
                          max={200}
                          step={5}
                          value={ttsSpeed}
                          onChange={(e) => {
                            setTtsSpeed(parseInt(e.target.value));
                            setConfigEdited(true);
                          }}
                          className="flex-1 accent-emerald-500"
                          data-testid="input-tts-speed"
                        />
                        <span className="text-sm font-medium w-14 text-center text-emerald-400">{(ttsSpeed / 100).toFixed(2)}x</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">0.5x (lento) - 2.0x (rápido)</p>
                    </div>
                  )}
                  
                  {ttsProvider === "openai" && ["ash", "ballad", "sage", "verse", "marin", "cedar"].includes(audioVoice) && (
                    <div className="sm:col-span-2">
                      <Label htmlFor="ttsInstructions" className="text-slate-300">Instrucciones de tono (solo voces realistas)</Label>
                      <Textarea
                        id="ttsInstructions"
                        placeholder="Ej: Habla con entusiasmo y calidez, como un vendedor amable"
                        value={ttsInstructions}
                        onChange={(e) => {
                          setTtsInstructions(e.target.value);
                          setConfigEdited(true);
                        }}
                        rows={2}
                        className="mt-1 bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                        data-testid="textarea-tts-instructions"
                      />
                      <p className="text-xs text-slate-500 mt-1">Describe cómo quieres que suene la voz (tono, emoción, estilo)</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between p-4 border border-slate-700/50 rounded-xl bg-slate-800/30">
              <div className="space-y-1">
                <Label htmlFor="followUp" className="text-slate-300 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Re-enganche automático
                </Label>
                <p className="text-xs text-slate-500">
                  Si el cliente te dejó en visto, el AI le escribe para retomar la conversación
                </p>
              </div>
              <Switch
                id="followUp"
                checked={followUpEnabled}
                onCheckedChange={(checked) => {
                  setFollowUpEnabled(checked);
                  setConfigEdited(true);
                }}
                data-testid="switch-follow-up"
              />
            </div>

            {followUpEnabled && (
              <div className="space-y-2 p-4 border border-slate-700/50 rounded-xl bg-slate-800/30">
                <Label className="text-slate-300">Minutos de espera antes de re-enganchar</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={followUpMinutes}
                    onChange={(e) => {
                      setFollowUpMinutes(parseInt(e.target.value));
                      setConfigEdited(true);
                    }}
                    className="flex-1 accent-emerald-500"
                    data-testid="slider-follow-up-minutes"
                  />
                  <span className="text-emerald-400 font-bold min-w-[4rem] text-center">{followUpMinutes} min</span>
                </div>
                <p className="text-xs text-slate-500">Máximo 1 re-enganche por conversación. Solo dentro de las 72h de Meta.</p>
              </div>
            )}

            {configEdited && (
              <Button onClick={handleSaveConfig} disabled={updateSettingsMutation.isPending} data-testid="button-save-config" className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white shadow-lg shadow-cyan-500/30">
                {updateSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar Configuración
              </Button>
            )}
          </div>
        </div>

        {/* Products Card - 3D Style */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 hover:shadow-2xl transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-violet-500/5 to-transparent rounded-2xl" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Package className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Productos</h3>
                <p className="text-xs text-slate-400">La IA buscará solo el producto que mencione el cliente</p>
              </div>
            </div>
            <div className="grid gap-3 p-4 border border-slate-700/50 rounded-xl bg-slate-900/50">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-slate-300">Nombre *</Label>
                  <Input
                    placeholder="Ej: Berberina"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    data-testid="input-product-name"
                    className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Precio</Label>
                  <Input
                    placeholder="Ej: 280 Bs"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    data-testid="input-product-price"
                    className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <Label className="text-slate-300">Palabras clave (separadas por coma)</Label>
                <Input
                  placeholder="Ej: glucosa, azúcar, diabetes"
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  data-testid="input-product-keywords"
                  className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                />
              </div>
              <div>
                <Label className="text-slate-300">Descripción</Label>
                <Textarea
                  placeholder="Beneficios, dosis, instrucciones..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  data-testid="textarea-product-description"
                  className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-slate-300">Imagenes del producto (con % de carga)</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Input
                      placeholder="URL imagen principal"
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                      data-testid="input-product-image-main"
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                    />
                    {renderImagePreview(newImageUrl, "Imagen principal", "preview-product-image-main")}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, "principal", setNewImageUrl)}
                      data-testid="input-product-image-main-file"
                      className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                    />
                    {uploadingSlots.principal && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress.principal || 0} className="h-2" />
                        <p className="text-xs text-slate-400">{uploadProgress.principal || 0}%</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      placeholder="URL imagen frasco"
                      value={newImageBottleUrl}
                      onChange={(e) => setNewImageBottleUrl(e.target.value)}
                      data-testid="input-product-image-bottle"
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                    />
                    {renderImagePreview(newImageBottleUrl, "Imagen frasco", "preview-product-image-bottle")}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, "frasco", setNewImageBottleUrl)}
                      data-testid="input-product-image-bottle-file"
                      className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                    />
                    {uploadingSlots.frasco && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress.frasco || 0} className="h-2" />
                        <p className="text-xs text-slate-400">{uploadProgress.frasco || 0}%</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      placeholder="URL imagen dosis"
                      value={newImageDoseUrl}
                      onChange={(e) => setNewImageDoseUrl(e.target.value)}
                      data-testid="input-product-image-dose"
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                    />
                    {renderImagePreview(newImageDoseUrl, "Imagen dosis", "preview-product-image-dose")}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, "dosis", setNewImageDoseUrl)}
                      data-testid="input-product-image-dose-file"
                      className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                    />
                    {uploadingSlots.dosis && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress.dosis || 0} className="h-2" />
                        <p className="text-xs text-slate-400">{uploadProgress.dosis || 0}%</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      placeholder="URL imagen ingredientes"
                      value={newImageIngredientsUrl}
                      onChange={(e) => setNewImageIngredientsUrl(e.target.value)}
                      data-testid="input-product-image-ingredients"
                      className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                    />
                    {renderImagePreview(newImageIngredientsUrl, "Imagen ingredientes", "preview-product-image-ingredients")}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, "ingredientes", setNewImageIngredientsUrl)}
                      data-testid="input-product-image-ingredients-file"
                      className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                    />
                    {uploadingSlots.ingredientes && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress.ingredientes || 0} className="h-2" />
                        <p className="text-xs text-slate-400">{uploadProgress.ingredientes || 0}%</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <Button onClick={handleAddProduct} disabled={createProductMutation.isPending} data-testid="button-add-product" className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white shadow-lg shadow-emerald-500/30">
                {createProductMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Agregar Producto
              </Button>
            </div>

            {productsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : products.length > 0 ? (
              <div className="border rounded-md divide-y">
                {products.map((product) => (
                  <div key={product.id} className="p-3" data-testid={`product-item-${product.id}`}>
                    {editingId === product.id ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            placeholder="Nombre"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            data-testid={`input-edit-name-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                          <Input
                            placeholder="Precio"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            data-testid={`input-edit-price-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                        </div>
                        <Input
                          placeholder="Palabras clave"
                          value={editKeywords}
                          onChange={(e) => setEditKeywords(e.target.value)}
                          data-testid={`input-edit-keywords-${product.id}`}
                          className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                        />
                        <Textarea
                          placeholder="Descripción"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          data-testid={`textarea-edit-description-${product.id}`}
                          className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            placeholder="URL imagen principal"
                            value={editImageUrl}
                            onChange={(e) => setEditImageUrl(e.target.value)}
                            data-testid={`input-edit-image-main-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                          {renderImagePreview(editImageUrl, "Imagen principal", `preview-edit-image-main-${product.id}`)}
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, `edit-principal-${product.id}`, setEditImageUrl)}
                            data-testid={`input-edit-image-main-file-${product.id}`}
                            className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                          />
                          {(uploadingSlots[`edit-principal-${product.id}`] || false) && (
                            <div className="sm:col-span-2 space-y-1">
                              <Progress value={uploadProgress[`edit-principal-${product.id}`] || 0} className="h-2" />
                              <p className="text-xs text-slate-500">{uploadProgress[`edit-principal-${product.id}`] || 0}%</p>
                            </div>
                          )}
                          <Input
                            placeholder="URL imagen frasco"
                            value={editImageBottleUrl}
                            onChange={(e) => setEditImageBottleUrl(e.target.value)}
                            data-testid={`input-edit-image-bottle-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                          {renderImagePreview(editImageBottleUrl, "Imagen frasco", `preview-edit-image-bottle-${product.id}`)}
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, `edit-frasco-${product.id}`, setEditImageBottleUrl)}
                            data-testid={`input-edit-image-bottle-file-${product.id}`}
                            className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                          />
                          {(uploadingSlots[`edit-frasco-${product.id}`] || false) && (
                            <div className="sm:col-span-2 space-y-1">
                              <Progress value={uploadProgress[`edit-frasco-${product.id}`] || 0} className="h-2" />
                              <p className="text-xs text-slate-500">{uploadProgress[`edit-frasco-${product.id}`] || 0}%</p>
                            </div>
                          )}
                          <Input
                            placeholder="URL imagen dosis"
                            value={editImageDoseUrl}
                            onChange={(e) => setEditImageDoseUrl(e.target.value)}
                            data-testid={`input-edit-image-dose-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                          {renderImagePreview(editImageDoseUrl, "Imagen dosis", `preview-edit-image-dose-${product.id}`)}
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, `edit-dosis-${product.id}`, setEditImageDoseUrl)}
                            data-testid={`input-edit-image-dose-file-${product.id}`}
                            className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                          />
                          {(uploadingSlots[`edit-dosis-${product.id}`] || false) && (
                            <div className="sm:col-span-2 space-y-1">
                              <Progress value={uploadProgress[`edit-dosis-${product.id}`] || 0} className="h-2" />
                              <p className="text-xs text-slate-500">{uploadProgress[`edit-dosis-${product.id}`] || 0}%</p>
                            </div>
                          )}
                          <Input
                            placeholder="URL imagen ingredientes"
                            value={editImageIngredientsUrl}
                            onChange={(e) => setEditImageIngredientsUrl(e.target.value)}
                            data-testid={`input-edit-image-ingredients-${product.id}`}
                            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
                          />
                          {renderImagePreview(editImageIngredientsUrl, "Imagen ingredientes", `preview-edit-image-ingredients-${product.id}`)}
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleSelectAndUploadProductImage(e.target.files?.[0] || null, `edit-ingredientes-${product.id}`, setEditImageIngredientsUrl)}
                            data-testid={`input-edit-image-ingredients-file-${product.id}`}
                            className="bg-slate-900/80 text-slate-100 border-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-600"
                          />
                          {(uploadingSlots[`edit-ingredientes-${product.id}`] || false) && (
                            <div className="sm:col-span-2 space-y-1">
                              <Progress value={uploadProgress[`edit-ingredientes-${product.id}`] || 0} className="h-2" />
                              <p className="text-xs text-slate-500">{uploadProgress[`edit-ingredientes-${product.id}`] || 0}%</p>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveEdit} disabled={updateProductMutation.isPending}>
                            {updateProductMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                            Guardar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            <X className="h-4 w-4 mr-1" /> Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{product.name}</span>
                            {product.price && (
                              <span className="text-sm bg-primary/10 text-primary px-2 py-0.5 rounded">
                                {product.price}
                              </span>
                            )}
                          </div>
                          {product.keywords && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Palabras clave: {product.keywords}
                            </p>
                          )}
                          {product.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {product.description}
                            </p>
                          )}
                          {(product.imageUrl || product.imageBottleUrl || product.imageDoseUrl || product.imageIngredientsUrl) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Imagenes: {[
                                product.imageUrl ? "principal" : null,
                                product.imageBottleUrl ? "frasco" : null,
                                product.imageDoseUrl ? "dosis" : null,
                                product.imageIngredientsUrl ? "ingredientes" : null,
                              ].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditing(product)}
                            data-testid={`button-edit-product-${product.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteProductMutation.mutate(product.id)}
                            disabled={deleteProductMutation.isPending}
                            data-testid={`button-delete-product-${product.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay productos. Agrega tu primer producto arriba.
              </p>
            )}
          </div>
        </div>

        {/* Learned Rules Card - 3D Style */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 hover:shadow-2xl transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-amber-500/5 to-transparent rounded-2xl" />
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Reglas Aprendidas</h3>
                <p className="text-xs text-slate-400">El agente usa estas reglas en sus respuestas</p>
              </div>
            </div>
            {rulesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : learnedRules.length > 0 ? (
              <div className="space-y-3">
                {learnedRules.map((rule) => (
                  <div 
                    key={rule.id} 
                    className={`p-3 border rounded-md ${!rule.isActive ? 'opacity-50' : ''}`}
                    data-testid={`learned-rule-${rule.id}`}
                  >
                    {editingRuleId === rule.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editRuleText}
                          onChange={(e) => setEditRuleText(e.target.value)}
                          rows={2}
                          data-testid="textarea-edit-rule"
                        />
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            onClick={() => updateRuleMutation.mutate({ id: rule.id, rule: editRuleText })}
                            data-testid="button-save-rule-edit"
                          >
                            <Check className="h-3 w-3 mr-1" /> Guardar
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => setEditingRuleId(null)}
                            data-testid="button-cancel-rule-edit"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm mb-2">{rule.rule}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {rule.learnedFrom || "General"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(rule.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={(checked) => updateRuleMutation.mutate({ id: rule.id, isActive: checked })}
                              data-testid={`switch-rule-active-${rule.id}`}
                            />
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => {
                                setEditingRuleId(rule.id);
                                setEditRuleText(rule.rule);
                              }}
                              data-testid={`button-edit-rule-${rule.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => deleteRuleMutation.mutate(rule.id)}
                              data-testid={`button-delete-rule-${rule.id}`}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                No hay reglas aprendidas aún. Usa el botón de bombilla en el chat para analizar conversaciones.
              </p>
            )}
          </div>
        </div>

        {/* Logs Card - 3D Style */}
        <div className="group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 shadow-xl shadow-black/20 hover:shadow-2xl transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-slate-500/5 to-transparent rounded-2xl" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-slate-500/10 rounded-full blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
                  <RefreshCw className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Logs de IA</h3>
                  <p className="text-xs text-slate-400">Historial de respuestas del agente</p>
                </div>
              </div>
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] })}
                data-testid="button-refresh-logs"
                className="border-slate-600 hover:bg-slate-700/50"
            >
              <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {logsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : logs.length > 0 ? (
              <div className="border border-slate-700/50 rounded-xl divide-y divide-slate-700/50 max-h-80 overflow-y-auto bg-slate-900/50">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 text-sm" data-testid={`log-item-${log.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {log.success ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-xs text-slate-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                      {log.tokensUsed !== null && log.tokensUsed !== undefined && (
                        <span className="text-xs bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-300">
                          {log.tokensUsed} tokens
                        </span>
                      )}
                    </div>
                    <div className="pl-6 space-y-1">
                      <p><span className="font-medium">Usuario:</span> {log.userMessage || "-"}</p>
                      {log.success ? (
                        <p><span className="font-medium">IA:</span> {log.aiResponse?.substring(0, 150)}{(log.aiResponse?.length || 0) > 150 ? "..." : ""}</p>
                      ) : (
                        <p className="text-destructive"><span className="font-medium">Error:</span> {log.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                No hay logs aún
              </p>
            )}
          </div>

          {/* Push Notification Controls */}
          <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-xl p-5 shadow-xl">
            <div className="mb-4">
              <h3 className="font-semibold text-white">Notificaciones por Columna</h3>
              <p className="text-xs text-slate-400">Activa o desactiva push para Nuevos y Esperando confirmacion</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-white">Nuevos</p>
                  <p className="text-xs text-slate-400">Push cuando entra mensaje nuevo</p>
                </div>
                <Switch
                  checked={pushSettings?.notifyNewMessages ?? true}
                  onCheckedChange={(checked) => updatePushSettingsMutation.mutate({ notifyNewMessages: checked })}
                  disabled={updatePushSettingsMutation.isPending}
                  data-testid="switch-push-new-messages"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-white">Esperando confirmacion</p>
                  <p className="text-xs text-slate-400">Push cuando pasa a Proceso/Pending</p>
                </div>
                <Switch
                  checked={pushSettings?.notifyPending ?? true}
                  onCheckedChange={(checked) => updatePushSettingsMutation.mutate({ notifyPending: checked })}
                  disabled={updatePushSettingsMutation.isPending}
                  data-testid="switch-push-pending"
                />
              </div>
            </div>
          </div>

          {/* Push Notification Logs */}
          <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Logs de Notificaciones Push</h3>
                <p className="text-xs text-slate-400">Solo: atención humana, pedido listo, llamar</p>
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => refetchPushLogs()}
                data-testid="button-refresh-push-logs"
                className="border-slate-600 hover:bg-slate-700/50"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {pushLogsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : pushLogs.length > 0 ? (
              <div className="border border-slate-700/50 rounded-xl divide-y divide-slate-700/50 max-h-60 overflow-y-auto bg-slate-900/50">
                {pushLogs.map((log, idx) => (
                  <div key={idx} className="p-3 text-sm" data-testid={`push-log-${idx}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {log.success ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-xs text-slate-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        log.event === 'human_attention' ? 'bg-orange-500/20 text-orange-400' :
                        log.event === 'order_ready' ? 'bg-emerald-500/20 text-emerald-400' :
                        log.event === 'should_call' ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-slate-600/50 text-slate-300'
                      }`}>
                        {log.event === 'human_attention' ? 'Atención Humana' :
                         log.event === 'order_ready' ? 'Pedido Listo' :
                         log.event === 'should_call' ? 'Llamar' : log.event}
                      </span>
                    </div>
                    <div className="pl-6 space-y-1">
                      <p className="text-slate-300"><span className="font-medium text-white">{log.title}:</span> {log.message}</p>
                      {!log.success && log.error && (
                        <p className="text-red-400 text-xs">Error: {log.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                No hay logs de push aún. Se generarán cuando haya eventos de atención humana, pedidos listos, o llamadas.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
