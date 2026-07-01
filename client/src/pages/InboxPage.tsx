import { useState, useMemo } from "react";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useConversation, useConversations } from "@/hooks/use-inbox";
import { NotificationBell } from "@/components/NotificationBell";
import { KanbanView } from "@/components/KanbanView";
import { Button } from "@/components/ui/button";
import { LogOut, Bot, BotOff, ClipboardList, LayoutGrid, Sparkles, MessageSquare, Zap, Activity, BarChart3, Search, X, Users, Bell, Clock, EllipsisVertical, KeyRound, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const pulseLineAnimation = `
@keyframes pulse-line {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.animate-pulse-line { animation: pulse-line 3s ease-in-out infinite; }
`;

export default function InboxPage() {
  const INITIAL_VISIBLE_CONVERSATIONS = 50;
  const LOAD_MORE_STEP = 20;
  const MAX_SERVER_LIMIT = 5000;
  const { logout, user, isAdmin, isPrimaryAdmin } = useAuth();
  const [daysToShow, setDaysToShow] = useState(0);
  const [location, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleConversations, setVisibleConversations] = useState(INITIAL_VISIBLE_CONVERSATIONS);
  const maxDays = 30;
  const iaHref = isAdmin ? "/ai-agent" : "/agent-ai";
  const serverLimit = useMemo(
    () => {
      const query = searchQuery.trim();
      if (query) {
        return Math.min(Math.max(visibleConversations, 200), MAX_SERVER_LIMIT);
      }
      // Keep enough backlog so operational columns can show their own 50 (+20) cards.
      return Math.min(Math.max(visibleConversations * 6, 120), MAX_SERVER_LIMIT);
    },
    [searchQuery, visibleConversations],
  );
  
  const urlConversationId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get("conversationId");
    if (!rawId) return null;
    const conversationId = Number(rawId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
    return conversationId;
  }, [location]);

  const { data: forcedConversationData } = useConversation(urlConversationId);
  const forcedConversation = forcedConversationData?.conversation ?? null;

  const { data: conversations = [], isLoading: loadingList } = useConversations(
    serverLimit,
    undefined,
    searchQuery.trim() || undefined,
  );

  const filteredByRangeAndSearch = useMemo(() => {
    const now = new Date();
    const cutoff = daysToShow > 0
      ? new Date(now.getTime() - daysToShow * 24 * 60 * 60 * 1000)
      : null;
    const query = searchQuery.toLowerCase().trim();
    const merged = forcedConversation && !conversations.some((c) => c.id === forcedConversation.id)
      ? [forcedConversation, ...conversations]
      : conversations;

    const filtered = merged.filter((c) => {
      if (query) {
        const nameMatch = c.contactName?.toLowerCase().includes(query);
        const messageMatch = c.lastMessage?.toLowerCase().includes(query);
        const phoneMatch = c.waId?.includes(query);
        return nameMatch || messageMatch || phoneMatch;
      }

      if (c.orderStatus === "pending" || c.orderStatus === "ready" || c.orderStatus === "delivered") {
        return true;
      }

      if (!cutoff || !c.lastMessageTimestamp) return true;
      return new Date(c.lastMessageTimestamp) >= cutoff;
    });

    if (forcedConversation && !filtered.some((c) => c.id === forcedConversation.id)) {
      return [forcedConversation, ...filtered];
    }

    return filtered;
  }, [conversations, daysToShow, searchQuery, forcedConversation]);

  const serverHasMoreConversations = conversations.length >= serverLimit;
  const hasHiddenColumnsByLimit = useMemo(() => {
    const limit = Math.max(1, visibleConversations);
    let humano = 0;
    let nuevo = 0;
    let llamar = 0;
    let pending = 0;
    let ready = 0;
    let delivered = 0;

    for (const conversation of filteredByRangeAndSearch) {
      if (conversation.needsHumanAttention) {
        humano++;
      } else if (conversation.orderStatus === "pending") {
        pending++;
      } else if (conversation.orderStatus === "ready") {
        ready++;
      } else if (conversation.orderStatus === "delivered") {
        delivered++;
      } else if (conversation.shouldCall) {
        llamar++;
      } else {
        nuevo++;
      }

      if (
        humano > limit ||
        nuevo > limit ||
        llamar > limit ||
        pending > limit ||
        ready > limit ||
        delivered > limit
      ) {
        return true;
      }
    }

    return false;
  }, [filteredByRangeAndSearch, visibleConversations]);
  const hasMoreConversations = serverHasMoreConversations || hasHiddenColumnsByLimit;

  useEffect(() => {
    setVisibleConversations(INITIAL_VISIBLE_CONVERSATIONS);
  }, [daysToShow, searchQuery]);

  const handleLoadMore = () => {
    setVisibleConversations((count) => count + LOAD_MORE_STEP);
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-900 text-foreground flex flex-col">
      <style dangerouslySetInnerHTML={{ __html: pulseLineAnimation }} />
      
      {/* Desktop Header - Futuristic */}
      <div className="hidden md:flex items-center justify-between px-5 py-3 bg-slate-800/80 backdrop-blur-lg flex-shrink-0 border-b border-emerald-500/20 relative overflow-hidden">
        {/* Animated line effect */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-pulse-line" />
        
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white flex items-center gap-2">
              Ryztor Agent <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">IA</span>
              <Zap className="h-4 w-4 text-yellow-400" />
            </h1>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <Activity className="h-3 w-3 text-emerald-400" />
              Sistema activo
            </p>
          </div>
        </div>
        
        {/* Search Bar */}
        <div className="flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por nombre, mensaje o telefono..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-8 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500/20"
              data-testid="input-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Link href="/push-settings">
            <Button variant="ghost" size="icon" title="Push" data-testid="button-push-settings-desktop" className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10">
              <Bell className="h-5 w-5" />
            </Button>
          </Link>
          <Link href="/analytics">
            <Button variant="ghost" size="icon" title="Analytics" data-testid="button-analytics-desktop" className="text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10">
              <BarChart3 className="h-5 w-5" />
            </Button>
          </Link>
          <Link href="/report">
            <Button variant="ghost" size="icon" title="Informe" data-testid="button-report-desktop" className="text-slate-400 hover:text-amber-300 hover:bg-amber-500/10">
              <FileText className="h-5 w-5" />
            </Button>
          </Link>
          {isAdmin && (
            <>
              <Link href="/follow-up">
                <Button variant="ghost" size="icon" title="Seguimiento" data-testid="button-follow-up-desktop" className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10">
                  <ClipboardList className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/agents">
                <Button variant="ghost" size="icon" title="Agentes" data-testid="button-agents-desktop" className="text-slate-400 hover:text-violet-400 hover:bg-violet-500/10">
                  <Users className="h-5 w-5" />
                </Button>
              </Link>
              {isPrimaryAdmin && (
                <Link href="/access">
                  <Button variant="ghost" size="icon" title="Accesos" data-testid="button-access-desktop" className="text-slate-400 hover:text-amber-400 hover:bg-amber-500/10">
                    <KeyRound className="h-5 w-5" />
                  </Button>
                </Link>
              )}
            </>
          )}
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <Link href={iaHref}>
            <Button variant="ghost" size="icon" title="IA" data-testid="button-ai-desktop" className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10">
              <Bot className="h-5 w-5" />
            </Button>
          </Link>
          <Link href="/reminders">
            <Button variant="ghost" size="icon" title="Recordatorios" data-testid="button-reminders-desktop" className="text-slate-400 hover:text-amber-400 hover:bg-amber-500/10">
              <Clock className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600">
            <div className="h-2 w-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-sm text-slate-300 font-medium">{user?.username}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()} title="Logout" className="text-slate-400 hover:text-red-400 hover:bg-red-500/10">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
      {/* Kanban View - responsive para movil y desktop */}
      <div className="flex flex-1 min-h-0 pb-14 md:pb-0">
        <KanbanView
          conversations={filteredByRangeAndSearch}
          isLoading={loadingList}
          daysToShow={daysToShow}
          onDaysChange={setDaysToShow}
          onLoadMore={handleLoadMore}
          hasMoreConversations={hasMoreConversations}
          maxDays={maxDays}
          columnVisibleLimit={visibleConversations}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClearSearch={() => setSearchQuery("")}
        />
      </div>
      {!loadingList && hasMoreConversations && (
        <div className="hidden md:flex justify-center px-3 py-2 border-t border-slate-700/40 bg-slate-900/80">
          <Button
            onClick={handleLoadMore}
            variant="outline"
            className="h-9 border-slate-600 text-slate-200 hover:bg-slate-800"
            data-testid="button-load-more-conversations"
          >
            Ver mas (+20)
          </Button>
        </div>
      )}
      {/* Mobile Bottom Navigation - Futuristic */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-emerald-500/20 flex justify-around items-center py-2 px-1 z-50">
        <Link href="/">
          <button className={`flex flex-col items-center px-3 py-1.5 rounded-xl transition-all ${location === '/' ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-500'}`}>
            <LayoutGrid className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">Inbox</span>
          </button>
        </Link>
        <Link href={iaHref}>
          <button className={`flex flex-col items-center px-3 py-1.5 rounded-xl transition-all ${location === iaHref ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-500'}`}>
            <Bot className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">IA</span>
          </button>
        </Link>
        <Link href="/analytics">
          <button className={`flex flex-col items-center px-3 py-1.5 rounded-xl transition-all ${location === '/analytics' ? 'text-cyan-400 bg-cyan-500/20' : 'text-slate-500'}`}>
            <BarChart3 className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">Stats</span>
          </button>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`flex flex-col items-center px-3 py-1.5 rounded-xl transition-all ${(location === '/reminders' || location === '/push-settings' || location === '/follow-up' || location === '/agents' || location === '/access' || location === '/report') ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-500'}`}>
              <EllipsisVertical className="h-5 w-5" />
              <span className="text-[10px] mt-0.5 font-medium">Mas</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="mb-2 w-48 bg-slate-900 border-slate-700 text-slate-200">
            <DropdownMenuItem onClick={() => setLocation("/report")} className="focus:bg-slate-800">
              <FileText className="h-4 w-4 mr-2 text-amber-300" />
              Informe
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocation("/reminders")} className="focus:bg-slate-800">
              <Clock className="h-4 w-4 mr-2 text-amber-400" />
              Recordatorios
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocation("/push-settings")} className="focus:bg-slate-800">
              <Bell className="h-4 w-4 mr-2 text-emerald-400" />
              Push
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onClick={() => setLocation("/follow-up")} className="focus:bg-slate-800">
                <ClipboardList className="h-4 w-4 mr-2 text-emerald-400" />
                Seguimiento
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <DropdownMenuItem onClick={() => setLocation("/agents")} className="focus:bg-slate-800">
                <Users className="h-4 w-4 mr-2 text-violet-400" />
                Agentes
              </DropdownMenuItem>
            )}
            {isPrimaryAdmin && (
              <DropdownMenuItem onClick={() => setLocation("/access")} className="focus:bg-slate-800">
                <KeyRound className="h-4 w-4 mr-2 text-amber-400" />
                Accesos
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => logout()} className="focus:bg-slate-800">
              <LogOut className="h-4 w-4 mr-2 text-red-400" />
              Salir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}





