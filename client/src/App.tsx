import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const AIAgentPage = lazy(() => import("@/pages/AIAgentPage"));
const FollowUpPage = lazy(() => import("@/pages/FollowUpPage"));
const RemindersPage = lazy(() => import("@/pages/RemindersPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const AnalyticsCalendarPage = lazy(() => import("@/pages/AnalyticsCalendarPage"));
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const AdminAccessPage = lazy(() => import("@/pages/AdminAccessPage"));
const AgentAiPage = lazy(() => import("@/pages/AgentAiPage"));
const PushSettingsPage = lazy(() => import("@/pages/PushSettingsPage"));
const ReportPage = lazy(() => import("@/pages/ReportPage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const DataDeletionPage = lazy(() => import("@/pages/DataDeletionPage"));
const NotFound = lazy(() => import("@/pages/not-found"));

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return <Component />;
  }

  if (!user) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }

  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isAdmin } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return null;

  if (!user) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }

  if (!isAdmin) {
    setTimeout(() => setLocation("/"), 0);
    return null;
  }

  return <Component />;
}

function PrimaryAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isPrimaryAdmin } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return null;

  if (!user) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }

  if (!isPrimaryAdmin) {
    setTimeout(() => setLocation("/"), 0);
    return null;
  }

  return <Component />;
}

function AgentRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isAgent } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return null;

  if (!user) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }

  if (!isAgent) {
    setTimeout(() => setLocation("/"), 0);
    return null;
  }

  return <Component />;
}

function Router() {
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/privacy-policy" component={PrivacyPolicyPage} />
        <Route path="/data-deletion" component={DataDeletionPage} />
        <Route path="/ai-agent">
          <AdminRoute component={AIAgentPage} />
        </Route>
        <Route path="/follow-up">
          <AdminRoute component={FollowUpPage} />
        </Route>
        <Route path="/reminders">
          <ProtectedRoute component={RemindersPage} />
        </Route>
        <Route path="/analytics/calendar">
          <ProtectedRoute component={AnalyticsCalendarPage} />
        </Route>
        <Route path="/analytics">
          <ProtectedRoute component={AnalyticsPage} />
        </Route>
        <Route path="/agent-ai">
          <AgentRoute component={AgentAiPage} />
        </Route>
        <Route path="/push-settings">
          <ProtectedRoute component={PushSettingsPage} />
        </Route>
        <Route path="/agents">
          <AdminRoute component={AgentsPage} />
        </Route>
        <Route path="/report">
          <ProtectedRoute component={ReportPage} />
        </Route>
        <Route path="/access">
          <PrimaryAdminRoute component={AdminAccessPage} />
        </Route>
        <Route path="/">
          <ProtectedRoute component={InboxPage} />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function OneSignalIdentitySync() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;

    const syncIdentity = async () => {
      const oneSignalWindow = window as typeof window & {
        oneSignalReady?: boolean;
        oneSignalClient?: {
          login?: (externalId: string) => Promise<void>;
          logout?: () => Promise<void>;
        } | null;
        oneSignalInitPromise?: Promise<unknown> | null;
        oneSignalExternalId?: string | null;
      };

      if (!oneSignalWindow.oneSignalReady && oneSignalWindow.oneSignalInitPromise) {
        try {
          await Promise.race([
            oneSignalWindow.oneSignalInitPromise,
            new Promise((resolve) => setTimeout(resolve, 8000)),
          ]);
        } catch (error) {
          console.error("[OneSignal] Identity sync init error:", error);
        }
      }

      if (cancelled) return;

      const client = oneSignalWindow.oneSignalClient;
      if (!oneSignalWindow.oneSignalReady || !client) return;

      const nextExternalId =
        user?.role === "agent" && typeof user.agentId === "number"
          ? `agent:${user.agentId}`
          : user?.role === "admin"
            ? "admin:global"
            : null;

      if (nextExternalId) {
        if (oneSignalWindow.oneSignalExternalId === nextExternalId) return;
        try {
          if (typeof client.login === "function") {
            await client.login(nextExternalId);
            oneSignalWindow.oneSignalExternalId = nextExternalId;
          }
        } catch (error) {
          console.error("[OneSignal] Failed to sync agent identity:", error);
        }
        return;
      }

      if (!oneSignalWindow.oneSignalExternalId) return;

      try {
        if (typeof client.logout === "function") {
          await client.logout();
        }
      } catch (error) {
        console.error("[OneSignal] Failed to clear identity:", error);
      } finally {
        oneSignalWindow.oneSignalExternalId = null;
      }
    };

    void syncIdentity();

    return () => {
      cancelled = true;
    };
  }, [isLoading, user?.role, user?.agentId]);

  return null;
}

function App() {
  // Efecto ripple (onda) tipo WhatsApp/Telegram en todos los botones del sistema.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const host = target?.closest?.(".active-elevate-2, .press-ripple") as HTMLElement | null;
      if (!host || host.getAttribute("data-no-ripple") === "true") return;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      host.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 480);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OneSignalIdentitySync />
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
