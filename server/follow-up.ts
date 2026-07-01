import { storage } from "./storage";
import { db } from "./db";
import { conversations } from "@shared/schema";
import { eq, desc, and, lte, gte, sql } from "drizzle-orm";
import { generateAiResponse } from "./ai-service";
import type { Message } from "@shared/schema";

let sendAiResponseFn: ((to: string, responseText: string) => Promise<any>) | null = null;
let lastFollowUpSweepAt = 0;
const FOLLOW_UP_TICK_MS = 60 * 1000;

const HARD_DISCARD_PATTERNS = [
  "no me interesa",
  "no quiero",
  "ya no",
  "no deseo",
  "por ahora no",
  "no gracias",
  "gracias igual",
  "dejalo asi",
  "deje asi",
  "cancela",
  "cancelar",
  "no voy a comprar",
  "no comprare",
  "no compraré",
  "no necesito",
  "solo estaba consultando",
  "era solo consulta",
  "no me escriba",
  "no me contactes",
  "deja de escribir",
  "no molestar",
  "no insista",
  "no insistas",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHardDiscardConversation(msgs: Message[]): { discard: boolean; reason?: string } {
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "in");
  if (!lastInbound?.text) return { discard: false };

  const inboundText = normalize(lastInbound.text);
  const matched = HARD_DISCARD_PATTERNS.find((pattern) => inboundText.includes(pattern));
  if (!matched) return { discard: false };

  return { discard: true, reason: matched };
}

export function initFollowUp(
  _sendToWhatsApp: (to: string, type: "text" | "image" | "interactive", content: any) => Promise<any>,
  sendAiResponse: (to: string, responseText: string) => Promise<any>,
) {
  sendAiResponseFn = sendAiResponse;

  setInterval(async () => {
    try {
      await checkAndSendFollowUps();
    } catch (err) {
      console.error("[FollowUp] Error:", err);
    }
  }, FOLLOW_UP_TICK_MS);

  console.log("[FollowUp] Scheduler started (tick every 1 min, configurable run interval)");
}

async function checkAndSendFollowUps() {
  // Enforce Quiet Hours in Bolivia (UTC-4). No follow-ups between 10:00 PM (22) and 8:00 AM (8).
  const utcDate = new Date();
  const boliviaHour = (utcDate.getUTCHours() - 4 + 24) % 24;
  if (boliviaHour >= 22 || boliviaHour < 8) {
    return; // Skip follow-ups during late night/early morning
  }

  const settings = await storage.getAiSettings();
  if (!settings?.followUpEnabled || !settings?.enabled) return;

  const now = Date.now();
  const waitMinutes = settings.followUpMinutes || 20;
  const checkIntervalMinutes = settings.followUpCheckIntervalMinutes || 5;
  const batchSize = settings.followUpBatchSize || 10;
  const followUpMessageMode = settings.followUpMessageMode === "fixed" ? "fixed" : "ai";
  const fixedFollowUpMessage = settings.followUpFixedMessage?.trim() || "";
  const checkIntervalMs = checkIntervalMinutes * 60 * 1000;
  if (lastFollowUpSweepAt && now - lastFollowUpSweepAt < checkIntervalMs) return;
  lastFollowUpSweepAt = now;
  const cutoff = new Date(now - waitMinutes * 60 * 1000);
  const window24hStart = new Date(now - 24 * 60 * 60 * 1000);

  const candidates = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.aiDisabled, false),
        gte(conversations.lastMessageTimestamp, window24hStart),
        lte(conversations.lastMessageTimestamp, cutoff),
        sql`${conversations.orderStatus} IS DISTINCT FROM 'delivered'`,
      ),
    )
    .orderBy(desc(conversations.lastMessageTimestamp))
    .limit(batchSize);

  if (candidates.length === 0) return;

  for (const conv of candidates) {
    try {
      const msgs = await storage.getMessages(conv.id);
      if (msgs.length === 0) continue;

      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.direction !== "out") continue;

      // Enforce 24h window from the last inbound customer message.
      const lastInbound = [...msgs].reverse().find((m) => m.direction === "in");
      if (!lastInbound?.createdAt) continue;
      const lastInboundTs = new Date(lastInbound.createdAt).getTime();
      if (lastInboundTs < window24hStart.getTime()) continue;

      const discard = isHardDiscardConversation(msgs);
      if (discard.discard) {
        console.log(
          `[FollowUp] Skipped conv ${conv.id} by hard-discard filter (${discard.reason})`,
        );
        continue;
      }

      if (!sendAiResponseFn) continue;

      // Send at most one automatic follow-up until the customer replies.
      if (!conv.lastFollowUpAt) {
        let followUpText = "";

        if (followUpMessageMode === "fixed" && fixedFollowUpMessage) {
          followUpText = fixedFollowUpMessage;
        } else {
          const recentMessages = msgs.slice(-10);
          const result = await generateAiResponse(
            conv.id,
            `[SISTEMA: Seguimiento automatico dentro de ventana de 24 horas. El cliente no respondio en ${waitMinutes} minutos. Genera UN mensaje corto de reenganche, natural y no invasivo. No saludes de nuevo.]`,
            recentMessages,
          );

          if (!result?.response) continue;
          followUpText = result.response;
        }

        try {
          await sendAiResponseFn(conv.waId, followUpText);
        } catch (sendErr) {
          console.error(`[FollowUp] Send failed for conv ${conv.id}:`, sendErr);
          continue;
        }

        await storage.createMessage({
          conversationId: conv.id,
          waMessageId: `followup_${Date.now()}_${conv.id}`,
          direction: "out",
          type: "text",
          text: followUpText,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          status: "sent",
        });

        await storage.updateConversation(conv.id, {
          lastMessage: followUpText,
          lastMessageTimestamp: new Date(),
          lastFollowUpAt: new Date(),
        });

        console.log(`[FollowUp] Stage1 sent to ${conv.contactName || conv.waId}`);
      }
    } catch (err) {
      console.error(`[FollowUp] Error conv ${conv.id}:`, err);
    }
  }
}
