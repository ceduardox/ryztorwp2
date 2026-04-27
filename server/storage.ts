import { db } from "./db";
import {
  conversations,
  messages,
  labels,
  quickMessages,
  aiSettings,
  aiTrainingData,
  aiLogs,
  products,
  purchaseAnalyses,
  learnedRules,
  agents,
  subadmins,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type Label,
  type InsertLabel,
  type QuickMessage,
  type InsertQuickMessage,
  type AiSettings,
  type InsertAiSettings,
  type AiTrainingData,
  type InsertAiTrainingData,
  type AiLog,
  type InsertAiLog,
  type Product,
  type InsertProduct,
  type PurchaseAnalysis,
  type InsertPurchaseAnalysis,
  type LearnedRule,
  type InsertLearnedRule,
  type Agent,
  type InsertAgent,
  type Subadmin,
  type InsertSubadmin,
} from "@shared/schema";
import { eq, and, lt, desc, asc, sql, ilike, or } from "drizzle-orm";

type AssignmentOptions = {
  excludeAgentIds?: Iterable<number>;
};

export interface IStorage {
  // Auth
  validateAdmin(username: string, password: string): Promise<boolean>;

  // Conversations
  getConversations(): Promise<Conversation[]>;
  getConversationsPage(options?: {
    limit?: number;
    before?: Date;
    assignedAgentId?: number;
    search?: string;
  }): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  getConversationByWaId(waId: string): Promise<Conversation | undefined>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  updateConversation(id: number, updates: Partial<Conversation>): Promise<Conversation>;

  // Messages
  getMessages(conversationId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  getMessageByWaId(waMessageId: string): Promise<Message | undefined>;
  updateMessageStatus(waMessageId: string, status: string): Promise<void>;

  // Labels
  getLabels(): Promise<Label[]>;
  getLabel(id: number): Promise<Label | undefined>;
  createLabel(label: InsertLabel): Promise<Label>;
  updateLabel(id: number, updates: Partial<InsertLabel>): Promise<Label>;
  clearLabelFromConversations(labelId: number): Promise<void>;
  deleteLabel(id: number): Promise<void>;

  // Quick Messages
  getQuickMessages(): Promise<QuickMessage[]>;
  createQuickMessage(qm: InsertQuickMessage): Promise<QuickMessage>;
  updateQuickMessage(id: number, updates: Partial<InsertQuickMessage>): Promise<QuickMessage>;
  deleteQuickMessage(id: number): Promise<void>;

  // AI Agent
  getAiSettings(): Promise<AiSettings | undefined>;
  updateAiSettings(settings: Partial<InsertAiSettings>): Promise<AiSettings>;
  getAiTrainingData(): Promise<AiTrainingData[]>;
  createAiTrainingData(data: InsertAiTrainingData): Promise<AiTrainingData>;
  updateAiTrainingData(id: number, data: Partial<InsertAiTrainingData>): Promise<AiTrainingData>;
  deleteAiTrainingData(id: number): Promise<void>;
  getAiLogs(limit?: number): Promise<AiLog[]>;
  createAiLog(log: InsertAiLog): Promise<AiLog>;

  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: number): Promise<void>;

  // Purchase Analysis History
  getPurchaseAnalyses(conversationId: number): Promise<PurchaseAnalysis[]>;
  createPurchaseAnalysis(analysis: InsertPurchaseAnalysis): Promise<PurchaseAnalysis>;

