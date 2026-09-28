import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Sparkles, Plus, Trash2, Pencil, Loader2 } from "lucide-react";

interface AdPrompt {
  id: number;
  name: string;
  systemPrompt: string;
  productId: number | null;
  isActive: boolean;
  updatedAt?: string | null;
}

interface ProductItem {
  id: number;
  name: string;
}

const NO_PRODUCT = "__none__";

export function AdPromptsModal() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [productId, setProductId] = useState(NO_PRODUCT);
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: prompts = [], isLoading } = useQuery<AdPrompt[]>({
    queryKey: ["/api/ad-prompts"],
    enabled: isAdmin && open,
  });
  const { data: products = [] } = useQuery<ProductItem[]>({
    queryKey: ["/api/products"],
    enabled: isAdmin && open,
  });

  const resetForm = () => {
    setName("");
    setSystemPrompt("");
    setProductId(NO_PRODUCT);
    setIsActive(true);
    setEditingId(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Ingrese un nombre para el prompt");
      const payload = {
        name: cleanName,
        systemPrompt,
        productId: productId === NO_PRODUCT ? null : Number(productId),
        isActive,
      };
      return apiRequest(
        editingId ? "PATCH" : "POST",
        editingId ? `/api/ad-prompts/${editingId}` : "/api/ad-prompts",
        payload,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-prompts"] });
      const wasEditing = Boolean(editingId);
      resetForm();
      toast({ title: wasEditing ? "Prompt actualizado" : "Prompt creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: String(err?.message || "No se pudo guardar"), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ad-prompts/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-prompts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-routing-rules"] });
      toast({ title: "Prompt eliminado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: String(err?.message || "No se pudo eliminar"), variant: "destructive" });
    },
  });

  const startEdit = (p: AdPrompt) => {
    setEditingId(p.id);
    setName(p.name);
    setSystemPrompt(p.systemPrompt);
    setProductId(p.productId == null ? NO_PRODUCT : String(p.productId));
    setIsActive(p.isActive);
  };

  const productName = (id: number | null) =>
    id == null ? "Sin producto" : products.find((p) => p.id === id)?.name || `Producto ${id}`;

  const formContent = (
    <div className="space-y-3">
      <div className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-300">Nombre del prompt</Label>
          <Input
            placeholder="Ej: Berberina - anuncio principal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
            data-testid="input-ad-prompt-name"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-300">Producto (opcional)</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="bg-slate-800/50 border-slate-600/50 text-white text-xs">
              <SelectValue placeholder="Sin producto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PRODUCT}>Sin producto</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-300">Prompt (texto para la IA)</Label>
          <Textarea
            placeholder="Escribe aqui el prompt que usara la IA para los leads de este anuncio..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500 font-mono text-xs"
            data-testid="input-ad-prompt-text"
          />
          <p className="text-[11px] text-slate-500">{systemPrompt.length} caracteres</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label className="text-xs text-slate-300">Activo</Label>
          </div>
          <div className="flex items-center gap-2">
            {editingId && (
              <Button size="sm" variant="outline" onClick={resetForm} className="border-slate-600 text-slate-300">
                Cancelar
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white"
              data-testid="button-save-ad-prompt"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {editingId ? "Actualizar" : "Crear prompt"}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        ) : prompts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">Sin prompts creados.</p>
        ) : (
          prompts.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{p.name}</p>
                <p className="truncate text-xs text-slate-400">
                  {productName(p.productId)} {p.isActive ? "· Activo" : "· Inactivo"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(p)}
                className="text-slate-400 transition-colors hover:text-cyan-300"
                aria-label="Editar prompt"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Eliminar prompt "${p.name}"?`)) deleteMutation.mutate(p.id);
                }}
                disabled={deleteMutation.isPending}
                className="text-slate-400 transition-colors hover:text-red-400 disabled:opacity-50"
                aria-label="Eliminar prompt"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (!isAdmin) return null;

  const trigger = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="border-violet-500/35 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20 hover:text-white"
      data-testid="button-ad-prompts"
    >
      <Sparkles className="h-4 w-4 mr-2" />
      Prompts
    </Button>
  );

  const description = "Crea prompts y luego asignalos a cada ID de anuncio. El prompt del anuncio reemplaza al global.";

  if (isMobile) {
    return (
      <>
        {trigger}
        <Drawer
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) resetForm();
          }}
        >
          <DrawerContent className="max-h-[92vh] overflow-y-auto border-slate-700/50 bg-slate-900 text-white">
            <DrawerHeader className="text-left">
              <DrawerTitle className="text-white">Prompts por anuncio</DrawerTitle>
              <DrawerDescription className="text-slate-400">{description}</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-8">{formContent}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto border-slate-700/50 bg-slate-900 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Prompts por anuncio</DialogTitle>
            <DialogDescription className="text-slate-400">{description}</DialogDescription>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    </>
  );
}
