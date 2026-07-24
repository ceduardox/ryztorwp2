import { pgTable, text, serial, integer, timestamp, jsonb, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TABLE DEFINITIONS ===

export const labels = pgTable("labels", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 20 }).notNull(),
  agentId: integer("agent_id").references(() => agents.id),
});

export const quickMessages = pgTable("quick_messages", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  text: text("text"),
  imageUrl: text("image_url"),
});

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  password: varchar("password", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(true),
  isAiAutoReplyEnabled: boolean("is_ai_auto_reply_enabled").default(true),
  isPushEnabled: boolean("is_push_enabled").default(true),
  weight: integer("weight").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subadmins = pgTable("subadmins", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  password: varchar("password", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  waId: varchar("wa_id").notNull().unique(),
  contactName: text("contact_name"),
  labelId: integer("label_id").references(() => labels.id),
  labelId2: integer("label_id_2").references(() => labels.id),
  isPinned: boolean("is_pinned").default(false),
  orderStatus: varchar("order_status", { length: 20 }),
  aiDisabled: boolean("ai_disabled").default(false),
  needsHumanAttention: boolean("needs_human_attention").default(false),
  shouldCall: boolean("should_call").default(false),
  callStatus: varchar("call_status", { length: 20 }),
  callAttempts: integer("call_attempts").default(0),
  callUpdatedAt: timestamp("call_updated_at"),
  reminderAt: timestamp("reminder_at"),
  reminderNote: text("reminder_note"),
  reminderColor: varchar("reminder_color", { length: 20 }),
  reminderDone: boolean("reminder_done").default(false),
  reminderUpdatedAt: timestamp("reminder_updated_at"),
  lastFollowUpAt: timestamp("last_follow_up_at"),
  assignedAgentId: integer("assigned_agent_id").references(() => agents.id),
  lastMessage: text("last_message"),
  lastMessageTimestamp: timestamp("last_message_timestamp"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  waMessageId: varchar("wa_message_id").unique(), // WhatsApp's message ID
  direction: varchar("direction", { length: 10 }).notNull(), // 'in' | 'out'
  type: varchar("type", { length: 20 }).notNull(), // 'text' | 'image' | 'other'
  text: text("body"),
  mediaId: varchar("media_id"),
  mimeType: varchar("mime_type"),
  status: varchar("status", { length: 20 }).default("received"), // 'sent', 'delivered', 'read'
  timestamp: varchar("timestamp"), // WhatsApp timestamp (unix string)
  rawJson: jsonb("raw_json"), // Store full payload for debugging
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// === SCHEMAS ===

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertLabelSchema = createInsertSchema(labels).omit({ id: true });
export const insertQuickMessageSchema = createInsertSchema(quickMessages).omit({ id: true });
export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, createdAt: true });
export const insertSubadminSchema = createInsertSchema(subadmins).omit({ id: true, createdAt: true });

// === API TYPES ===

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type QuickMessage = typeof quickMessages.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Subadmin = typeof subadmins.$inferSelect;
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type InsertSubadmin = z.infer<typeof insertSubadminSchema>;

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type InsertQuickMessage = z.infer<typeof insertQuickMessageSchema>;

// Request types
export const sendMessageSchema = z.object({
  to: z.string(), // wa_id
  type: z.enum(["text", "image"]),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  caption: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

// Order Status
export const orderStatusSchema = z.enum(["pending", "ready", "delivered"]).nullable();
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const updateOrderStatusSchema = z.object({
  orderStatus: orderStatusSchema,
});

// Admin Login
export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  remember: z.boolean().optional(),
});

export type LoginRequest = z.infer<typeof loginSchema>;

// === AI AGENT TABLES ===

export const aiSettings = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").default(false),
  systemPrompt: text("system_prompt"),
  catalog: text("catalog"),
  cacheRefreshMinutes: integer("cache_refresh_minutes").default(5),
  maxTokens: integer("max_tokens").default(120),
  temperature: integer("temperature").default(70), // 0-100, divide by 100 for actual value
  aiProvider: varchar("ai_provider", { length: 20 }).default("openai"),
  model: varchar("model", { length: 50 }).default("gpt-4o-mini"),
  maxPromptChars: integer("max_prompt_chars").default(2000), // Max chars in system prompt
  conversationHistory: integer("conversation_history").default(3), // How many previous messages to read
  audioResponseEnabled: boolean("audio_response_enabled").default(false), // Respond with audio when client sends audio
  audioResponseMode: varchar("audio_response_mode", { length: 30 }).default("off"), // "off", "reply_to_audio", or "from_second_turn"
  audioModeActivatedAt: timestamp("audio_mode_activated_at"), // Starts fresh turn counting when from_second_turn is enabled
  audioVoice: varchar("audio_voice", { length: 20 }).default("nova"), // TTS voice: nova, alloy, echo, shimmer, coral, sage, ash, ballad, verse
  ttsProvider: varchar("tts_provider", { length: 20 }).default("openai"), // "openai" or "elevenlabs"
  elevenlabsVoiceId: varchar("elevenlabs_voice_id", { length: 50 }).default("JBFqnCBsd6RMkjVDRZzb"), // ElevenLabs voice ID
  ttsSpeed: integer("tts_speed").default(100), // 25-400, divide by 100 for actual value (0.25x - 4.0x)
  ttsInstructions: text("tts_instructions"), // Only for realistic voices - describes tone/style
  learningMode: boolean("learning_mode").default(false), // Enable/disable learning from human responses
  learningMessageCount: integer("learning_message_count").default(10), // How many messages to read for learning
  followUpEnabled: boolean("follow_up_enabled").default(false),
  followUpMinutes: integer("follow_up_minutes").default(20),
  followUpCheckIntervalMinutes: integer("follow_up_check_interval_minutes").default(5),
  followUpBatchSize: integer("follow_up_batch_size").default(10),
  followUpMessageMode: varchar("follow_up_message_mode", { length: 20 }).default("ai"),
  followUpFixedMessage: text("follow_up_fixed_message"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiTrainingData = pgTable("ai_training_data", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // 'text' | 'url' | 'image_url'
  title: varchar("title", { length: 200 }),
  content: text("content").notNull(), // The actual text or URL
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiLogs = pgTable("ai_logs", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id),
  userMessage: text("user_message"),
  aiResponse: text("ai_response"),
  tokensUsed: integer("tokens_used"),
  success: boolean("success").default(true),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Schemas
export const insertAiSettingsSchema = createInsertSchema(aiSettings).omit({ id: true, updatedAt: true });
export const insertAiTrainingDataSchema = createInsertSchema(aiTrainingData).omit({ id: true, createdAt: true });
export const insertAiLogSchema = createInsertSchema(aiLogs).omit({ id: true, createdAt: true });

export type AiSettings = typeof aiSettings.$inferSelect;
export type AiTrainingData = typeof aiTrainingData.$inferSelect;
export type AiLog = typeof aiLogs.$inferSelect;

export type InsertAiSettings = z.infer<typeof insertAiSettingsSchema>;
export type InsertAiTrainingData = z.infer<typeof insertAiTrainingDataSchema>;
export type InsertAiLog = z.infer<typeof insertAiLogSchema>;

// === PRODUCTS TABLE ===

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  keywords: varchar("keywords", { length: 200 }), // Alternative names/keywords for search
  description: text("description"),
  price: varchar("price", { length: 50 }), // e.g., "280 Bs"
  imageUrl: text("image_url"),
  imageBottleUrl: text("image_bottle_url"),
  imageDoseUrl: text("image_dose_url"),
  imageIngredientsUrl: text("image_ingredients_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

// === PURCHASE ANALYSIS HISTORY ===

export const purchaseAnalyses = pgTable("purchase_analyses", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  probability: varchar("probability", { length: 10 }).notNull(), // 'ALTA' | 'MEDIA' | 'BAJA'
  reasoning: text("reasoning"), // AI's explanation
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPurchaseAnalysisSchema = createInsertSchema(purchaseAnalyses).omit({ id: true, createdAt: true });
export type PurchaseAnalysis = typeof purchaseAnalyses.$inferSelect;
export type InsertPurchaseAnalysis = z.infer<typeof insertPurchaseAnalysisSchema>;

// === LEARNED RULES TABLE ===

export const learnedRules = pgTable("learned_rules", {
  id: serial("id").primaryKey(),
  rule: text("rule").notNull(),
  learnedFrom: text("learned_from"),
  conversationId: integer("conversation_id").references(() => conversations.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLearnedRuleSchema = createInsertSchema(learnedRules).omit({ id: true, createdAt: true });
export type LearnedRule = typeof learnedRules.$inferSelect;
export type InsertLearnedRule = z.infer<typeof insertLearnedRuleSchema>;