  // Learned Rules
  getLearnedRules(): Promise<LearnedRule[]>;
  getActiveLearnedRules(): Promise<LearnedRule[]>;
  createLearnedRule(rule: InsertLearnedRule): Promise<LearnedRule>;
  updateLearnedRule(id: number, rule: Partial<InsertLearnedRule>): Promise<LearnedRule>;
  deleteLearnedRule(id: number): Promise<void>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(id: number): Promise<Agent | undefined>;
  getAgentByUsername(username: string): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: number, agent: Partial<InsertAgent>): Promise<Agent>;
  deleteAgent(id: number): Promise<void>;
  getActiveAgents(): Promise<Agent[]>;
  assignConversationToAgent(conversationId: number, agentId: number): Promise<void>;
  getNextAgentForAssignment(options?: AssignmentOptions): Promise<Agent | undefined>;
  deleteConversation(id: number): Promise<void>;

  // Subadmins
  getSubadmins(): Promise<Subadmin[]>;
  getSubadminByUsername(username: string): Promise<Subadmin | undefined>;
  createSubadmin(subadmin: InsertSubadmin): Promise<Subadmin>;
  updateSubadmin(id: number, subadmin: Partial<InsertSubadmin>): Promise<Subadmin>;
  deleteSubadmin(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private reminderColumnsEnsured = false;
  private agentAiColumnEnsured = false;
  private aiSettingsColumnsEnsured = false;
  private subadminsTableEnsured = false;

  private mapFallbackAgentRow(row: any): Agent {
    return {
      id: Number(row.id),
      name: row.name,
      username: row.username,
      password: row.password,
      isActive: row.isActive === false ? false : true,
      isAiAutoReplyEnabled: row.isAiAutoReplyEnabled === false ? false : true,
      isPushEnabled: row.isPushEnabled === false ? false : true,
      weight: Number(row.weight ?? 1),
      createdAt: row.createdAt,
    } as Agent;
  }

  private isMissingAgentAiColumnError(error: unknown): boolean {
    return String((error as any)?.message || "").includes("is_ai_auto_reply_enabled");
  }

  private async ensureAssignmentCursorTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_assignment_cursor (
        id INTEGER PRIMARY KEY,
        cursor INTEGER NOT NULL DEFAULT -1,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_assignment_cursor_singleton CHECK (id = 1)
      )
    `);
    await db.execute(sql`
      INSERT INTO agent_assignment_cursor (id, cursor)
      VALUES (1, -1)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  private async ensureConversationReminderColumns(): Promise<void> {
    if (this.reminderColumnsEnsured) return;
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS reminder_note TEXT
    `);
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS reminder_color VARCHAR(20)
    `);
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS reminder_done BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS reminder_updated_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS label_id_2 INTEGER REFERENCES labels(id)
    `);
    this.reminderColumnsEnsured = true;
  }

  private async ensureAgentAiColumn(): Promise<void> {
    if (this.agentAiColumnEnsured) return;
    await db.execute(sql`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS is_ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    await db.execute(sql`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS is_push_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    this.agentAiColumnEnsured = true;
  }

  private async ensureAiSettingsColumns(): Promise<void> {
    if (this.aiSettingsColumnsEnsured) return;
    await db.execute(sql`
      ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) NOT NULL DEFAULT 'openai'
    `);
    await db.execute(sql`
      ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS follow_up_check_interval_minutes INTEGER NOT NULL DEFAULT 5
    `);
    await db.execute(sql`
      ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS follow_up_batch_size INTEGER NOT NULL DEFAULT 10
    `);
    await db.execute(sql`
      ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS follow_up_message_mode VARCHAR(20) NOT NULL DEFAULT 'ai'
    `);
    await db.execute(sql`
      ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS follow_up_fixed_message TEXT
    `);
    this.aiSettingsColumnsEnsured = true;
  }

  private async ensureSubadminsTable(): Promise<void> {
    if (this.subadminsTableEnsured) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subadmins (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(100) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    this.subadminsTableEnsured = true;
  }

  private async getAssignmentCursor(): Promise<number> {
    await this.ensureAssignmentCursorTable();
    const result: any = await db.execute(sql`
      SELECT cursor
      FROM agent_assignment_cursor
      WHERE id = 1
      LIMIT 1
    `);
    const row = result?.rows?.[0];
    return Number(row?.cursor ?? -1);
  }

  private async setAssignmentCursor(nextCursor: number): Promise<void> {
    await this.ensureAssignmentCursorTable();
    await db.execute(sql`
      UPDATE agent_assignment_cursor
      SET cursor = ${nextCursor}, updated_at = NOW()
      WHERE id = 1
    `);
  }

  async validateAdmin(username: string, pass: string): Promise<boolean> {
    // Check against environment variables as requested
    const adminUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;
    return username === adminUser && pass === adminPass;
  }

  async getConversations(): Promise<Conversation[]> {
    return this.getConversationsPage();
  }

  async getConversationsPage(options: {
    limit?: number;
    before?: Date;
    assignedAgentId?: number;
    search?: string;
  } = {}): Promise<Conversation[]> {
    await this.ensureConversationReminderColumns();
    const { limit, before, assignedAgentId, search } = options;
    const safeLimit =
      typeof limit === "number"
        ? Math.max(1, Math.min(limit, 5000))
        : undefined;

    const filters: any[] = [];
    if (typeof assignedAgentId === "number") {
      filters.push(eq(conversations.assignedAgentId, assignedAgentId));
    }
    if (before) {
      filters.push(lt(conversations.updatedAt, before));
    }
    if (typeof search === "string" && search.trim()) {
      const pattern = `%${search.trim()}%`;
      filters.push(or(
        ilike(conversations.contactName, pattern),
        ilike(conversations.waId, pattern),
        ilike(conversations.lastMessage, pattern),
      ));
    }

    const whereExpr =
      filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : and(...filters);

    const query = whereExpr
      ? db.select().from(conversations).where(whereExpr).orderBy(desc(conversations.updatedAt))
      : db.select().from(conversations).orderBy(desc(conversations.updatedAt));

    if (safeLimit) {
      return await query.limit(safeLimit);
    }

    return await query;
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    await this.ensureConversationReminderColumns();
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async getConversationByWaId(waId: string): Promise<Conversation | undefined> {
    await this.ensureConversationReminderColumns();
    const [conversation] = await db.select().from(conversations).where(eq(conversations.waId, waId));
    return conversation;
  }

  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    await this.ensureConversationReminderColumns();
    const [conversation] = await db.insert(conversations).values(insertConversation).returning();
    return conversation;
  }

  async updateConversation(id: number, updates: Partial<Conversation>): Promise<Conversation> {
    await this.ensureConversationReminderColumns();
    const [updated] = await db
      .update(conversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated;
  }

  async getMessages(conversationId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt)); // Oldest first for chat history
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }

  async getMessageByWaId(waMessageId: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.waMessageId, waMessageId));
    return message;
  }

  async updateMessageStatus(waMessageId: string, status: string): Promise<void> {
    await db
      .update(messages)
      .set({ status })
      .where(eq(messages.waMessageId, waMessageId));
  }

  // Labels
  async getLabels(): Promise<Label[]> {
    return await db.select().from(labels);
  }

  async getLabel(id: number): Promise<Label | undefined> {
    const [label] = await db.select().from(labels).where(eq(labels.id, id));
    return label;
  }

  async createLabel(label: InsertLabel): Promise<Label> {
    const [created] = await db.insert(labels).values(label).returning();
    return created;
  }

  async updateLabel(id: number, updates: Partial<InsertLabel>): Promise<Label> {
    const [updated] = await db
      .update(labels)
      .set(updates)
      .where(eq(labels.id, id))
      .returning();
    return updated;
  }

  async clearLabelFromConversations(labelId: number): Promise<void> {
    await this.ensureConversationReminderColumns();
    await db
      .update(conversations)
      .set({
        labelId: sql`CASE WHEN ${conversations.labelId} = ${labelId} THEN NULL ELSE ${conversations.labelId} END`,
        labelId2: sql`CASE WHEN ${conversations.labelId2} = ${labelId} THEN NULL ELSE ${conversations.labelId2} END`,
        updatedAt: new Date(),
      })
      .where(sql`${conversations.labelId} = ${labelId} OR ${conversations.labelId2} = ${labelId}`);
  }

  async deleteLabel(id: number): Promise<void> {
    await db.delete(labels).where(eq(labels.id, id));
  }

  // Quick Messages
  async getQuickMessages(): Promise<QuickMessage[]> {
    return await db.select().from(quickMessages);
  }

  async createQuickMessage(qm: InsertQuickMessage): Promise<QuickMessage> {
    const [created] = await db.insert(quickMessages).values(qm).returning();
    return created;
  }

  async updateQuickMessage(id: number, updates: Partial<InsertQuickMessage>): Promise<QuickMessage> {
    const [updated] = await db
      .update(quickMessages)
      .set(updates)
      .where(eq(quickMessages.id, id))
      .returning();
    return updated;
  }

  async deleteQuickMessage(id: number): Promise<void> {
    await db.delete(quickMessages).where(eq(quickMessages.id, id));
  }

  // AI Agent
  async getAiSettings(): Promise<AiSettings | undefined> {
    await this.ensureAiSettingsColumns();
    const [settings] = await db.select().from(aiSettings).limit(1);
    return settings;
  }

  async updateAiSettings(settings: Partial<InsertAiSettings>): Promise<AiSettings> {
    await this.ensureAiSettingsColumns();
    const existing = await this.getAiSettings();
    if (existing) {
      const [updated] = await db
        .update(aiSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(aiSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(aiSettings).values(settings).returning();
      return created;
    }
  }

  async getAiTrainingData(): Promise<AiTrainingData[]> {
    return await db.select().from(aiTrainingData).orderBy(desc(aiTrainingData.createdAt));
  }

  async createAiTrainingData(data: InsertAiTrainingData): Promise<AiTrainingData> {
    const [created] = await db.insert(aiTrainingData).values(data).returning();
    return created;
  }

  async updateAiTrainingData(id: number, data: Partial<InsertAiTrainingData>): Promise<AiTrainingData> {
    const [updated] = await db.update(aiTrainingData).set(data).where(eq(aiTrainingData.id, id)).returning();
    return updated;
  }

  async deleteAiTrainingData(id: number): Promise<void> {
    await db.delete(aiTrainingData).where(eq(aiTrainingData.id, id));
  }

  async getAiLogs(limit: number = 50): Promise<AiLog[]> {
    return await db.select().from(aiLogs).orderBy(desc(aiLogs.createdAt)).limit(limit);
  }

  async createAiLog(log: InsertAiLog): Promise<AiLog> {
    const [created] = await db.insert(aiLogs).values(log).returning();
    return created;
  }

  // Products
  async getProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(asc(products.name));
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [created] = await db.insert(products).values(product).returning();
    return created;
  }

  async updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product> {
    const [updated] = await db.update(products).set(product).where(eq(products.id, id)).returning();
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  // Purchase Analysis History
  async getPurchaseAnalyses(conversationId: number): Promise<PurchaseAnalysis[]> {
    return await db
      .select()
      .from(purchaseAnalyses)
      .where(eq(purchaseAnalyses.conversationId, conversationId))
      .orderBy(desc(purchaseAnalyses.createdAt));
  }

  async createPurchaseAnalysis(analysis: InsertPurchaseAnalysis): Promise<PurchaseAnalysis> {
    const [created] = await db.insert(purchaseAnalyses).values(analysis).returning();
    return created;
  }

  // Learned Rules
  async getLearnedRules(): Promise<LearnedRule[]> {
    return await db.select().from(learnedRules).orderBy(desc(learnedRules.createdAt));
  }

  async getActiveLearnedRules(): Promise<LearnedRule[]> {
    return await db.select().from(learnedRules).where(eq(learnedRules.isActive, true)).orderBy(desc(learnedRules.createdAt));
  }

  async createLearnedRule(rule: InsertLearnedRule): Promise<LearnedRule> {
    const [created] = await db.insert(learnedRules).values(rule).returning();
    return created;
  }

  async updateLearnedRule(id: number, rule: Partial<InsertLearnedRule>): Promise<LearnedRule> {
    const [updated] = await db.update(learnedRules).set(rule).where(eq(learnedRules.id, id)).returning();
    return updated;
  }

  async deleteLearnedRule(id: number): Promise<void> {
    await db.delete(learnedRules).where(eq(learnedRules.id, id));
  }

  // Agents
  async getAgents(): Promise<Agent[]> {
    await this.ensureAgentAiColumn();
    try {
      return await db.select().from(agents).orderBy(asc(agents.name));
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;
      const rows = await db.execute(sql`
        SELECT
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          true AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
        FROM agents
        ORDER BY name ASC
      `);
      return (rows.rows as any[]).map((row) => this.mapFallbackAgentRow(row));
    }
  }

  async getAgent(id: number): Promise<Agent | undefined> {
    await this.ensureAgentAiColumn();
    try {
      const [agent] = await db.select().from(agents).where(eq(agents.id, id));
      return agent;
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;
      const rows = await db.execute(sql`
        SELECT
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          true AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
        FROM agents
        WHERE id = ${id}
        LIMIT 1
      `);
      const row = (rows.rows as any[])[0];
      return row ? this.mapFallbackAgentRow(row) : undefined;
    }
  }

  async getAgentByUsername(username: string): Promise<Agent | undefined> {
    await this.ensureAgentAiColumn();
    try {
      const [agent] = await db.select().from(agents).where(eq(agents.username, username));
      return agent;
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;
      const rows = await db.execute(sql`
        SELECT
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          true AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
        FROM agents
        WHERE username = ${username}
        LIMIT 1
      `);
      const row = (rows.rows as any[])[0];
      return row ? this.mapFallbackAgentRow(row) : undefined;
    }
  }

  async createAgent(agent: InsertAgent): Promise<Agent> {
    await this.ensureAgentAiColumn();
    try {
      const [created] = await db.insert(agents).values(agent).returning();
      return created;
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;

      const rows = await db.execute(sql`
        INSERT INTO agents (name, username, password, is_active, is_push_enabled, weight)
        VALUES (${agent.name}, ${agent.username}, ${agent.password}, ${agent.isActive ?? true}, ${(agent as any).isPushEnabled ?? true}, ${agent.weight ?? 1})
        RETURNING
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          is_push_enabled AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
      `);
      const row = (rows.rows as any[])[0];
      return this.mapFallbackAgentRow(row);
    }
  }

  async updateAgent(id: number, agent: Partial<InsertAgent>): Promise<Agent> {
    await this.ensureAgentAiColumn();
    try {
      const [updated] = await db.update(agents).set(agent).where(eq(agents.id, id)).returning();
      return updated;
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;

      const current = await this.getAgent(id);
      if (!current) {
        throw new Error(`Agent ${id} not found`);
      }

      const nextName = agent.name ?? current.name;
      const nextUsername = agent.username ?? current.username;
      const nextPassword = agent.password ?? current.password;
      const nextIsActive = agent.isActive ?? current.isActive ?? true;
      const nextIsPushEnabled = (agent as any).isPushEnabled ?? (current as any).isPushEnabled ?? true;
      const nextWeight = agent.weight ?? current.weight ?? 1;

      const rows = await db.execute(sql`
        UPDATE agents
        SET
          name = ${nextName},
          username = ${nextUsername},
          password = ${nextPassword},
          is_active = ${nextIsActive},
          is_push_enabled = ${nextIsPushEnabled},
          weight = ${nextWeight}
        WHERE id = ${id}
        RETURNING
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          is_push_enabled AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
      `);
      const row = (rows.rows as any[])[0];
      if (!row) {
        throw new Error(`Agent ${id} not found`);
      }

      const updated = this.mapFallbackAgentRow(row);
      if (typeof agent.isAiAutoReplyEnabled === "boolean") {
        // Compatibility mode when legacy DB does not yet have this column.
        updated.isAiAutoReplyEnabled = agent.isAiAutoReplyEnabled;
      }
      return updated;
    }
  }

  async deleteAgent(id: number): Promise<void> {
    await db.update(conversations).set({ assignedAgentId: null }).where(eq(conversations.assignedAgentId, id));
    await db.delete(agents).where(eq(agents.id, id));
  }

  async getActiveAgents(): Promise<Agent[]> {
    await this.ensureAgentAiColumn();
    try {
      return await db.select().from(agents).where(eq(agents.isActive, true)).orderBy(asc(agents.name));
    } catch (error) {
      if (!this.isMissingAgentAiColumnError(error)) throw error;
      const rows = await db.execute(sql`
        SELECT
          id,
          name,
          username,
          password,
          is_active AS "isActive",
          true AS "isAiAutoReplyEnabled",
          is_push_enabled AS "isPushEnabled",
          weight,
          created_at AS "createdAt"
        FROM agents
        WHERE is_active = true
        ORDER BY name ASC
      `);
      return (rows.rows as any[]).map((row) => this.mapFallbackAgentRow(row));
    }
  }

  async assignConversationToAgent(conversationId: number, agentId: number): Promise<void> {
    await db.update(conversations).set({ assignedAgentId: agentId }).where(eq(conversations.id, conversationId));
  }

  async getNextAgentForAssignment(options: AssignmentOptions = {}): Promise<Agent | undefined> {
    const activeAgents = await this.getActiveAgents();
    if (activeAgents.length === 0) return undefined;

    const excludeIds = new Set<number>(options.excludeAgentIds ?? []);
    const eligibleAgents = excludeIds.size
      ? activeAgents.filter((agent) => !excludeIds.has(agent.id))
      : activeAgents;
    if (eligibleAgents.length === 0) return undefined;

    const weightedSlots: number[] = [];
    for (const agent of eligibleAgents) {
      const weight = Math.max(1, Math.floor(Number(agent.weight ?? 1)));
      for (let i = 0; i < weight; i++) {
        weightedSlots.push(agent.id);
      }
    }
    if (weightedSlots.length === 0) return eligibleAgents[0];

    const cursor = await this.getAssignmentCursor();
    const nextCursor = ((cursor + 1) % weightedSlots.length + weightedSlots.length) % weightedSlots.length;
    await this.setAssignmentCursor(nextCursor);

    const nextAgentId = weightedSlots[nextCursor];
    return eligibleAgents.find((agent) => agent.id === nextAgentId) || eligibleAgents[0];
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getSubadmins(): Promise<Subadmin[]> {
    await this.ensureSubadminsTable();
    return await db.select().from(subadmins).orderBy(asc(subadmins.name));
  }

  async getSubadminByUsername(username: string): Promise<Subadmin | undefined> {
    await this.ensureSubadminsTable();
    const [subadmin] = await db.select().from(subadmins).where(eq(subadmins.username, username));
    return subadmin;
  }

  async createSubadmin(subadmin: InsertSubadmin): Promise<Subadmin> {
    await this.ensureSubadminsTable();
    const [created] = await db.insert(subadmins).values(subadmin).returning();
    return created;
  }

  async updateSubadmin(id: number, subadmin: Partial<InsertSubadmin>): Promise<Subadmin> {
    await this.ensureSubadminsTable();
    const [updated] = await db.update(subadmins).set(subadmin).where(eq(subadmins.id, id)).returning();
    return updated;
  }

  async deleteSubadmin(id: number): Promise<void> {
    await this.ensureSubadminsTable();
    await db.delete(subadmins).where(eq(subadmins.id, id));
  }
}

export const storage = new DatabaseStorage();
