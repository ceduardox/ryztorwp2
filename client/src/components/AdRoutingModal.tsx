import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Megaphone, Plus, Trash2, Pencil, Loader2 } from "lucide-react";

interface AdRoutingRule {
  id: number;
  adId: string;
  agentIds: number[];
  isActive: boolean;
  isExclusive: boolean;
  productRoute: string | null;
  updatedAt?: string | null;
}

interface AgentItem {
  id: number;
  name: string;
  isActive?: boolean;
}

const AD_PRODUCT_ROUTE_OPTIONS = [
  { value: "diabetes", label: "Berberina" },
  { value: "diabetes_y_peso", label: "Berberina + Bitter Melon" },
  { value: "dolor_y_estres", label: "Citrato de Magnesio" },
  { value: "dolor_articular", label: "Boswellia Serrata" },
] as const;

function getAdProductRouteLabel(route?: string | null): string {
  return AD_PRODUCT_ROUTE_OPTIONS.find((o) => o.value === route)?.label || "Sin producto";
}

export function AdRoutingModal() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [adId, setAdId] = useState("");
  const [productRoute, setProductRoute] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: rules = [], isLoading: rulesLoading } = useQuery<AdRoutingRule[]>({
    queryKey: ["/api/ad-routing-rules"],
    enabled: isAdmin && open,
  });
  const { data: agents = [] } = useQuery<AgentItem[]>({
    queryKey: ["/api/agents"],
    enabled: isAdmin && open,
  });

  const activeAgentIds = agents.filter((a) => a.isActive !== false).map((a) => a.id);

  const resetForm = () => {
    setAdId("");
    setProductRoute("");
    setIsActive(true);
    setEditingId(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanAdId = adId.trim();
      if (!cleanAdId) throw new Error("Ingrese el ad_id");
      if (activeAgentIds.length === 0) throw new Error("No hay agentes activos disponibles");
      const payload = {
        adId: cleanAdId,
        agentIds: activeAgentIds,
        isActive,
        productRoute: productRoute || null,
      };
      return apiRequest(
        editingId ? "PATCH" : "PUT",
        editingId ? `/api/ad-routing-rules/${editingId}` : "/api/ad-routing-rules",
        payload,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-routing-rules"] });
      resetForm();
      toast({ title: editingId ? "Regla actualizada" : "Ad ID guardado" });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: String(err?.message || "No se pudo guardar"),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ad-routing-rules/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ad-routing-rules"] });
      toast({ title: "Regla eliminada" });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: String(err?.message || "No se pudo eliminar"),
        variant: "destructive",
      });
    },
  });

  const startEdit = (rule: AdRoutingRule) => {
    setEditingId(rule.id);
    setAdId(rule.adId);
    setProductRoute(rule.productRoute || "");
    setIsActive(rule.isActive);
  };

  const formContent = (
    <div className="space-y-3">
      <div className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">ad_id (Meta Ads)</Label>
            <Input
              placeholder="Ej: 123456789012345"
              value={adId}
              onChange={(e) => setAdId(e.target.value)}
              className="bg-slate-800/50 border-slate-600/50 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Producto</Label>
            <Select value={productRoute} onValueChange={setProductRoute}>
              <SelectTrigger className="bg-slate-800/50 border-slate-600/50 text-white text-xs">
                <SelectValue placeholder="Elegir..." />
              </SelectTrigger>
              <SelectContent>
                {AD_PRODUCT_ROUTE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label className="text-xs text-slate-300">Activo</Label>
          </div>
          <div className="flex items-center gap-2">
            {editingId && (
              <Button
                size="sm"
                variant="outline"
                onClick={resetForm}
                className="border-slate-600 text-slate-300"
              >
                Cancelar
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || activeAgentIds.length === 0}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              {editingId ? "Actualizar" : "Guardar"}
            </Button>
          </div>
        </div>
        {activeAgentIds.length === 0 && (
          <p className="text-xs text-amber-400/80">
            No hay agentes activos. Crea o activa un agente para guardar ad_ids.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {rulesLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">Sin ad_ids registrados.</p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{rule.adId}</p>
                <p className="text-xs text-slate-400">
                  {getAdProductRouteLabel(rule.productRoute)} {rule.isActive ? "· Activo" : "· Inactivo"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(rule)}
                className="text-slate-400 transition-colors hover:text-cyan-300"
                aria-label="Editar ad_id"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Eliminar ad_id ${rule.adId}?`)) deleteMutation.mutate(rule.id);
                }}
                disabled={deleteMutation.isPending}
                className="text-slate-400 transition-colors hover:text-red-400 disabled:opacity-50"
                aria-label="Eliminar ad_id"
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
      className="border-cyan-500/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20 hover:text-white"
      data-testid="button-ad-routing"
    >
      <Megaphone className="h-4 w-4 mr-2" />
      ID Anuncios
    </Button>
  );

  const sharedDescription =
    "Vincula el ad_id de Meta Ads con un producto para que la IA sepa de qué anuncio llega cada cliente.";

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
              <DrawerTitle className="text-white">ID Anuncios</DrawerTitle>
              <DrawerDescription className="text-slate-400">{sharedDescription}</DrawerDescription>
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
        <DialogContent className="max-h-[88vh] overflow-y-auto border-slate-700/50 bg-slate-900 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">ID Anuncios</DialogTitle>
            <DialogDescription className="text-slate-400">{sharedDescription}</DialogDescription>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    </>
  );
}
