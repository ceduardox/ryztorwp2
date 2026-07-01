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
    onMutate: async (variables: SendMessageRequest) => {
      // Find the active query data for the get conversation endpoint by prefix matching
      const getQueries = queryClient.getQueriesData<{ conversation: any; messages: any[] }>({
        queryKey: [api.conversations.get.path]
      });
      const match = getQueries.find(([_, val]) => val?.conversation?.waId === variables.to);

      let queryKeyToInvalidate: any = null;
      let previousData: any = null;

      if (match) {
        const targetQueryKey = match[0];
        queryKeyToInvalidate = targetQueryKey;

        // Cancel outgoing refetches for this specific conversation
        await queryClient.cancelQueries({ queryKey: targetQueryKey });

        // Snapshot the previous data for rollback
        previousData = queryClient.getQueryData(targetQueryKey);

        // Optimistically insert the new message
        queryClient.setQueryData(targetQueryKey, (old: any) => {
          if (!old) return old;
          const tempMsg = {
            id: -Date.now(),
            conversationId: old.conversation.id,
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

          return {
            ...old,
            conversation: {
              ...old.conversation,
              lastMessage: variables.type === "image" ? "[image]" : (variables.text || ""),
              lastMessageTimestamp: new Date().toISOString()
            },
            messages: [...old.messages, tempMsg]
          };
        });
      }

      // Snapshot all active lists query data before making edits
      const listQueries = queryClient.getQueriesData<any[]>({
        queryKey: [api.conversations.list.path]
      });
      const previousLists = listQueries.map(([key, data]) => ({ key, data }));

      // Cancel all active lists queries
      await queryClient.cancelQueries({ queryKey: [api.conversations.list.path] });

      // Optimistically update the last message and timestamp in all active list caches
      queryClient.setQueriesData<any[]>({ queryKey: [api.conversations.list.path] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((c: any) => {
          if (c.waId === variables.to) {
            return {
              ...c,
              lastMessage: variables.type === "image" ? "[image]" : (variables.text || ""),
              lastMessageTimestamp: new Date().toISOString()
            };
          }
          return c;
        });
      });

      return { queryKeyToInvalidate, previousData, previousLists };
    },
    onSuccess: (_, variables, context: any) => {
      if (context?.queryKeyToInvalidate) {
        queryClient.invalidateQueries({ queryKey: context.queryKeyToInvalidate });
      }
      queryClient.invalidateQueries({ queryKey: [api.conversations.list.path] });
    },
    onError: (error, variables, context: any) => {
      // Rollback active conversation cache
      if (context?.queryKeyToInvalidate && context?.previousData) {
        queryClient.setQueryData(context.queryKeyToInvalidate, context.previousData);
      }
      // Rollback all conversation list caches
      if (Array.isArray(context?.previousLists)) {
        for (const { key, data } of context.previousLists) {
          queryClient.setQueryData(key, data);
        }
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
