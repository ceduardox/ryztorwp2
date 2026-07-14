import { useState, useRef, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSendMessage } from "@/hooks/use-inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Send, Image as ImageIcon, Mic, Plus, Check, CheckCheck, MapPin, Bug, Copy, ExternalLink, X, Zap, Tag, Trash2, Package, PackageCheck, Truck, PackageX, Bot, BotOff, AlertCircle, Phone, Lightbulb, Loader2, UserRoundCog, Clock, Pencil, FileText, Video } from "lucide-react";
import type { Conversation, Message, Label, QuickMessage, Agent } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

interface ChatAreaProps {
  conversation: Conversation;
  messages: Message[];
  onClose?: () => void;
}

const FAILED_MEDIA_STORAGE_KEY = "ryzapp_failed_media_ids_v1";

const readFailedMediaIdsFromSession = (): Record<string, true> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(FAILED_MEDIA_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, true>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeFailedMediaIdsToSession = (failed: Record<string, true>) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(FAILED_MEDIA_STORAGE_KEY, JSON.stringify(failed));
  } catch {
    // ignore storage quota/private mode errors
  }
};

const LABEL_COLORS = [
  { name: "blue", bg: "bg-blue-500", text: "text-white" },
  { name: "green", bg: "bg-green-500", text: "text-white" },
  { name: "yellow", bg: "bg-yellow-500", text: "text-black" },
  { name: "red", bg: "bg-red-500", text: "text-white" },
  { name: "purple", bg: "bg-purple-500", text: "text-white" },
  { name: "orange", bg: "bg-orange-500", text: "text-white" },
];

const recordingWaveCss = `
.recording-wave-bar {
  width: 3px;
  min-height: 4px;
  border-radius: 9999px;
  background: rgb(239 68 68);
  transition: height 90ms ease-out, opacity 90ms ease-out;
}

@keyframes wa-heart-beat {
  0% { transform: scale(1); }
  14% { transform: scale(1.25); }
  28% { transform: scale(1); }
  42% { transform: scale(1.25); }
  70% { transform: scale(1); }
}
.animate-wa-heart-beat {
  animation: wa-heart-beat 1.3s infinite ease-in-out;
  display: inline-block;
  transform-origin: center;
}

@keyframes wa-emoji-float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-5px) scale(1.06); }
}
.animate-wa-emoji-float {
  animation: wa-emoji-float 2s infinite ease-in-out;
  display: inline-block;
  transform-origin: center;
}
`;

const QUICK_EMOJIS = [
  "😊", "😂", "😍", "❤️", "👍",
  "🙏", "🔥", "✨", "✅", "🎉",
  "😎", "🤝", "💪", "🤔", "😉",
  "😘", "🥰", "🙌", "📩", "🚀",
  "👋", "👌", "🤩", "🥳", "😄",
  "😃", "🤗", "👏", "💜", "💌",
  "💡", "📌", "🎈", "😇", "🌻",
  "💖", "🧴", "💧", "🌱", "🌸",
  "💬", "📞", "📦", "🚚", "💵",
  "💳", "🎯", "💯", "☀️", "⭐"
];

function getSingleEmojiType(text: string): "heart" | "emoji" | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const emojiRegex = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/;
  if (!emojiRegex.test(trimmed)) return null;

  try {
    const segmenter = (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" }) : null;
    if (segmenter) {
      const segments = Array.from(segmenter.segment(trimmed));
      if (segments.length !== 1) return null;
    } else {
      if (Array.from(trimmed).length > 2) return null;
    }
  } catch {
    if (Array.from(trimmed).length > 2) return null;
  }

  if (trimmed.includes("❤️") || trimmed.includes("💖") || trimmed.includes("💗") || trimmed.includes("💓") || trimmed.includes("❣") || trimmed.includes("💕")) {
    return "heart";
  }
  return "emoji";
}

