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

export function AdPromptsModal({ embedded = false }: { embedded?: boolean }) {
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
  const [search, setSearch] = useState("");
  const [saveError, setSaveError] = useState("");

  const { data: prompts = [], isLoading, isError: promptsLoadError, refetch: reloadPrompts } = useQuery<AdPrompt[]>({
    queryKey: ["/api/ad-prompts"],
    enabled: isAdmin && (open || embedded),
  });
  const { data: products = [] } = useQuery<ProductItem[]>({
    queryKey: ["/api/products"],
    enabled: isAdmin && (open || embedded),
  });

  const resetForm = () => {
    setName("");
    setSystemPrompt("");
    setProductId(NO_PRODUCT);
    setIsActive(true);
    setEditingId(null);
    setSaveError("");
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
      if (cleanName.length > 120) throw new Error("El nombre admite hasta 120 caracteres.");
      if (systemPrompt.length > 40000) throw new Error("El prompt admite hasta 40000 caracteres. Su texto sigue en el editor.");
      setSaveError("");
      const response = await apiRequest(
        editingId ? "PATCH" : "POST",
        editingId ? `/api/ad-prompts/${editingId}` : "/api/ad-prompts",
        payload,
      );
      return await response.json() as AdPrompt;
    },
    onSuccess: async (saved) => {
      const wasEditing = Boolean(editingId);
      queryClient.setQueryData<AdPrompt[]>(["/api/ad-prompts"], (previous = []) =>
        [saved, ...previous.filter((p) => p.id !== saved.id)]);
      setEditingId(saved.id);
      setName(saved.name);
      setSystemPrompt(saved.systemPrompt);
      setProductId(saved.productId == null ? NO_PRODUCT : String(saved.productId));
      setIsActive(saved.isActive);
      setSearch("");
      setSaveError("");
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-prompts"] });
      toast({ title: wasEditing ? "Prompt actualizado" : "Prompt creado" });
    },
    onError: (err: any) => {
      setSaveError(String(err?.message || "No se pudo guardar"));
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

  const savedPrompt = prompts.find((p) => p.id === editingId);
  const hasDraftChanges = editingId !== null
    ? Boolean(savedPrompt && (name !== savedPrompt.name || systemPrompt !== savedPrompt.systemPrompt || productId !== (savedPrompt.productId == null ? NO_PRODUCT : String(savedPrompt.productId)) || isActive !== savedPrompt.isActive))
    : Boolean(name || systemPrompt || productId !== NO_PRODUCT || !isActive);
  const mayLeaveDraft = () => !saveMutation.isPending && (!hasDraftChanges || window.confirm("Hay cambios sin guardar. Desea descartarlos?"));

  const startEdit = (p: AdPrompt) => {
    if (saveMutation.isPending || p.id === editingId || !mayLeaveDraft()) return;
    setSaveError("");
    setEditingId(p.id);
    setName(p.name);
    setSystemPrompt(p.systemPrompt);
    setProductId(p.productId == null ? NO_PRODUCT : String(p.productId));
    setIsActive(p.isActive);
  };

  const productName = (id: number | null) =>
    id == null ? "Sin producto" : products.find((p) => p.id === id)?.name || `Producto ${id}`;

  const normalizedSearch = search.trim().toLowerCase();
  const filteredPrompts = prompts.filter(
    (p) =>
      !normalizedSearch ||
      p.name.toLowerCase().includes(normalizedSearch) ||
      p.systemPrompt.toLowerCase().includes(normalizedSearch),
  );
  const groupMap = new Map<string, { key: string; label: string; items: AdPrompt[] }>();
  for (const p of filteredPrompts) {
    const key = p.productId == null ? "__none__" : String(p.productId);
    const label = p.productId == null ? "Sin producto" : productName(p.productId);
    if (!groupMap.has(key)) groupMap.set(key, { key, label, items: [] });
    groupMap.get(key)!.items.push(p);
  }
  const groupedPrompts = Array.from(groupMap.values()).sort((a, b) => {
    if (a.key === "__none__") return 1;
    if (b.key === "__none__") return -1;
    return a.label.localeCompare(b.label);
  });

  const formContent = (
    <div className="grid items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3 md:max-h-[72vh] overflow-y-auto md:sticky md:top-0">
        <Button variant="outline" onClick={() => { if (mayLeaveDraft()) resetForm(); }} className="w-full border-slate-600 text-white"><Plus className="h-4 w-4 mr-2" />Nuevo prompt</Button>


      <Input
        placeholder="Buscar prompt..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
        data-testid="input-search-ad-prompt"
      />
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        ) : promptsLoadError ? (
          <div role="alert" className="text-sm text-amber-300">No se pudo actualizar la lista de prompts.
            <Button variant="outline" onClick={() => reloadPrompts()}>Reintentar</Button>
          </div>
        ) : prompts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">Sin prompts creados.</p>
        ) : filteredPrompts.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">Sin resultados para "{search}".</p>
        ) : (
          groupedPrompts.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center justify-between border-b border-slate-700/40 pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">{group.label}</p>
                <span className="text-[11px] text-slate-500">{group.items.length}</span>
              </div>
              {group.items.map((p) => (
                <div key={p.id} className={`rounded-lg border px-3 py-3 ${editingId === p.id ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-700/50 bg-slate-900/40"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${p.isActive ? "bg-emerald-400" : "bg-slate-600"}`} />
                    <button type="button" onClick={() => startEdit(p)} aria-pressed={editingId === p.id} className="min-w-0 flex-1 text-left text-sm font-medium text-white break-words">{p.name}</button>
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
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                    {p.systemPrompt.trim() ? p.systemPrompt.slice(0, 160) : "(sin texto)"}
                  </p>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      </aside>
      <fieldset disabled={saveMutation.isPending} className="min-w-0 space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
        <div role="status" className="text-sm text-slate-300">{saveMutation.isPending ? "Guardando..." : hasDraftChanges ? "Cambios sin guardar" : editingId ? "Guardado" : "Nuevo prompt: complete los datos y pulse Crear prompt"}</div>
        {saveError && <p role="alert" className="text-sm text-red-300">{saveError}</p>}
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
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
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
            rows={22}
            className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500 text-sm leading-7 p-4 h-[50vh] min-h-[300px] resize-y"
            data-testid="input-ad-prompt-text"
          />
          <p className="text-[11px] text-slate-500">{systemPrompt.length} caracteres</p>
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 bg-slate-900 py-3 border-t border-slate-700">
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label className="text-xs text-slate-300">Habilitado</Label>
          </div>
          <div className="flex items-center gap-2">
            {editingId && (
              <Button size="sm" variant="outline" onClick={() => { if (mayLeaveDraft()) resetForm(); }} className="border-slate-600 text-slate-300">
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
      </fieldset>
    </div>
  );

  if (!isAdmin) return null;

  if (embedded) return <section aria-label="Prompts de anuncios" className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 md:p-5"><h3 className="mb-2 font-semibold text-white">Prompts de anuncios</h3><p className="mb-5 text-sm text-slate-400">Cree y edite sus prompts. Asigne cada uno desde las reglas de anuncios. Los chats existentes conservan su copia.</p>{formContent}</section>;

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
            if (!o && !mayLeaveDraft()) return;
            setOpen(o);
            if (!o) resetForm();
          }}
        >
          <DrawerContent className="flex max-h-[90vh] flex-col overflow-hidden border-slate-700/50 bg-slate-900 text-white">
            <DrawerHeader className="shrink-0 text-left">
              <DrawerTitle className="text-white">Prompts por anuncio</DrawerTitle>
              <DrawerDescription className="text-slate-400">{description}</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">{formContent}</div>
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
          if (!o && !mayLeaveDraft()) return;
          setOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto border-slate-700/50 bg-slate-900 text-white sm:max-w-6xl w-[95vw]">
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
