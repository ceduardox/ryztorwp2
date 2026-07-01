import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { SendMessageRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const POLL_INTERVAL = 5000;

export function useConversations(limit?: number, before?: string, search?: string) {
  return useQuery({
    queryKey: [api.conversations.list.path, limit, before ?? null, search ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeof limit === "number") params.set("limit", String(limit));
      if (before) params.set("before", before);
      if (search) params.set("q", search);
      const qs = params.toString();
      const url = qs ? `${api.conversations.list.path}?${qs}` : api.conversations.list.path;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return api.conversations.list.responses[200].parse(await res.json());
    },
    placeholderData: (previousData) => previousData,
    refetchInterval: POLL_INTERVAL,
    staleTime: 5 * 1000,
  });
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: [api.conversations.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("No id provided");
      const url = buildUrl(api.conversations.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return api.conversations.get.responses[200].parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL,
    staleTime: 10 * 1000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: SendMessageRequest) => {
      const res = await fetch(api.messages.send.path, {
        method: api.messages.send.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json();
        const errorInfo = errorData.error;
        if (errorInfo) {
          throw new Error(`[${errorInfo.code}] ${errorInfo.details}`);
        }
        throw new Error(errorData.message || "Failed to send message");
      }
      return api.messages.send.responses[200].parse(await res.json());
    },
    onMutate: async (variables) => {
      // Snapshot previous list data and get query keys
      const listQueryKey = [api.conversations.list.path];
      
      // Cancel list queries to avoid overwrites
      await queryClient.cancelQueries({ queryKey: listQueryKey });
      
      const previousList = queryClient.getQueryData<any[]>(listQueryKey) || [];
      const conv = previousList.find((c: any) => c.waId === variables.to);
      
      let previousGet = null;
      let getQueryKey = null;

      if (conv) {
        getQueryKey = [api.conversations.get.path, conv.id];
        await queryClient.cancelQueries({ queryKey: getQueryKey });
        previousGet = queryClient.getQueryData<any>(getQueryKey);

        const textPreview = variables.type === "image" ? "[image]" : (variables.text || "");
        const tempId = -Date.now();

        // 1. Optimistic update for active conversation messages
        if (previousGet) {
          const optimisticMsg = {
            id: tempId,
            conversationId: conv.id,
            waMessageId: `temp_${Date.now()}`,
            direction: "out",
            type: variables.type,
            text: variables.type === "image" ? (variables.caption || null) : (variables.text || null),
            mediaId: null,
            mimeType: null,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            status: "sending",
            rawJson: null,
            createdAt: new Date().toISOString()
          };

          queryClient.setQueryData(getQueryKey, {
            ...previousGet,
            messages: [...previousGet.messages, optimisticMsg]
          });
        }

        // 2. Optimistic update for Kanban/sidebar conversation list
        const updatedList = previousList.map((c: any) => {
          if (c.id === conv.id) {
            return {
              ...c,
              lastMessage: textPreview,
              lastMessageTimestamp: new Date().toISOString()
            };
          }
          return c;
        });
        queryClient.setQueryData(listQueryKey, updatedList);
      }

      return { previousGet, getQueryKey, previousList, listQueryKey };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.conversations.get.path] });
      queryClient.invalidateQueries({ queryKey: [api.conversations.list.path] });
    },
    onError: (error, variables, context: any) => {
      // Rollback active conversation cache
      if (context?.getQueryKey && context?.previousGet) {
        queryClient.setQueryData(context.getQueryKey, context.previousGet);
      }
      // Rollback conversation list cache (Kanban)
      if (context?.listQueryKey && context?.previousList) {
        queryClient.setQueryData(context.listQueryKey, context.previousList);
      }
      toast({
        title: "Error al enviar",
        description: error.message,
        variant: "destructive",
        duration: 10000,
      });
    },
  });
}