export function ChatArea({ conversation, messages, onClose }: ChatAreaProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canToggleConversationAi = user?.role === "admin" || user?.role === "agent";
  const [hasTextDraft, setHasTextDraft] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [showImageInput, setShowImageInput] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("blue");
  const [showLabelManagerDialog, setShowLabelManagerDialog] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editingLabelName, setEditingLabelName] = useState("");
  const [editingLabelColor, setEditingLabelColor] = useState("blue");
  const [newQmName, setNewQmName] = useState("");
  const [newQmText, setNewQmText] = useState("");
  const [newQmImageUrl, setNewQmImageUrl] = useState("");
  const [showQuickMessageDialog, setShowQuickMessageDialog] = useState(false);
  const [editingQuickMessageId, setEditingQuickMessageId] = useState<number | null>(null);
  const [showReminderDialog, setShowReminderDialog] = useState(false);
  const [reminderAtInput, setReminderAtInput] = useState("");
  const [reminderNoteInput, setReminderNoteInput] = useState("");
  const [showLearnModal, setShowLearnModal] = useState(false);
  const [learnFocus, setLearnFocus] = useState("");
  const [learnMessageCount, setLearnMessageCount] = useState(10);
  const [suggestedRule, setSuggestedRule] = useState("");
  const [learnHistoryId, setLearnHistoryId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<"image" | "audio" | "video" | "document" | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBars, setRecordingBars] = useState<number[]>(() => Array.from({ length: 8 }, () => 0.12));
  const [failedMediaIds, setFailedMediaIds] = useState<Record<string, true>>(() => readFailedMediaIdsFromSession());
  const [ogImageByUrl, setOgImageByUrl] = useState<Record<string, string>>({});
  const [ogImageUnavailableByUrl, setOgImageUnavailableByUrl] = useState<Record<string, true>>({});
  const [longPressActiveMessageId, setLongPressActiveMessageId] = useState<number | null>(null);
  const [longPressPressingMessageId, setLongPressPressingMessageId] = useState<number | null>(null);
  const [copyPressedMessageId, setCopyPressedMessageId] = useState<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [editingOriginalText, setEditingOriginalText] = useState("");
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMovedRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const quickMessageImageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const meterDataRef = useRef<Uint8Array | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const meterLastUpdateRef = useRef<number>(0);
  const ogPreviewInFlightRef = useRef<Set<string>>(new Set());
  const { mutate: sendMessage, isPending } = useSendMessage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadImageMutation = useMutation({
    mutationFn: async ({ file, to, caption }: { file: File; to: string; caption?: string }) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("to", to);
      if (caption) formData.append("caption", caption);
      const res = await fetch("/api/send-image", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Error"); }
      return res.json();
    },
    onSuccess: () => {
      setComposerText("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setFilePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Imagen enviada" });
    },
    onError: (err: any) => {
      toast({ title: "Error al enviar imagen", description: err.message, variant: "destructive" });
    },
  });

  const uploadVideoMutation = useMutation({
    mutationFn: async ({ file, to, caption }: { file: File; to: string; caption?: string }) => {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("to", to);
      if (caption) formData.append("caption", caption);
      const res = await fetch("/api/send-video", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || "Error");
      }
      return res.json();
    },
    onSuccess: () => {
      setComposerText("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setFilePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Video enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Error al enviar video", description: err.message, variant: "destructive" });
    },
  });

  const uploadAudioMutation = useMutation({
    mutationFn: async ({ file, to }: { file: File; to: string }) => {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("to", to);
      const res = await fetch("/api/send-audio", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const raw = await res.text();
        let err: any = {};
        try {
          err = raw ? JSON.parse(raw) : {};
        } catch {
          err = {};
        }
        const details = err?.error ? `: ${err.error}` : "";
        const message = err?.message || raw || `HTTP ${res.status}`;
        throw new Error(`${message}${details}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setComposerText("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setFilePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Audio enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Error al enviar audio", description: err.message, variant: "destructive" });
    },
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ file, to, caption }: { file: File; to: string; caption?: string }) => {
      const formData = new FormData();
      formData.append("document", file);
      formData.append("to", to);
      if (caption) formData.append("caption", caption);
      const res = await fetch("/api/send-document", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Error");
      }
      return res.json();
    },
    onSuccess: () => {
      setComposerText("");
      setSelectedFile(null);
      setSelectedFileType(null);
      setFilePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Documento enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Error al enviar documento", description: err.message, variant: "destructive" });
    },
  });

  const { data: labelsData = [] } = useQuery<Label[]>({
    queryKey: ["/api/labels"],
  });
  const ownedLabels = useMemo(
    () =>
      labelsData.filter((label) =>
        user?.role === "agent" ? label.agentId === user.agentId : !label.agentId
      ),
    [labelsData, user?.role, user?.agentId],
  );

  const { data: quickMessagesData = [] } = useQuery<QuickMessage[]>({
    queryKey: ["/api/quick-messages"],
  });

  const { data: agentsData = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: isAdmin,
  });

  const currentLabelIds = [conversation.labelId, conversation.labelId2].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  const currentLabels = currentLabelIds
    .map((labelId) => labelsData.find((label) => label.id === labelId))
    .filter((label): label is Label => Boolean(label));
  const toDateTimeLocalValue = (value?: string | Date | null) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const tzOffset = parsed.getTimezoneOffset() * 60_000;
    return new Date(parsed.getTime() - tzOffset).toISOString().slice(0, 16);
  };
  const reminderDate = conversation.reminderAt ? new Date(conversation.reminderAt) : null;
  const reminderBadgeText = reminderDate && !Number.isNaN(reminderDate.getTime())
    ? format(reminderDate, "dd/MM HH:mm")
    : "";
  const toCompactLabel = (value: string, max = 8) => {
    const trimmed = value.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}..` : trimmed;
  };

  const showFullLabelName = (fullName: string) => {
    toast({ title: fullName, duration: 1800 });
  };

  const openReminderEditor = () => {
    setReminderAtInput(toDateTimeLocalValue(conversation.reminderAt));
    setReminderNoteInput(conversation.reminderNote || "");
    setShowReminderDialog(true);
  };

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!showReminderDialog) {
      setReminderAtInput(toDateTimeLocalValue(conversation.reminderAt));
      setReminderNoteInput(conversation.reminderNote || "");
    }
  }, [conversation.id, conversation.reminderAt, conversation.reminderNote, showReminderDialog]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      stopAudioMeter();
      if (filePreview) {
        URL.revokeObjectURL(filePreview);
      }
    };
  }, [filePreview]);

  const resizeMessageInput = () => {
    const textarea = messageInputRef.current;
    if (!textarea) return;
    const maxHeight = window.innerWidth < 768 ? 200 : 140;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  const getComposerText = () => messageInputRef.current?.value || "";

  const setComposerText = (value: string) => {
    const textarea = messageInputRef.current;
    if (!textarea) return;
    textarea.value = value;
    setHasTextDraft(Boolean(value.trim()));
    requestAnimationFrame(() => resizeMessageInput());
  };

  const insertEmoji = (emoji: string) => {
    const textarea = messageInputRef.current;
    if (!textarea) return;

    const current = textarea.value || "";
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const nextValue = `${current.slice(0, start)}${emoji}${current.slice(end)}`;

    setComposerText(nextValue);
    setShowEmojiPicker(false);

    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (!el) return;
      el.focus();
      const cursor = start + emoji.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  useEffect(() => {
    setComposerText("");
    setEditingMessageId(null);
    setEditingMessageText("");
    setEditingOriginalText("");
    setLongPressActiveMessageId(null);
    setLongPressPressingMessageId(null);
    requestAnimationFrame(() => resizeMessageInput());
  }, [conversation.id]);

  const markMediaAsFailed = (mediaId?: string | null) => {
    if (!mediaId) return;
    setFailedMediaIds((prev) => {
      if (prev[mediaId]) return prev;
      const next: Record<string, true> = { ...prev, [mediaId]: true };
      writeFailedMediaIdsToSession(next);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const urlsToResolve = Array.from(
      new Set(
        messages
          .map((msg) => {
            const raw = msg.rawJson as any;
            const referral = raw?.referral || raw?.context?.referral;
            if (!referral) return "";
            const hasDirectImage = Boolean(
              referral.image_url ||
              referral.imageUrl ||
              referral.thumbnail_url ||
              referral.thumbnailUrl
            );
            if (hasDirectImage) return "";
            const sourceUrl = String(referral.source_url || referral.sourceUrl || "").trim();
            if (!sourceUrl) return "";
            try {
              return new URL(sourceUrl).toString();
            } catch {
              return sourceUrl;
            }
          })
          .filter(Boolean)
      )
    );

    for (const url of urlsToResolve) {
      if (ogImageByUrl[url] || ogImageUnavailableByUrl[url] || ogPreviewInFlightRef.current.has(url)) {
        continue;
      }
      ogPreviewInFlightRef.current.add(url);
      fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw new Error("preview request failed");
          return response.json();
        })
        .then((payload) => {
          if (cancelled) return;
          const imageUrl = typeof payload?.imageUrl === "string" ? payload.imageUrl.trim() : "";
          if (imageUrl) {
            setOgImageByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: imageUrl }));
            return;
          }
          setOgImageUnavailableByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
        })
        .catch(() => {
          if (cancelled) return;
          setOgImageUnavailableByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
        })
        .finally(() => {
          ogPreviewInFlightRef.current.delete(url);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [messages, ogImageByUrl, ogImageUnavailableByUrl]);

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const getRecordingMimeType = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return "";
  };

  const stopRecordingStream = () => {
    if (!recordingStreamRef.current) return;
    recordingStreamRef.current.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const stopAudioMeter = () => {
    if (meterFrameRef.current !== null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    analyserNodeRef.current = null;
    meterDataRef.current = null;
    meterLastUpdateRef.current = 0;
    const currentContext = audioContextRef.current;
    audioContextRef.current = null;
    if (currentContext && currentContext.state !== "closed") {
      void currentContext.close().catch(() => {});
    }
  };

  const startRecording = async () => {
    if (isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "No compatible", description: "Tu navegador no permite grabar audio", variant: "destructive" });
      return;
    }
    const mimeType = getRecordingMimeType();
    if (!mimeType) {
      audioInputRef.current?.click();
      toast({
        title: "Grabacion directa no disponible",
        description: "Se abrio selector de audio del telefono. Graba/sube en MP3 o M4A.",
      });
      return;
    }

    try {
      if (filePreview) {
        URL.revokeObjectURL(filePreview);
      }
      setSelectedFile(null);
      setSelectedFileType(null);
      setFilePreview(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const options: MediaRecorderOptions = { audioBitsPerSecond: 24000 };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      setRecordingSeconds(0);
      setRecordingBars(Array.from({ length: 8 }, () => 0.12));
      setIsRecording(true);

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          stopAudioMeter();
          const audioContext: AudioContext = new AudioCtx();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.85;
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);

          audioContextRef.current = audioContext;
          analyserNodeRef.current = analyser;
          meterDataRef.current = new Uint8Array(analyser.fftSize);

          const updateMeter = (now: number) => {
            const activeAnalyser = analyserNodeRef.current;
            const data = meterDataRef.current;
            if (!activeAnalyser || !data) return;

            activeAnalyser.getByteTimeDomainData(data);
            let sumSquares = 0;
            for (let i = 0; i < data.length; i++) {
              const centered = (data[i] - 128) / 128;
              sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / data.length);
            const normalized = Math.max(0.05, Math.min(1, rms * 3.2));

            if (now - meterLastUpdateRef.current > 70) {
              meterLastUpdateRef.current = now;
              setRecordingBars((prev) => {
                const next = prev.slice(1);
                next.push(normalized);
                return next;
              });
            }

            meterFrameRef.current = window.requestAnimationFrame(updateMeter);
          };

          meterFrameRef.current = window.requestAnimationFrame(updateMeter);
        } catch {
          // Si falla el medidor, mantenemos la grabacion.
        }
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setIsRecording(false);
        stopRecordingStream();
        stopAudioMeter();
        toast({ title: "Error", description: "No se pudo grabar el audio", variant: "destructive" });
      };

      recorder.onstop = () => {
        const finalMimeType = (recorder.mimeType || mimeType || "audio/ogg").toLowerCase();
        const blob = new Blob(recordingChunksRef.current, { type: finalMimeType });
        recordingChunksRef.current = [];
        setIsRecording(false);
        stopRecordingStream();
        stopAudioMeter();

        if (!blob.size) {
          toast({ title: "Audio vacio", description: "No se detecto audio en la grabacion", variant: "destructive" });
          return;
        }

        const extension =
          finalMimeType.includes("ogg") ? "ogg" :
          finalMimeType.includes("webm") ? "webm" :
          finalMimeType.includes("mp4") || finalMimeType.includes("m4a") ? "m4a" :
          finalMimeType.includes("mpeg") || finalMimeType.includes("mp3") ? "mp3" :
          "webm";

        const file = new File([blob], `grabacion-${Date.now()}.${extension}`, { type: finalMimeType });
        if (filePreview) {
          URL.revokeObjectURL(filePreview);
        }
        const previewUrl = URL.createObjectURL(blob);
        setSelectedFile(file);
        setSelectedFileType("audio");
        setFilePreview(previewUrl);
      };

      recorder.start(250);
    } catch (error: any) {
      setIsRecording(false);
      stopRecordingStream();
      stopAudioMeter();
      const denied = String(error?.message || "").toLowerCase().includes("denied");
      toast({
        title: denied ? "Permiso denegado" : "Error al grabar",
        description: denied ? "Permite acceso al microfono para grabar audio" : "No se pudo iniciar la grabacion",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      stopRecordingStream();
      stopAudioMeter();
      return;
    }
    recorder.stop();
  };

  const getReferralInfo = (msg: Message) => {
    const raw = msg.rawJson as any;
    const referral = raw?.referral || raw?.context?.referral;
    if (!referral) return null;

    const sourceType = referral.source_type || referral.sourceType || "";
    const sourceUrlRaw = referral.source_url || referral.sourceUrl || "";
    const sourceUrl = sourceUrlRaw
      ? (() => {
          try {
            return new URL(String(sourceUrlRaw)).toString();
          } catch {
            return String(sourceUrlRaw);
          }
        })()
      : "";
    const headline = referral.headline || referral.title || "Ver detalles";
    const imageUrl =
      referral.image_url ||
      referral.imageUrl ||
      referral.thumbnail_url ||
      referral.thumbnailUrl ||
      ogImageByUrl[sourceUrl] ||
      "";

    let sourceLabel = "Anuncio";
    if (String(sourceType).toLowerCase().includes("facebook")) sourceLabel = "Anuncio de Facebook";
    if (String(sourceType).toLowerCase().includes("instagram")) sourceLabel = "Anuncio de Instagram";

    return {
      sourceLabel,
      headline: String(headline),
      sourceUrl: sourceUrl ? String(sourceUrl) : "",
      imageUrl: imageUrl ? String(imageUrl) : "",
    };
  };

  const reassignMutation = useMutation({
    mutationFn: async (agentId: number | null) => {
      const res = await fetch(`/api/conversations/${conversation.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Conversación reasignada" });
    },
  });

  const setLabelMutation = useMutation({
    mutationFn: async (labelIds: number[]) => {
      const res = await fetch(`/api/conversations/${conversation.id}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/:id"] });
    },
  });

  const toggleConversationLabel = (labelId: number) => {
    const selected = [...currentLabelIds];
    const existingIndex = selected.indexOf(labelId);
    if (existingIndex >= 0) {
      selected.splice(existingIndex, 1);
      setLabelMutation.mutate(selected);
      return;
    }
    if (selected.length >= 2) {
      toast({ title: "Máximo 2 etiquetas", description: "Quite una etiqueta para agregar otra", variant: "destructive" });
      return;
    }
    selected.push(labelId);
    setLabelMutation.mutate(selected);
  };

  const setReminderMutation = useMutation({
    mutationFn: async ({ reminderAt, reminderNote }: { reminderAt: string; reminderNote?: string }) => {
      const reminderDate = new Date(reminderAt);
      if (Number.isNaN(reminderDate.getTime())) {
        throw new Error("Fecha de recordatorio inválida");
      }
      const res = await fetch(`/api/conversations/${conversation.id}/reminder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminderAt: reminderDate.toISOString(),
          reminderNote: reminderNote?.trim() || null,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error?.message || "Error al guardar recordatorio");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/:id"] });
      setShowReminderDialog(false);
      toast({ title: "Recordatorio guardado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearReminderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conversations/${conversation.id}/reminder`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error?.message || "Error al eliminar recordatorio");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/:id"] });
      setShowReminderDialog(false);
      toast({ title: "Recordatorio eliminado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const setOrderStatusMutation = useMutation({
    mutationFn: async (orderStatus: string | null) => {
      const res = await fetch(`/api/conversations/${conversation.id}/order-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error al actualizar estado");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Estado de pedido actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleAiMutation = useMutation({
    mutationFn: async (aiDisabled: boolean) => {
      const res = await fetch(`/api/conversations/${conversation.id}/ai-toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiDisabled }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error al cambiar estado de IA");
      }
      return res.json();
    },
    onSuccess: (_, aiDisabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: aiDisabled ? "IA desactivada - Modo humano" : "IA activada en este chat" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const learnMutation = useMutation({
    mutationFn: async ({ focus, messageCount }: { focus: string; messageCount: number }) => {
      const clampedCount = Math.min(50, Math.max(5, messageCount));
      const res = await apiRequest("POST", "/api/ai/learn", { 
        conversationId: conversation.id, 
        focus: focus || "", 
        messageCount: clampedCount 
      });
      return res.json();
    },
    onSuccess: (data: { suggestedRule: string; learnHistoryId?: number }) => {
      setSuggestedRule(data.suggestedRule);
      setLearnHistoryId(typeof data.learnHistoryId === "number" ? data.learnHistoryId : null);
    },
    onError: () => {
      toast({ title: "Error al analizar conversación", variant: "destructive" });
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: async (rule: string) => {
      const res = await apiRequest("POST", "/api/ai/rules", { 
        rule, 
        learnedFrom: learnFocus || "Análisis general",
        conversationId: conversation.id,
        learnHistoryId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regla guardada correctamente" });
      setShowLearnModal(false);
      setSuggestedRule("");
      setLearnFocus("");
      setLearnHistoryId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
    },
    onError: () => {
      toast({ title: "Error al guardar regla", variant: "destructive" });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/conversations/${conversation.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Conversación eliminada" });
    },
    onError: () => {
      toast({ title: "Error al eliminar", variant: "destructive" });
    },
  });

  const clearAttentionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conversations/${conversation.id}/clear-attention`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Alerta despejada" });
    },
  });

  const toggleShouldCallMutation = useMutation({
    mutationFn: async (shouldCall: boolean) => {
      const res = await fetch(`/api/conversations/${conversation.id}/should-call`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shouldCall }),
      });
      return res.json();
    },
    onSuccess: (_, shouldCall) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: shouldCall ? "Marcado para llamar" : "Desmarcado" });
    },
  });

  const updateMessageTextMutation = useMutation({
    mutationFn: async ({ messageId, text }: { messageId: number; text: string }) => {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "No se pudo actualizar el mensaje");
      }
      return res.json();
    },
    onSuccess: () => {
      setEditingMessageId(null);
      setEditingMessageText("");
      setEditingOriginalText("");
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/:id", conversation.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Mensaje actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al editar", description: error.message, variant: "destructive" });
    },
  });

  const createLabelMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error al crear etiqueta");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      setNewLabelName("");
      toast({ title: "Etiqueta creada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateLabelMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; color: string }) => {
      const res = await fetch(`/api/labels/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, color: data.color }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error al actualizar etiqueta");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setEditingLabelId(null);
      setEditingLabelName("");
      toast({ title: "Etiqueta actualizada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLabelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Error al eliminar etiqueta");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Etiqueta eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createQuickMessageMutation = useMutation({
    mutationFn: async (data: { name: string; text?: string | null; imageUrl?: string | null }) => {
      const res = await fetch("/api/quick-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "No se pudo guardar el mensaje rapido");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-messages"] });
      resetQuickMessageForm();
      setShowQuickMessageDialog(false);
      toast({ title: "Mensaje rapido guardado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateQuickMessageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; text?: string | null; imageUrl?: string | null } }) => {
      const res = await fetch(`/api/quick-messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "No se pudo actualizar el mensaje rapido");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-messages"] });
      resetQuickMessageForm();
      setShowQuickMessageDialog(false);
      toast({ title: "Mensaje rapido actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadQuickMessageImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/products/upload-image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "No se pudo subir imagen");
      }
      const payload = await res.json();
      const uploadedUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!uploadedUrl) {
        throw new Error("Respuesta invalida al subir imagen");
      }
      return uploadedUrl;
    },
    onSuccess: (uploadedUrl) => {
      setNewQmImageUrl(uploadedUrl);
      toast({ title: "Imagen cargada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al subir imagen", description: error.message, variant: "destructive" });
    },
  });

  const deleteQuickMessageMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/quick-messages/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-messages"] });
    },
  });

  const getLocationUrl = (msg: Message) => {
    const raw = msg.rawJson as any;
    if (raw?.location) {
      const { latitude, longitude } = raw.location;
      return `https://www.google.com/maps?q=${latitude},${longitude}`;
    }
    return null;
  };

  const isImageLikeSource = (value?: string | null) => {
    if (!value) return false;
    const normalized = value.trim();
    if (!normalized) return false;
    return /^(https?:\/\/|data:image\/|\/uploads\/|uploads\/)/i.test(normalized);
  };

  const normalizeImageSource = (value?: string | null) => {
    if (!value) return "";
    const normalized = value.trim();
    if (!normalized) return "";
    if (/^(https?:\/\/|data:image\/)/i.test(normalized) || normalized.startsWith("/")) {
      return normalized;
    }
    if (/^uploads\//i.test(normalized)) {
      return `/${normalized}`;
    }
    return normalized;
  };

  const getInlineImageSource = (msg: Message) => {
    if (msg.type !== "image") return "";
    const raw = msg.rawJson as any;
    const rawCandidates = [
      raw?._outboundImageUrl,
      raw?.outboundImageUrl,
      raw?.imageUrl,
      raw?.payload?.image?.link,
    ];
    const rawImageSource = rawCandidates.find((candidate) => typeof candidate === "string" && isImageLikeSource(candidate));
    if (typeof rawImageSource === "string") {
      return normalizeImageSource(rawImageSource);
    }
    if (isImageLikeSource(msg.text)) {
      return normalizeImageSource(msg.text);
    }
    return "";
  };

  const copyToClipboard = async (text: string, description = "Texto copiado al portapapeles") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copiado", description });
      return;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        toast({ title: "Copiado", description });
        return;
      } catch {
        toast({ title: "No se pudo copiar", description: "Intenta de nuevo", variant: "destructive" });
      }
    }
  };

  const startEditingMessage = (msg: Message) => {
    const currentText = (msg.text || "").trim();
    if (!currentText || msg.direction !== "out") return;
    setEditingMessageId(msg.id);
    setEditingOriginalText(currentText);
    setEditingMessageText(currentText);
    setLongPressActiveMessageId(null);
    setLongPressPressingMessageId(null);
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText("");
    setEditingOriginalText("");
  };

  const saveEditingMessage = () => {
    if (!editingMessageId || updateMessageTextMutation.isPending) return;
    const nextText = editingMessageText.trim();
    if (!nextText) {
      toast({ title: "Mensaje vacio", description: "Escribe un texto para guardar", variant: "destructive" });
      return;
    }
    if (nextText === editingOriginalText) {
      cancelEditingMessage();
      return;
    }
    updateMessageTextMutation.mutate({ messageId: editingMessageId, text: nextText });
  };

  const clearLongPressTimeout = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleMessageTouchStart = (event: React.TouchEvent, messageId: number, text?: string | null) => {
    if (!text?.trim()) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,a,audio,input,textarea")) return;

    event.stopPropagation();
    setLongPressPressingMessageId(messageId);
    setLongPressActiveMessageId(null);
    clearLongPressTimeout();
    longPressMovedRef.current = false;
    const touch = event.touches[0];
    longPressStartRef.current = { x: touch.clientX, y: touch.clientY };

    longPressTimeoutRef.current = setTimeout(() => {
      if (!longPressMovedRef.current) {
        setLongPressActiveMessageId(messageId);
      }
    }, 900);
  };

  const handleMessageTouchMove = (event: React.TouchEvent) => {
    if (!longPressStartRef.current) return;
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - longPressStartRef.current.x);
    const dy = Math.abs(touch.clientY - longPressStartRef.current.y);
    if (dx > 10 || dy > 10) {
      longPressMovedRef.current = true;
      setLongPressPressingMessageId(null);
      clearLongPressTimeout();
    }
  };

  const handleMessageTouchEnd = () => {
    clearLongPressTimeout();
    setLongPressPressingMessageId(null);
    longPressStartRef.current = null;
  };

  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  useEffect(() => {
    return () => clearLongPressTimeout();
  }, []);

  const getWaMeLink = () => {
    const phone = (conversation.waId || "").replace(/\D/g, "");
    return `wa.me/${phone}`;
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const composerText = getComposerText().trim();
    
    if (selectedFile) {
      if (selectedFileType === "audio") {
        uploadAudioMutation.mutate({ file: selectedFile, to: conversation.waId });
      } else if (selectedFileType === "video") {
        uploadVideoMutation.mutate({ file: selectedFile, to: conversation.waId, caption: composerText || undefined });
      } else if (selectedFileType === "document") {
        uploadDocumentMutation.mutate({ file: selectedFile, to: conversation.waId, caption: composerText || undefined });
      } else {
        uploadImageMutation.mutate({ file: selectedFile, to: conversation.waId, caption: composerText || undefined });
      }
      return;
    }

    if ((!composerText && !imageUrl.trim()) || isPending) return;

    const textBackup = composerText;
    const imageBackup = imageUrl;

    setComposerText("");
    setImageUrl("");
    setShowImageInput(false);

    sendMessage(
      {
        to: conversation.waId,
        type: imageUrl ? "image" : "text",
        text: composerText || undefined,
        imageUrl: imageUrl.trim() || undefined,
        caption: imageUrl && composerText ? composerText : undefined
      },
      {
        onError: () => {
          setComposerText(textBackup);
          setImageUrl(imageBackup);
          if (imageBackup) setShowImageInput(true);
        }
      }
    );
  };

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Archivo muy grande", description: "Max 5MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setSelectedFileType("image");
    setFilePreview(URL.createObjectURL(file));
    setShowImageInput(false);
    setImageUrl("");
  };

  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast({ title: "Formato no soportado", description: "Selecciona un audio", variant: "destructive" });
      return;
    }
    const normalizedMime = file.type.toLowerCase();
    const allowedAudioPrefixes = [
      "audio/ogg",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/x-m4a",
      "audio/aac",
      "audio/amr",
    ];
    if (!allowedAudioPrefixes.some((prefix) => normalizedMime.startsWith(prefix))) {
      toast({
        title: "Formato no compatible",
        description: "WhatsApp Cloud acepta OGG, MP3, M4A, AAC o AMR.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast({ title: "Archivo muy grande", description: "Max 16MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setSelectedFileType("audio");
    setFilePreview(URL.createObjectURL(file));
    setShowImageInput(false);
    setImageUrl("");
  };

  const handleVideoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const normalizedMime = (file.type || "").toLowerCase();
    const normalizedName = (file.name || "").toLowerCase();
    const validMime =
      normalizedMime.startsWith("video/") ||
      normalizedMime === "application/octet-stream";
    const validExt = [".mp4", ".mov", ".3gp", ".3gpp", ".m4v"].some((ext) => normalizedName.endsWith(ext));
    if (!validMime && !validExt) {
      toast({ title: "Formato no soportado", description: "Selecciona un video MP4, MOV o 3GP", variant: "destructive" });
      return;
    }
    if (file.size > 64 * 1024 * 1024) {
      toast({ title: "Archivo muy grande", description: "Max 64MB para convertir", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setSelectedFileType("video");
    setFilePreview(URL.createObjectURL(file));
    setShowImageInput(false);
    setImageUrl("");
  };

  const handleDocumentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const normalizedMime = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    const isPdf = normalizedMime === "application/pdf" || fileName.endsWith(".pdf");
    if (!isPdf) {
      toast({ title: "Formato no soportado", description: "Selecciona un archivo PDF", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Archivo muy grande", description: "Max 20MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setSelectedFileType("document");
    setFilePreview(null);
    setShowImageInput(false);
    setImageUrl("");
  };

  const handleQuickMessageImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Formato no soportado", description: "Selecciona una imagen", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Archivo muy grande", description: "Max 8MB", variant: "destructive" });
      return;
    }
    uploadQuickMessageImageMutation.mutate(file);
  };

  const handleQuickMessage = (qm: QuickMessage) => {
    setComposerText(qm.text || "");
    if (qm.imageUrl) {
      setImageUrl(qm.imageUrl);
      setShowImageInput(true);
    } else {
      setImageUrl("");
      setShowImageInput(false);
    }
  };

  const resetQuickMessageForm = () => {
    setEditingQuickMessageId(null);
    setNewQmName("");
    setNewQmText("");
    setNewQmImageUrl("");
    if (quickMessageImageInputRef.current) {
      quickMessageImageInputRef.current.value = "";
    }
  };

  const openQuickMessageCreator = () => {
    resetQuickMessageForm();
    setShowQuickMessageDialog(true);
  };

  const openQuickMessageEditor = (qm: QuickMessage) => {
    setEditingQuickMessageId(qm.id);
    setNewQmName(qm.name || "");
    setNewQmText(qm.text || "");
    setNewQmImageUrl(qm.imageUrl || "");
    if (quickMessageImageInputRef.current) {
      quickMessageImageInputRef.current.value = "";
    }
    setShowQuickMessageDialog(true);
  };

  const saveQuickMessage = () => {
    const name = newQmName.trim();
    const text = newQmText.trim();
    const imageUrlValue = newQmImageUrl.trim();
    const payload = {
      name,
      text: text || null,
      imageUrl: imageUrlValue || null,
    };
    if (editingQuickMessageId) {
      updateQuickMessageMutation.mutate({ id: editingQuickMessageId, data: payload });
      return;
    }
    createQuickMessageMutation.mutate(payload);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openLabelEditor = (label: Label) => {
    setEditingLabelId(label.id);
    setEditingLabelName(label.name);
    setEditingLabelColor(label.color);
  };

  const cancelLabelEditor = () => {
    setEditingLabelId(null);
    setEditingLabelName("");
    setEditingLabelColor("blue");
  };

  return (
    <div className="flex flex-col h-full max-h-full bg-[#efeae2] dark:bg-[#0b141a] relative overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: recordingWaveCss }} />
      {/* Chat Header */}
      <header className="flex-shrink-0 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border/30 flex flex-col md:flex-row md:items-center md:justify-between px-3 md:px-4 py-2 md:py-1.5 z-20">
        <div className="flex items-start md:items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 flex-shrink-0">
            <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${conversation.contactName || conversation.waId}`} />
            <AvatarFallback>{conversation.waId.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold text-foreground truncate text-sm">
                {conversation.contactName || conversation.waId}
              </h3>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => void copyToClipboard(getWaMeLink(), "URL copiada al portapapeles")}
                className="text-xs text-muted-foreground hover:text-emerald-500 transition-colors text-left block"
                data-testid="button-copy-wa-link"
                title="Copiar enlace wa.me"
              >
                +{conversation.waId}
              </button>
              <div className="flex items-center gap-1.5 md:hidden">
                {currentLabels.slice(0, 2).map((label) => (
                  <Badge
                    key={label.id}
                    className={cn("text-[9px] leading-none px-1.5 py-0 cursor-help", LABEL_COLORS.find(c => c.name === label.color)?.bg)}
                    title={label.name}
                    onClick={() => showFullLabelName(label.name)}
                  >
                    {toCompactLabel(label.name)}
                  </Badge>
                ))}
                {conversation.reminderAt && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/90 text-white">
                    <Clock className="h-2.5 w-2.5 mr-1" />
                    {reminderBadgeText}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-1.5 w-full md:mt-0 md:w-auto md:ml-2">
        <div className="hidden md:flex items-center justify-end gap-1 flex-row-reverse mb-1">
          {conversation.reminderAt && (
            <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/90 text-white">
              <Clock className="h-2.5 w-2.5 mr-1" />
              {reminderBadgeText}
            </Badge>
          )}
          {currentLabels.slice(0, 2).map((label) => (
            <Badge
              key={label.id}
              className={cn("text-[9px] leading-none px-1.5 py-0 cursor-help", LABEL_COLORS.find(c => c.name === label.color)?.bg)}
              title={label.name}
              onClick={() => showFullLabelName(label.name)}
            >
              {toCompactLabel(label.name)}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1 overflow-x-auto md:justify-end md:gap-0 md:overflow-visible">
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-7 w-7"
            onClick={onClose}
            data-testid="button-close-chat-area"
            title="Cerrar chat"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {/* Reassign Agent Dropdown (admin only) */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="flex-shrink-0 h-7 w-7" data-testid="button-reassign-agent">
                <UserRoundCog className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => reassignMutation.mutate(null)} data-testid="reassign-none">
                Sin agente
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {agentsData.map((agent) => (
                <DropdownMenuItem
                  key={agent.id}
                  onClick={() => reassignMutation.mutate(agent.id)}
                  data-testid={`reassign-agent-${agent.id}`}
                  className={cn(conversation.assignedAgentId === agent.id && "font-bold")}
                >
                  {agent.name} {conversation.assignedAgentId === agent.id ? "(actual)" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Label Dropdown */}
        <Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="flex-shrink-0 h-7 w-7">
                <Tag className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLabelMutation.mutate([])}>
                <span className={cn("mr-2 inline-flex", currentLabelIds.length === 0 ? "text-emerald-500" : "text-transparent")}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                Sin etiqueta
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {ownedLabels.map((label) => (
                <DropdownMenuItem key={label.id} onClick={() => toggleConversationLabel(label.id)}>
                  <span className={cn("mr-2 inline-flex", currentLabelIds.includes(label.id) ? "text-emerald-500" : "text-transparent")}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div className={cn("w-3 h-3 rounded-full mr-2", LABEL_COLORS.find(c => c.name === label.color)?.bg)} />
                  {label.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLabelManagerDialog(true)} data-testid="menu-label-manage">
                <Pencil className="h-4 w-4 mr-2" />
                Gestionar etiquetas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openReminderEditor} data-testid="menu-reminder-edit">
                <Clock className="h-4 w-4 mr-2 text-amber-500" />
                {conversation.reminderAt ? "Editar recordatorio" : "Agregar recordatorio"}
              </DropdownMenuItem>
              {conversation.reminderAt && (
                <DropdownMenuItem
                  onClick={() => clearReminderMutation.mutate()}
                  data-testid="menu-reminder-clear"
                  className="text-red-500 focus:text-red-500"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar recordatorio
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DialogTrigger asChild>
                <DropdownMenuItem>
                  <Plus className="h-4 w-4 mr-2" /> Nueva etiqueta
                </DropdownMenuItem>
              </DialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
	          <DialogContent>
	            <DialogHeader>
	              <DialogTitle>Nueva Etiqueta</DialogTitle>
	            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input placeholder="Nombre (ej: Cliente)" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} />
              <div className="flex gap-2">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setNewLabelColor(c.name)}
                    className={cn("w-8 h-8 rounded-full", c.bg, newLabelColor === c.name && "ring-2 ring-offset-2 ring-primary")}
                  />
                ))}
              </div>
	              <Button onClick={() => createLabelMutation.mutate({ name: newLabelName, color: newLabelColor })} disabled={!newLabelName}>
	                Crear
	              </Button>
	            </div>
	          </DialogContent>
		        </Dialog>
		        <Dialog open={showLabelManagerDialog} onOpenChange={(open) => {
		          setShowLabelManagerDialog(open);
		          if (!open) cancelLabelEditor();
		        }}>
		          <DialogContent>
		            <DialogHeader>
		              <DialogTitle>Gestionar etiquetas</DialogTitle>
		            </DialogHeader>
		            <div className="space-y-3 mt-2 max-h-[60vh] overflow-y-auto">
			              {ownedLabels.length === 0 ? (
			                <p className="text-sm text-muted-foreground">No tiene etiquetas creadas.</p>
			              ) : (
			                ownedLabels.map((label) => {
		                  const isEditing = editingLabelId === label.id;
		                  return (
		                    <div key={label.id} className="rounded-lg border border-border/60 p-3 space-y-2">
		                      {isEditing ? (
		                        <>
		                          <Input
		                            value={editingLabelName}
		                            onChange={(e) => setEditingLabelName(e.target.value)}
		                            placeholder="Nombre de etiqueta"
		                          />
		                          <div className="flex gap-2">
		                            {LABEL_COLORS.map((c) => (
		                              <button
		                                key={c.name}
		                                onClick={() => setEditingLabelColor(c.name)}
		                                className={cn("w-7 h-7 rounded-full", c.bg, editingLabelColor === c.name && "ring-2 ring-offset-2 ring-primary")}
		                              />
		                            ))}
		                          </div>
		                          <div className="flex justify-end gap-2">
		                            <Button variant="outline" size="sm" onClick={cancelLabelEditor}>
		                              Cancelar
		                            </Button>
		                            <Button
		                              size="sm"
		                              onClick={() => {
		                                const trimmed = editingLabelName.trim();
		                                if (!trimmed) {
		                                  toast({ title: "Nombre requerido", description: "Ingrese un nombre para la etiqueta", variant: "destructive" });
		                                  return;
		                                }
		                                updateLabelMutation.mutate({ id: label.id, name: trimmed, color: editingLabelColor });
		                              }}
		                              disabled={updateLabelMutation.isPending}
		                            >
		                              {updateLabelMutation.isPending ? "Guardando..." : "Guardar"}
		                            </Button>
		                          </div>
		                        </>
		                      ) : (
		                        <div className="flex items-center justify-between gap-3">
		                          <div className="flex items-center gap-2 min-w-0">
		                            <div className={cn("w-3 h-3 rounded-full", LABEL_COLORS.find((c) => c.name === label.color)?.bg || "bg-slate-400")} />
		                            <span className="text-sm font-medium truncate">{label.name}</span>
		                          </div>
		                          <div className="flex items-center gap-1">
		                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLabelEditor(label)} data-testid={`button-edit-label-${label.id}`}>
		                              <Pencil className="h-4 w-4" />
		                            </Button>
		                            <Button
		                              variant="ghost"
		                              size="icon"
		                              className="h-7 w-7 text-red-500"
		                              onClick={() => {
		                                if (confirm(`¿Eliminar la etiqueta "${label.name}"?`)) {
		                                  deleteLabelMutation.mutate(label.id);
		                                }
		                              }}
		                              disabled={deleteLabelMutation.isPending}
		                              data-testid={`button-delete-label-${label.id}`}
		                            >
		                              <Trash2 className="h-4 w-4" />
		                            </Button>
		                          </div>
		                        </div>
		                      )}
		                    </div>
		                  );
		                })
		              )}
		            </div>
		          </DialogContent>
		        </Dialog>
		        <Dialog open={showReminderDialog} onOpenChange={setShowReminderDialog}>
	          <DialogContent>
	            <DialogHeader>
	              <DialogTitle>{conversation.reminderAt ? "Editar recordatorio" : "Nuevo recordatorio"}</DialogTitle>
	            </DialogHeader>
	            <div className="space-y-4 mt-3">
	              <div className="space-y-1">
	                <label className="text-sm font-medium">Fecha y hora</label>
	                <Input
	                  type="datetime-local"
	                  value={reminderAtInput}
	                  onChange={(e) => setReminderAtInput(e.target.value)}
	                  data-testid="input-reminder-datetime"
	                />
	              </div>
	              <div className="space-y-1">
	                <label className="text-sm font-medium">Nota (opcional)</label>
	                <Textarea
	                  rows={3}
	                  maxLength={300}
	                  placeholder="Ej: Cliente pidió que le escribamos el miércoles"
	                  value={reminderNoteInput}
	                  onChange={(e) => setReminderNoteInput(e.target.value)}
	                  data-testid="textarea-reminder-note"
	                />
	              </div>
	              <div className="flex justify-end gap-2">
	                {conversation.reminderAt && (
	                  <Button
	                    variant="destructive"
	                    onClick={() => clearReminderMutation.mutate()}
	                    disabled={clearReminderMutation.isPending}
	                    data-testid="button-reminder-delete"
	                  >
	                    {clearReminderMutation.isPending ? "Eliminando..." : "Eliminar"}
	                  </Button>
	                )}
	                <Button
	                  onClick={() => {
	                    if (!reminderAtInput) {
	                      toast({ title: "Fecha requerida", description: "Seleccione una fecha para el recordatorio", variant: "destructive" });
	                      return;
	                    }
	                    setReminderMutation.mutate({ reminderAt: reminderAtInput, reminderNote: reminderNoteInput });
	                  }}
	                  disabled={setReminderMutation.isPending}
	                  data-testid="button-reminder-save"
	                >
	                  {setReminderMutation.isPending ? "Guardando..." : "Guardar"}
	                </Button>
	              </div>
	            </div>
	          </DialogContent>
	        </Dialog>

	        {/* AI Toggle Button (admin and agents) */}
	        {canToggleConversationAi && (
          <Button 
            variant={conversation.aiDisabled ? "default" : "ghost"} 
            size="icon" 
            className={cn(
              "flex-shrink-0 h-7 w-7",
              conversation.aiDisabled && "bg-orange-500 text-white"
            )}
            onClick={() => toggleAiMutation.mutate(!conversation.aiDisabled)}
            title={conversation.aiDisabled ? "IA desactivada - Click para activar" : "IA activa - Click para desactivar"}
            data-testid="button-ai-toggle"
          >
            {conversation.aiDisabled ? <BotOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </Button>
        )}

        {/* Human Attention Alert */}
        {conversation.needsHumanAttention && (
          <Button 
            variant="default" 
            size="icon" 
            className="flex-shrink-0 h-7 w-7 bg-red-500 text-white"
            onClick={() => clearAttentionMutation.mutate()}
            title="La IA no pudo responder - Click para despejar alerta"
            data-testid="button-clear-attention"
          >
            <AlertCircle className="h-4 w-4" />
          </Button>
        )}

        {/* Should Call Toggle */}
        <Button 
          variant={conversation.shouldCall ? "default" : "ghost"} 
          size="icon" 
          className={cn(
            "flex-shrink-0 h-7 w-7",
            conversation.shouldCall && "bg-green-500 text-white"
          )}
          onClick={() => toggleShouldCallMutation.mutate(!conversation.shouldCall)}
          title={conversation.shouldCall ? "Marcado para llamar - Click para quitar" : "Click para marcar para llamar"}
          data-testid="button-should-call"
        >
          <Phone className="h-4 w-4" />
        </Button>

        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 h-7 w-7 text-red-400"
            onClick={() => {
              if (confirm("¿Eliminar esta conversación y todos sus mensajes?")) {
                deleteConversationMutation.mutate();
              }
            }}
            title="Eliminar conversación"
            data-testid="button-delete-conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

        {/* Learn Button */}
        <Dialog open={showLearnModal} onOpenChange={setShowLearnModal}>
          <DialogTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="flex-shrink-0 h-7 w-7"
              title="Aprender de esta conversación"
              data-testid="button-learn"
            >
              <Lightbulb className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Aprender de esta conversación</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">¿Qué quieres que aprenda?</label>
                <Input
                  placeholder="Ej: Cómo evité un reclamo, cómo cerré la venta..."
                  value={learnFocus}
                  onChange={(e) => setLearnFocus(e.target.value)}
                  data-testid="input-learn-focus"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Mensajes a analizar: {learnMessageCount}</label>
                <Slider
                  min={5}
                  max={50}
                  step={1}
                  value={[learnMessageCount]}
                  onValueChange={(value) => setLearnMessageCount(value[0])}
                  className="w-full mt-2"
                  data-testid="slider-message-count"
                />
              </div>
              {!suggestedRule && (
                <Button 
                  onClick={() => learnMutation.mutate({ focus: learnFocus, messageCount: learnMessageCount })}
                  disabled={learnMutation.isPending}
                  className="w-full"
                  data-testid="button-analyze"
                >
                  {learnMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Analizando...
                    </>
                  ) : (
                    "Analizar conversación"
                  )}
                </Button>
              )}
              {suggestedRule && (
                <div className="space-y-3">
                  <label className="text-sm font-medium">Regla sugerida (puedes editarla):</label>
                  <Textarea
                    value={suggestedRule}
                    onChange={(e) => setSuggestedRule(e.target.value)}
                    rows={3}
                    data-testid="textarea-suggested-rule"
                  />
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setSuggestedRule("");
                        setLearnHistoryId(null);
                      }}
                      className="flex-1"
                      data-testid="button-retry"
                    >
                      Reintentar
                    </Button>
                    <Button 
                      onClick={() => saveRuleMutation.mutate(suggestedRule)}
                      disabled={saveRuleMutation.isPending || !suggestedRule.trim()}
                      className="flex-1"
                      data-testid="button-save-rule"
                    >
                      {saveRuleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar regla"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Order Status Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant={conversation.orderStatus === 'ready' ? "default" : "ghost"} 
              size="icon" 
              className={cn(
                "flex-shrink-0 h-7 w-7",
                conversation.orderStatus === 'ready' && "bg-green-500 text-white",
                conversation.orderStatus === 'pending' && "text-yellow-600",
                conversation.orderStatus === 'delivered' && "text-blue-600"
              )}
              data-testid="button-order-status"
            >
              {conversation.orderStatus === 'ready' ? <PackageCheck className="h-4 w-4" /> :
               conversation.orderStatus === 'pending' ? <Package className="h-4 w-4" /> :
               conversation.orderStatus === 'delivered' ? <Truck className="h-4 w-4" /> :
               <Package className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setOrderStatusMutation.mutate(null)}>
              <PackageX className="h-4 w-4 mr-2 text-muted-foreground" />
              Sin pedido
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setOrderStatusMutation.mutate('pending')}>
              <Package className="h-4 w-4 mr-2 text-yellow-600" />
              Pedido en proceso
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOrderStatusMutation.mutate('ready')}>
              <PackageCheck className="h-4 w-4 mr-2 text-green-600" />
              Listo para entregar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOrderStatusMutation.mutate('delivered')}>
              <Truck className="h-4 w-4 mr-2 text-blue-600" />
              Entregado
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
        </div>
      </header>

      {/* Messages List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2"
        onClick={() => {
          setLongPressActiveMessageId(null);
          setLongPressPressingMessageId(null);
        }}
      >
        {messages.map((msg) => {
          const isOut = msg.direction === "out";
          const canEditMessage = isOut && msg.type === "text" && Boolean(msg.text?.trim());
          const isEditingThisMessage = editingMessageId === msg.id;
          
          // Parse parent message info from WhatsApp's raw payload
          const raw = msg.rawJson as any;
          const parentMessageId = raw?.context?.id || raw?.context?.message_id;
          const parentMsg = parentMessageId ? messages.find((m) => m.waMessageId === parentMessageId) : null;

          return (
            <div key={msg.id} className={cn("flex w-full", isOut ? "justify-end" : "justify-start")}>
              <div
                id={`msg-id-${msg.id}`}
                className={cn(
                  "group relative max-w-[85%] sm:max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm transition-all duration-300",
                  isOut 
                    ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-sm" 
                    : "bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-sm",
                  longPressPressingMessageId === msg.id && "scale-[0.985]"
                )}
                style={{
                  WebkitTouchCallout: isTouchDevice ? "none" : "default",
                  WebkitUserSelect: isTouchDevice ? "none" : "text",
                  userSelect: isTouchDevice ? "none" : "text",
                }}
                onContextMenu={isTouchDevice ? (e) => e.preventDefault() : undefined}
                onTouchStart={(e) => handleMessageTouchStart(e, msg.id, msg.text)}
                onTouchMove={handleMessageTouchMove}
                onTouchEnd={handleMessageTouchEnd}
                onTouchCancel={handleMessageTouchEnd}
                onClick={(e) => e.stopPropagation()}
              >
                {parentMsg && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      console.log("[ReplyScroll] Clicked quote. Parent message db ID:", parentMsg.id, "waMessageId:", parentMsg.waMessageId);
                      const el = document.getElementById(`msg-id-${parentMsg.id}`);
                      if (el) {
                        console.log("[ReplyScroll] Element found, scrolling...");
                        if (scrollRef.current) {
                          const container = scrollRef.current;
                          const containerRect = container.getBoundingClientRect();
                          const elRect = el.getBoundingClientRect();
                          
                          // Calculate exact relative scroll position independent of offsetParent
                          const relativeTop = elRect.top - containerRect.top + container.scrollTop;
                          const targetScrollTop = relativeTop - (container.clientHeight / 2) + (el.clientHeight / 2);
                          
                          container.scrollTo({
                            top: targetScrollTop,
                            behavior: "smooth"
                          });
                        } else {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                        
                        // Flash highlight effect
                        el.classList.add("ring-2", "ring-emerald-500", "scale-[1.03]", "shadow-lg");
                        setTimeout(() => {
                          el.classList.remove("ring-2", "ring-emerald-500", "scale-[1.03]", "shadow-lg");
                        }, 1200);
                      } else {
                        console.warn("[ReplyScroll] Could not find DOM element for msg db ID:", parentMsg.id);
                      }
                    }}
                    className="mb-1.5 cursor-pointer rounded border-l-4 border-emerald-500 bg-black/5 dark:bg-black/25 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-black/40 transition-all select-none"
                  >
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400 text-[10px]">
                      {parentMsg.direction === "out" ? "Tú" : parentMsg.direction === "in" ? "Cliente" : "Agente"}
                    </div>
                    <div className="truncate max-w-[200px]">
                      {parentMsg.type === "image" ? "📷 Imagen" : parentMsg.type === "audio" ? "🎵 Audio" : parentMsg.type === "video" ? "🎥 Video" : parentMsg.text || "[Mensaje]"}
                    </div>
                  </div>
                )}
                {canEditMessage && !isEditingThisMessage && (
                  <button
                    type="button"
                    className={cn(
                      "absolute -top-2 -left-2 z-10 rounded-full bg-white/95 p-1.5 text-slate-600 shadow ring-1 ring-slate-200 transition",
                      isTouchDevice ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditingMessage(msg);
                    }}
                    aria-label="Editar mensaje"
                    title="Editar mensaje"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {longPressActiveMessageId === msg.id && msg.text?.trim() && (
                  <div className="absolute -top-3 right-1 z-10 flex items-center gap-1 rounded-full bg-slate-900/95 p-1 text-white shadow-md">
                    <button
                      type="button"
                      className={cn(
                        "rounded-full px-2 py-1 text-[11px] font-medium transition-transform duration-100 active:scale-95",
                        copyPressedMessageId === msg.id && "scale-95"
                      )}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setCopyPressedMessageId(msg.id);
                      }}
                      onTouchEnd={(e) => {
                        e.stopPropagation();
                        setCopyPressedMessageId(null);
                      }}
                      onTouchCancel={(e) => {
                        e.stopPropagation();
                        setCopyPressedMessageId(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyToClipboard(msg.text || "");
                        setCopyPressedMessageId(null);
                        setLongPressActiveMessageId(null);
                      }}
                    >
                      Copiar
                    </button>
                    {canEditMessage && (
                      <button
                        type="button"
                        className="rounded-full px-2 py-1 text-[11px] font-medium transition-transform duration-100 active:scale-95"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingMessage(msg);
                          setLongPressActiveMessageId(null);
                        }}
                      >
                        Editar
                      </button>
                    )}
                  </div>
                )}
                {msg.type === "image" && (
                  <div className="mb-2 rounded overflow-hidden">
                    {msg.mediaId && !failedMediaIds[msg.mediaId] ? (
                      <img
                        src={`/api/media/${msg.mediaId}`}
                        alt="Media"
                        className="max-w-full h-auto"
                        loading="lazy"
                        onError={() => markMediaAsFailed(msg.mediaId)}
                      />
                    ) : getInlineImageSource(msg) ? (
                      <img
                        src={getInlineImageSource(msg)}
                        alt="Sent image"
                        className="max-w-full h-auto"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : msg.mediaId && failedMediaIds[msg.mediaId] ? (
                      <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                        Media no disponible
                      </div>
                    ) : null}
                  </div>
                )}

                {msg.type === "video" && (
                  <div className="mb-2 rounded overflow-hidden">
                    {msg.mediaId && !failedMediaIds[msg.mediaId] ? (
                      <video
                        controls
                        preload="metadata"
                        className="max-w-full h-auto max-h-[320px]"
                        onError={() => markMediaAsFailed(msg.mediaId)}
                      >
                        <source src={`/api/media/${msg.mediaId}`} type={msg.mimeType || "video/mp4"} />
                        Tu navegador no soporta video
                      </video>
                    ) : msg.mediaId && failedMediaIds[msg.mediaId] ? (
                      <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                        Video no disponible
                      </div>
                    ) : (
                      <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                        Video
                      </div>
                    )}
                  </div>
                )}

                {msg.type === "sticker" && (
                  <div className="mb-2 rounded overflow-hidden">
                    {msg.mediaId && !failedMediaIds[msg.mediaId] ? (
                      <img
                        src={`/api/media/${msg.mediaId}`}
                        alt="Sticker"
                        className="max-w-[180px] h-auto"
                        loading="lazy"
                        onError={() => markMediaAsFailed(msg.mediaId)}
                      />
                    ) : msg.mediaId && failedMediaIds[msg.mediaId] ? (
                      <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                        Sticker no disponible
                      </div>
                    ) : (
                      <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                        Sticker
                      </div>
                    )}
                  </div>
                )}

                {msg.type === "audio" && msg.mediaId && !failedMediaIds[msg.mediaId] && (
                  <div className="mb-2">
                    <audio
                      controls
                      className="max-w-full h-10"
                      preload="metadata"
                      onError={() => markMediaAsFailed(msg.mediaId)}
                    >
                      <source src={`/api/media/${msg.mediaId}`} type={msg.mimeType || "audio/ogg"} />
                      Tu navegador no soporta audio
                    </audio>
                  </div>
                )}
                {msg.type === "audio" && msg.mediaId && failedMediaIds[msg.mediaId] && (
                  <div className="mb-2 rounded bg-black/5 dark:bg-white/5 px-2 py-1 text-xs text-slate-500">
                    Audio no disponible
                  </div>
                )}

                {msg.type === "document" && (
                  <div className="mb-2 rounded bg-black/5 dark:bg-white/5 px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-red-500" />
                      <span className="font-medium truncate">
                        {msg.text?.replace(/^\[pdf\]\s*/i, "").trim() || "Documento PDF"}
                      </span>
                    </div>
                    {msg.mediaId && (
                      <a
                        href={`/api/media/${msg.mediaId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex mt-1 text-cyan-700 dark:text-cyan-300 underline"
                      >
                        Abrir PDF
                      </a>
                    )}
                  </div>
                )}

                {msg.type === "location" && (() => {
                  const locationUrl = getLocationUrl(msg);
                  const raw = msg.rawJson as any;
                  return locationUrl ? (
                    <div className="mb-2 p-2 rounded bg-black/5 dark:bg-white/5">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-xs">Ubicación</span>
                      </div>
                      {raw?.location?.name && <p className="text-xs opacity-70 mb-2">{raw.location.name}</p>}
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => void copyToClipboard(locationUrl, "URL copiada al portapapeles")}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(locationUrl, '_blank')}>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : null;
                })()}

                {(() => {
                  const referral = getReferralInfo(msg);
                  if (!referral) return null;
                  return (
                    <div className="mb-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs">
                      <p className="font-medium text-emerald-700 dark:text-emerald-300">{referral.sourceLabel}</p>
                      {referral.imageUrl && (
                        <img
                          src={referral.imageUrl}
                          alt="Anuncio"
                          className="mt-1 mb-1 h-20 w-full max-w-[220px] rounded object-cover border border-emerald-500/20"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <p className="text-slate-700 dark:text-slate-200">{referral.headline}</p>
                      {referral.sourceUrl && (
                        <button
                          type="button"
                          className="mt-1 text-cyan-700 dark:text-cyan-300 underline"
                          onClick={() => window.open(referral.sourceUrl, "_blank", "noopener,noreferrer")}
                        >
                          Ver detalles
                        </button>
                      )}
                    </div>
                  );
                })()}
                
                {isEditingThisMessage ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editingMessageText}
                      onChange={(e) => setEditingMessageText(e.target.value)}
                      className="min-h-[96px] resize-y bg-white/90 text-slate-900"
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelEditingMessage();
                        }}
                        disabled={updateMessageTextMutation.isPending}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveEditingMessage();
                        }}
                        disabled={updateMessageTextMutation.isPending || !editingMessageText.trim()}
                      >
                        {updateMessageTextMutation.isPending ? "Guardando..." : "Guardar"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  msg.text && msg.type !== "document" && !(msg.type === "sticker" && msg.text.startsWith("[Sticker")) && (
                    !(
                      msg.type === "image" &&
                      isImageLikeSource(msg.text)
                    ) && (() => {
                      const emojiType = getSingleEmojiType(msg.text);
                      if (emojiType === "heart") {
                        return (
                          <div className="py-1 px-2 text-center select-none">
                            <span className="text-5xl inline-block animate-wa-heart-beat">
                              {msg.text.trim()}
                            </span>
                          </div>
                        );
                      }
                      if (emojiType === "emoji") {
                        return (
                          <div className="py-1 px-2 text-center select-none">
                            <span className="text-5xl inline-block animate-wa-emoji-float">
                              {msg.text.trim()}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      );
                    })()
                  )
                )}

                <div className={cn("flex items-center justify-end gap-1 mt-1 text-[10px] opacity-60")}>
                  <span>{msg.timestamp ? format(new Date(parseInt(msg.timestamp) * 1000), 'h:mm a') : format(new Date(), 'h:mm a')}</span>
                  {isOut && (
                    msg.status === 'read' ? <CheckCheck className="h-3 w-3 text-blue-400" /> : <Check className="h-3 w-3" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Debug Panel */}
      {showDebug && (
        <div className="absolute bottom-24 right-4 z-30 bg-black/90 text-green-400 p-3 rounded-lg shadow-xl max-w-xs text-xs font-mono">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold">Debug</span>
            <Button size="icon" variant="ghost" onClick={() => setShowDebug(false)} className="h-5 w-5 text-white">
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p>To: +{conversation.waId}</p>
          <p>Messages: {messages.length}</p>
          <p>Labels: {currentLabels.map((label) => label.name).join(", ") || "None"}</p>
        </div>
      )}

      {/* Preview Area */}
      {(imageUrl || (showImageInput && imageUrl)) && (
        <div className="px-4 py-2 bg-muted/50 border-t flex items-center gap-3">
          <img src={imageUrl} alt="Preview" className="h-16 w-16 object-cover rounded" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{imageUrl}</p>
            {hasTextDraft && <p className="text-sm truncate">{getComposerText()}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={() => { setImageUrl(""); setShowImageInput(false); }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selectedFile && (filePreview || selectedFileType === "document") && (
        <div className="px-4 py-2 bg-muted/50 border-t flex items-center gap-3">
          {selectedFileType === "audio" ? (
            <audio controls src={filePreview || undefined} className="h-10 max-w-[180px]" />
          ) : selectedFileType === "video" ? (
            <video controls src={filePreview || undefined} className="h-16 w-24 rounded bg-black/70 object-cover" />
          ) : selectedFileType === "document" ? (
            <div className="h-10 w-10 rounded bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
          ) : (
            <img src={filePreview || undefined} alt="Preview" className="h-16 w-16 object-cover rounded" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => { setSelectedFile(null); setSelectedFileType(null); setFilePreview(null); }} data-testid="button-remove-file">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelect}
        data-testid="input-file-image"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        capture="user"
        className="hidden"
        onChange={handleAudioFileSelect}
        data-testid="input-file-audio"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.3gp,.3gpp,.m4v"
        className="hidden"
        onChange={handleVideoFileSelect}
        data-testid="input-file-video"
      />
      <input
        ref={documentInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleDocumentFileSelect}
        data-testid="input-file-document"
      />

      {/* Input Area */}
      <div className="p-1.5 pb-5 md:p-2 bg-[#f0f2f5] dark:bg-[#202c33] z-20 flex-shrink-0 overflow-x-hidden">
        {showImageInput && !imageUrl && (
          <div className="mb-2 px-2">
            <Input placeholder="URL de imagen..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="text-sm" />
          </div>
        )}
        {isRecording && (
          <div className="mb-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="flex items-end gap-0.5 h-4">
                {recordingBars.map((level, index) => (
                  <span
                    key={index}
                    className="recording-wave-bar"
                    style={{
                      height: `${Math.round(4 + level * 14)}px`,
                      opacity: Math.max(0.45, Math.min(1, 0.35 + level)),
                    }}
                  />
                ))}
              </span>
              Grabando: {formatRecordingTime(recordingSeconds)}
            </span>
            <span>Toca mic para detener</span>
          </div>
        )}
        
        <div className="flex items-end gap-1.5 md:gap-2">
          <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
            {/* Attachment Menu */}
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 md:h-10 md:w-10 flex-shrink-0">
                <Plus className="h-4 w-4 md:h-5 md:w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()} data-testid="menu-image-gallery">
                <ImageIcon className="h-4 w-4 mr-2 text-blue-500" /> Imagen (Galería)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => audioInputRef.current?.click()} data-testid="menu-audio-file">
                <Mic className="h-4 w-4 mr-2 text-emerald-500" /> Audio
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()} data-testid="menu-video-file">
                <Video className="h-4 w-4 mr-2 text-sky-500" /> Video (Galería)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()} data-testid="menu-document-pdf">
                <FileText className="h-4 w-4 mr-2 text-red-500" /> Documento (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImageInput(!showImageInput)}>
                <ImageIcon className="h-4 w-4 mr-2 text-purple-500" /> Imagen (URL)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDebug(!showDebug)}>
                <Bug className="h-4 w-4 mr-2 text-green-500" /> Debug
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Quick Messages Menu */}
          <Dialog
            open={showQuickMessageDialog}
            onOpenChange={(open) => {
              setShowQuickMessageDialog(open);
              if (!open) resetQuickMessageForm();
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 md:h-10 md:w-10 flex-shrink-0">
                  <Zap className="h-4 w-4 md:h-5 md:w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {quickMessagesData.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">Sin mensajes rápidos</div>
                )}
                {quickMessagesData.map((qm) => (
                  <DropdownMenuItem key={qm.id} className="flex justify-between" onClick={() => handleQuickMessage(qm)}>
                    <span className="truncate">{qm.name}</span>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openQuickMessageEditor(qm);
                        }}
                        aria-label="Editar mensaje rapido"
                        title="Editar"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteQuickMessageMutation.mutate(qm.id);
                        }}
                        aria-label="Eliminar mensaje rapido"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openQuickMessageCreator}>
                    <Plus className="h-4 w-4 mr-2" /> Nuevo mensaje rápido
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingQuickMessageId ? "Editar Mensaje Rapido" : "Nuevo Mensaje Rapido"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Input
                    ref={quickMessageImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleQuickMessageImageFileSelect}
                    data-testid="input-quick-message-image-file"
                    className="file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-500"
                  />
                  {uploadQuickMessageImageMutation.isPending && (
                    <p className="text-xs text-muted-foreground">Subiendo imagen...</p>
                  )}
                  {newQmImageUrl && (
                    <div className="flex items-center gap-2 rounded-md border p-2">
                      <img
                        src={newQmImageUrl}
                        alt="Preview mensaje rapido"
                        className="h-12 w-12 rounded object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <span className="text-xs text-muted-foreground truncate">{newQmImageUrl}</span>
                    </div>
                  )}
                </div>
                <Input placeholder="Nombre (ej: Saludo)" value={newQmName} onChange={(e) => setNewQmName(e.target.value)} />
                <Textarea placeholder="Texto del mensaje" value={newQmText} onChange={(e) => setNewQmText(e.target.value)} rows={3} />
                <Input placeholder="URL de imagen (opcional)" value={newQmImageUrl} onChange={(e) => setNewQmImageUrl(e.target.value)} />
                <Button
                  onClick={saveQuickMessage}
                  disabled={
                    !newQmName.trim() ||
                    uploadQuickMessageImageMutation.isPending ||
                    createQuickMessageMutation.isPending ||
                    updateQuickMessageMutation.isPending
                  }
                >
                  {editingQuickMessageId ? "Actualizar" : "Guardar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Emoji picker */}
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-9 w-9 md:h-10 md:w-10 flex-shrink-0"
                aria-label="Insertar emoji"
                title="Emojis"
              >
                <span className="text-lg leading-none">😊</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3 bg-white border border-[#E8E8E8] shadow-[0_10px_30px_rgba(0,0,0,0.08)] rounded-2xl z-50 text-[#111111]">
              <div className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Emojis rápidos</div>
              <div className="grid grid-cols-5 gap-1.5">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl transition-all duration-150 hover:bg-slate-100 hover:scale-110 active:scale-95"
                    onClick={() => insertEmoji(emoji)}
                    aria-label={`Insertar ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          </div>

          <Textarea
            ref={messageInputRef}
            onInput={(e) => {
              const value = (e.target as HTMLTextAreaElement).value;
              const hasDraft = value.trim().length > 0;
              setHasTextDraft((prev) => (prev === hasDraft ? prev : hasDraft));
              requestAnimationFrame(() => resizeMessageInput());
            }}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            className="flex-1 min-w-0 min-h-[40px] max-h-[200px] md:max-h-[140px] resize-none overflow-hidden border-0 bg-white dark:bg-[#2a3942] rounded-3xl px-3 md:px-4 py-2 text-sm leading-[1.35] focus-visible:ring-0"
            rows={1}
          />

          <Button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={uploadImageMutation.isPending || uploadAudioMutation.isPending || uploadVideoMutation.isPending || uploadDocumentMutation.isPending}
            size="icon"
            variant={isRecording ? "destructive" : "ghost"}
            className={cn("rounded-full h-9 w-9 md:h-10 md:w-10 flex-shrink-0", isRecording && "animate-pulse")}
            data-testid="button-record-audio"
            title={isRecording ? "Detener grabacion" : "Grabar audio"}
          >
            <Mic className="h-4 w-4 md:h-5 md:w-5" />
          </Button>

          <Button
            onClick={() => handleSend()}
            disabled={(!hasTextDraft && !imageUrl && !selectedFile) || isPending || uploadImageMutation.isPending || uploadAudioMutation.isPending || uploadVideoMutation.isPending || uploadDocumentMutation.isPending || isRecording}
            size="icon"
            className="rounded-full h-9 w-9 md:h-10 md:w-10 flex-shrink-0"
          >
            {(uploadImageMutation.isPending || uploadAudioMutation.isPending || uploadVideoMutation.isPending || uploadDocumentMutation.isPending) ? <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" /> : <Send className="h-4 w-4 md:h-5 md:w-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}


