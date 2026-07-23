import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import axios from "axios";
import { generateAiResponse } from "./ai-service";
import { initFollowUp } from "./follow-up";
import { insertProductSchema, messages as messagesTable, updateOrderStatusSchema, type Message as StoredMessage, type Product as StoredProduct } from "@shared/schema";
import { db, pool } from "./db";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import multer from "multer";
import { sql, eq, desc } from "drizzle-orm";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
const uploadDocument = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const uploadProductImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

const AI_DEBOUNCE_MS = 3000;
const INCOMING_PUSH_COOLDOWN_MS = 60000;
const FIRST_CONTACT_TOP_LEVEL_BUTTONS = "[BOTONES: Azucar y peso, Dolor y estres, Dolor articular]";
const FIRST_CONTACT_AZUCAR_PESO_BUTTONS = "[BOTONES: Solo diabetes, Diabetes + peso]";
const DEFAULT_ADVISOR_NAME = "Isabella";
const upsertSubadminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(100),
  isActive: z.boolean().optional(),
});
const updateSubadminSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().min(1).max(50).optional(),
  password: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
function getFirstContactProblemMenuResponse(advisorName: string) {
  return `Hola, soy ${advisorName} de RYZTOR.
Con gusto le ayudo. Que le interesa mejorar hoy?
${FIRST_CONTACT_TOP_LEVEL_BUTTONS}`;
}
const PROMPT_PROFILE_PRIMARY_TITLE = "__SYSTEM_PROMPT_PRIMARY__";
const PROMPT_PROFILE_SECONDARY_TITLE = "__SYSTEM_PROMPT_SECONDARY__";
const PROMPT_PROFILE_TERTIARY_TITLE = "__SYSTEM_PROMPT_TERTIARY__";
const PROMPT_PROFILE_ACTIVE_TITLE = "__SYSTEM_PROMPT_ACTIVE__";
const HIDDEN_PROMPT_PROFILE_TITLES = new Set([
  PROMPT_PROFILE_PRIMARY_TITLE,
  PROMPT_PROFILE_SECONDARY_TITLE,
  PROMPT_PROFILE_TERTIARY_TITLE,
  PROMPT_PROFILE_ACTIVE_TITLE,
]);
const BERBERINA_IMAGE_URL = "https://i.ibb.co/vC27GxKC/BERBERINA-BANNER.jpg";
const BITTER_IMAGE_URL = "https://i.ibb.co/whdDDLLC/image-Pippit-202602222317.jpg";
const CITRATO_IMAGE_URL = "https://i.ibb.co/Q7TYCb0F/citrato.jpg";
const BOSWELLIA_IMAGE_URL = "https://ryzapp.org/uploads/products/1773952156933-969888-boswellia.png";
const FIRST_CONTACT_ROUTE_RESPONSES = {
  azucar_y_peso_menu: {
    productName: "Selector Azucar y peso",
    imageUrl: "",
    listText: FIRST_CONTACT_AZUCAR_PESO_BUTTONS,
    responseText: `Perfecto. Te ayudo a elegir en 1 paso.
Si deseas enfoque solo para diabetes, elige la primera opcion.
Si tambien buscas apoyar bajar de peso, elige la segunda opcion.
${FIRST_CONTACT_AZUCAR_PESO_BUTTONS}`,
    benefitsText: "",
    indicationsText: "",
  },
  diabetes: {
    productName: "Berberina RYZTOR",
    imageUrl: BERBERINA_IMAGE_URL,
    listText: "[LISTA: Opciones Berberina | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]",
    responseText: `*Berberina RYZTOR*
Indicada para diabetes tipo 2 y prediabetes.
- Ayuda con control de glucosa y picos de azucar.
- Apoya metabolismo y control de antojos.
- Contribuye al equilibrio de colesterol y trigliceridos.
Producto americano de alta calidad.
*280 Bs* | Envio segun ciudad.
[LISTA: Opciones Berberina | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    benefitsText: `*Beneficios Berberina*
- Apoya control de glucosa y picos de azucar.
- Ayuda con metabolismo y control de antojos.
- Tambien contribuye al equilibrio de colesterol y trigliceridos.
[LISTA: Opciones Berberina | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    indicationsText: `*Indicaciones Berberina*
Adultos: 2 capsulas al dia.
Preferiblemente con comida.
Rendimiento referencial: aprox 30 dias por frasco.
[LISTA: Opciones Berberina | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
  },
  diabetes_y_peso: {
    productName: "Berberina + Bitter Melon RYZTOR",
    imageUrl: BITTER_IMAGE_URL,
    listText: "[LISTA: Opciones Berberina + Bitter | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]",
    responseText: `*Berberina + Bitter Melon RYZTOR*
Ideal para personas con diabetes que tambien buscan bajar de peso.
- Ayuda con control de azucar y picos de glucosa.
- Apoya control de antojos, metabolismo y peso.
- Excelente apoyo para plan de diabetes y control de peso.
Producto americano de alta calidad.
*300 Bs* | Envio segun ciudad.
[LISTA: Opciones Berberina + Bitter | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    benefitsText: `*Beneficios Berberina + Bitter*
- Apoya control de azucar y picos de glucosa.
- Ayuda con control de antojos, metabolismo y peso.
- Es una opcion enfocada en diabetes y control de peso.
[LISTA: Opciones Berberina + Bitter | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    indicationsText: `*Indicaciones Berberina + Bitter*
Adultos: 2 capsulas al dia.
Tomarlas con comida y agua.
Si preguntan horario, responder: preferiblemente con comida.
[LISTA: Opciones Berberina + Bitter | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
  },
  dolor_y_estres: {
    productName: "Citrato de Magnesio RYZTOR",
    imageUrl: CITRATO_IMAGE_URL,
    listText: "[LISTA: Opciones Citrato | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]",
    responseText: `*Citrato de Magnesio RYZTOR*
Ideal para dolor muscular, calambres y tension.
- Favorece relajacion, descanso y bienestar muscular.
- Apoya alivio de calambres y recuperacion muscular.
Producto americano de alta calidad.
*300 Bs* | Envio segun ciudad.
[LISTA: Opciones Citrato | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    benefitsText: `*Beneficios Citrato*
- Apoya alivio de dolor muscular, calambres y tension.
- Favorece relajacion, descanso y bienestar muscular.
- Puede apoyar recuperacion muscular y confort muscular.
[LISTA: Opciones Citrato | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    indicationsText: `*Indicaciones Citrato*
Adultos: 2 capsulas al dia.
Preferiblemente con comida.
Si preguntan horario, responder: preferiblemente con una comida del dia.
[LISTA: Opciones Citrato | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
  },
  dolor_articular: {
    productName: "Boswellia Serrata RYZTOR",
    imageUrl: BOSWELLIA_IMAGE_URL,
    listText: "[LISTA: Opciones Boswellia | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]",
    responseText: `*Boswellia Serrata RYZTOR*
Enfocada en dolor articular por artritis y artrosis.
- Apoya desinflamacion y movilidad de articulaciones.
- Ayuda a reducir rigidez y mejorar confort al caminar.
Producto americano de alta calidad.
*280 Bs* | Envio segun ciudad.
[LISTA: Opciones Boswellia | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    benefitsText: `*Beneficios Boswellia Serrata*
- Apoya desinflamacion articular en artritis y artrosis.
- Puede mejorar movilidad y reducir rigidez articular.
- Ayuda al confort en rodillas, caderas y manos.
[LISTA: Opciones Boswellia | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
    indicationsText: `*Indicaciones Boswellia Serrata*
Adultos: 2 capsulas al dia.
Tomarlas con comida y agua.
Constancia diaria recomendada para mejor resultado.
[LISTA: Opciones Boswellia | Beneficios, Indicaciones, Precio y envio, Quiero hacer mi pedido, Quiero hablar con alguien, Tengo otra consulta]`,
  },
} as const;
interface BufferedMessage {
  messageForAi: string;
  imageBase64ForAi?: string;
  wasAudioMessage: boolean;
  conversationId: number;
  from: string;
  name: string;
  adProductRoute?: string | null;
}
const messageBuffers = new Map<string, { messages: BufferedMessage[]; timer: ReturnType<typeof setTimeout> }>();
interface IncomingPushState {
  lastSentAt: number;
  pendingCount: number;
  latestPreview: string;
  senderName: string;
  targetExternalIds?: string[];
  timer: ReturnType<typeof setTimeout> | null;
}
const incomingPushStateByConversation = new Map<number, IncomingPushState>();
interface PushNotificationPreferences {
  notifyNewMessages: boolean;
  notifyPending: boolean;
  reminderLeadMinutes: number[];
}
interface AdLeadRoutingRule {
  id: number;
  adId: string;
  agentIds: number[];
  isActive: boolean;
  isExclusive: boolean;
  productRoute?: string | null;
  updatedAt?: string | Date | null;
}
interface DailyCostSetting {
  date: string;
  unitCostBs: number;
  officialRateBs: number;
  parallelRateBs: number;
  openaiUsdPer1kTokens?: number | null;
  elevenlabsBsPerAudio?: number | null;
  updatedAt?: string | Date | null;
}
interface AnalyticsViewPermission {
  viewerAgentId: number;
  visibleAgentIds: number[];
  updatedAt?: string | Date | null;
}
interface AnalyticsDeposit {
  id: number;
  viewerAgentId: number;
  depositDate: string;
  amountBs: number;
  note?: string | null;
  createdAt?: string | Date | null;
}
const DEFAULT_REMINDER_LEAD_MINUTES = [30, 15];
const REMINDER_PUSH_CHECK_INTERVAL_MS = 60 * 1000;
const REMINDER_PUSH_WINDOW_MS = 70 * 1000;
const sentReminderPushKeys = new Map<string, number>();
const adRoutingCursorByAdId = new Map<string, number>();
let pushSettingsCache: { settings: PushNotificationPreferences; loadedAt: number } | null = null;
let agentAiColumnEnsured = false;
let productImageColumnsEnsured = false;
let productImageStorageTableEnsured = false;
let conversationLabelColumnsEnsured = false;
let adLeadRoutingTableEnsured = false;
let dailyCostSettingsTableEnsured = false;
let analyticsViewPermissionsTableEnsured = false;
let analyticsDepositsTableEnsured = false;
let conversationAssignmentEventsTableEnsured = false;
let aiLearnHistoryTableEnsured = false;
const PUSH_SETTINGS_CACHE_TTL_MS = 15000;
const DEFAULT_PUBLIC_BASE_URL = "https://ryzapp.org";

function getRuntimePublicDir() {
  if (process.env.NODE_ENV === "production") {
    let distPath = path.resolve(process.cwd(), "dist", "public");
    if (!fs.existsSync(distPath)) {
      try {
        const altPath = path.resolve(__dirname, "public");
        if (fs.existsSync(altPath)) {
          distPath = altPath;
        }
      } catch (_error) {
        // Keep cwd fallback
      }
    }
    return distPath;
  }
  return path.resolve(process.cwd(), "client", "public");
}

function getProductUploadDirectory() {
  return path.join(getRuntimePublicDir(), "uploads", "products");
}

function sanitizeFilePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureProductImageColumnsExist() {
  if (productImageColumnsEnsured) return;
  await db.execute(sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_bottle_url TEXT
  `);
  await db.execute(sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_dose_url TEXT
  `);
  await db.execute(sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_ingredients_url TEXT
  `);
  productImageColumnsEnsured = true;
}

async function ensureProductImageStorageTableExists() {
  if (productImageStorageTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_uploaded_images (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  productImageStorageTableEnsured = true;
}

async function ensureConversationLabelColumnsExist() {
  if (conversationLabelColumnsEnsured) return;
  await db.execute(sql`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS label_id_2 INTEGER REFERENCES labels(id)
  `);
  await db.execute(sql`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS call_status VARCHAR(20)
  `);
  await db.execute(sql`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS call_attempts INTEGER NOT NULL DEFAULT 0
  `);
  await db.execute(sql`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS call_updated_at TIMESTAMP
  `);
  conversationLabelColumnsEnsured = true;
}

async function ensureAdLeadRoutingTableExists() {
  if (adLeadRoutingTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ad_lead_routing_rules (
      id SERIAL PRIMARY KEY,
      ad_id TEXT NOT NULL UNIQUE,
      agent_ids TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_exclusive BOOLEAN NOT NULL DEFAULT true,
      product_route TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    ALTER TABLE ad_lead_routing_rules
    ADD COLUMN IF NOT EXISTS is_exclusive BOOLEAN NOT NULL DEFAULT true
  `);
  await db.execute(sql`
    ALTER TABLE ad_lead_routing_rules
    ADD COLUMN IF NOT EXISTS product_route TEXT
  `);
  adLeadRoutingTableEnsured = true;
}

let dailyReportsTableEnsured = false;
async function ensureDailyReportsTableExists() {
  if (dailyReportsTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id SERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      operator_name TEXT NOT NULL DEFAULT '',
      calls_made INTEGER NOT NULL DEFAULT 0,
      calls_answered INTEGER NOT NULL DEFAULT 0,
      calls_missed INTEGER NOT NULL DEFAULT 0,
      calls_pending INTEGER NOT NULL DEFAULT 0,
      sales_by_city JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT daily_reports_unique_day_agent UNIQUE (report_date, agent_id)
    )
  `);
  dailyReportsTableEnsured = true;
}

async function ensureDailyCostSettingsTableExists() {
  if (dailyCostSettingsTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS daily_cost_settings (
      date DATE PRIMARY KEY,
      unit_cost_bs NUMERIC(12, 4) NOT NULL,
      official_rate_bs NUMERIC(12, 4) NOT NULL,
      parallel_rate_bs NUMERIC(12, 4) NOT NULL,
      openai_usd_per_1k_tokens NUMERIC(12, 6),
      elevenlabs_bs_per_audio NUMERIC(12, 4),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    ALTER TABLE daily_cost_settings
    ADD COLUMN IF NOT EXISTS openai_usd_per_1k_tokens NUMERIC(12, 6)
  `);
  await db.execute(sql`
    ALTER TABLE daily_cost_settings
    ADD COLUMN IF NOT EXISTS elevenlabs_bs_per_audio NUMERIC(12, 4)
  `);
  dailyCostSettingsTableEnsured = true;
}

async function ensureAnalyticsViewPermissionsTableExists() {
  if (analyticsViewPermissionsTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS analytics_view_permissions (
      viewer_agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      visible_agent_ids TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  analyticsViewPermissionsTableEnsured = true;
}

async function ensureAnalyticsDepositsTableExists() {
  if (analyticsDepositsTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS analytics_deposits (
      id SERIAL PRIMARY KEY,
      viewer_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      deposit_date DATE NOT NULL,
      amount_bs NUMERIC(12, 2) NOT NULL,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_analytics_deposits_viewer_date
    ON analytics_deposits (viewer_agent_id, deposit_date)
  `);
  analyticsDepositsTableEnsured = true;
}

async function ensureConversationAssignmentEventsTableExists() {
  if (conversationAssignmentEventsTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversation_assignment_events (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      to_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      assigned_by_role VARCHAR(20) NOT NULL DEFAULT 'admin',
      assigned_by_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_assignment_events_created_at
    ON conversation_assignment_events (created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_assignment_events_to_agent_created_at
    ON conversation_assignment_events (to_agent_id, created_at)
  `);
  conversationAssignmentEventsTableEnsured = true;
}

async function ensureAiLearnHistoryTableExists() {
  if (aiLearnHistoryTableEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_learn_history (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      focus TEXT,
      message_count INTEGER NOT NULL DEFAULT 10,
      suggested_rule TEXT,
      tokens_used INTEGER,
      model VARCHAR(80),
      error TEXT,
      saved_to_rules BOOLEAN NOT NULL DEFAULT false,
      saved_rule_id INTEGER REFERENCES learned_rules(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS focus TEXT
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 10
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS suggested_rule TEXT
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS tokens_used INTEGER
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS model VARCHAR(80)
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS error TEXT
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS saved_to_rules BOOLEAN NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    ALTER TABLE ai_learn_history
    ADD COLUMN IF NOT EXISTS saved_rule_id INTEGER REFERENCES learned_rules(id) ON DELETE SET NULL
  `);
  aiLearnHistoryTableEnsured = true;
}

function mapDailyCostSettingRow(row: any): DailyCostSetting {
  return {
    date: String(row.date),
    unitCostBs: Number(row.unit_cost_bs),
    officialRateBs: Number(row.official_rate_bs),
    parallelRateBs: Number(row.parallel_rate_bs),
    openaiUsdPer1kTokens: row.openai_usd_per_1k_tokens == null ? null : Number(row.openai_usd_per_1k_tokens),
    elevenlabsBsPerAudio: row.elevenlabs_bs_per_audio == null ? null : Number(row.elevenlabs_bs_per_audio),
    updatedAt: row.updated_at ?? null,
  };
}

function mapAnalyticsViewPermissionRow(row: any): AnalyticsViewPermission {
  return {
    viewerAgentId: Number(row.viewer_agent_id),
    visibleAgentIds: parseAgentIds(row.visible_agent_ids),
    updatedAt: row.updated_at ?? null,
  };
}

function mapAnalyticsDepositRow(row: any): AnalyticsDeposit {
  return {
    id: Number(row.id),
    viewerAgentId: Number(row.viewer_agent_id),
    depositDate: String(row.deposit_date),
    amountBs: Number(row.amount_bs),
    note: row.note == null ? null : String(row.note),
    createdAt: row.created_at ?? null,
  };
}

async function createAiLearnHistoryEntry(input: {
  conversationId: number | null;
  focus?: string | null;
  messageCount: number;
  suggestedRule?: string | null;
  tokensUsed?: number | null;
  model?: string | null;
  error?: string | null;
}) {
  await ensureAiLearnHistoryTableExists();
  const result: any = await db.execute(sql`
    INSERT INTO ai_learn_history (
      conversation_id,
      focus,
      message_count,
      suggested_rule,
      tokens_used,
      model,
      error
    )
    VALUES (
      ${input.conversationId},
      ${input.focus ?? null},
      ${input.messageCount},
      ${input.suggestedRule ?? null},
      ${input.tokensUsed ?? null},
      ${input.model ?? null},
      ${input.error ?? null}
    )
    RETURNING id
  `);
  return Number(result?.rows?.[0]?.id || 0);
}

async function markAiLearnHistoryAsSaved(learnHistoryId: number, ruleId: number) {
  await ensureAiLearnHistoryTableExists();
  await db.execute(sql`
    UPDATE ai_learn_history
    SET saved_to_rules = true, saved_rule_id = ${ruleId}
    WHERE id = ${learnHistoryId}
  `);
}

async function createConversationAssignmentEvent(input: {
  conversationId: number;
  fromAgentId?: number | null;
  toAgentId?: number | null;
  assignedByRole: "admin" | "system" | "agent";
  assignedByAgentId?: number | null;
}) {
  await ensureConversationAssignmentEventsTableExists();
  await db.execute(sql`
    INSERT INTO conversation_assignment_events (
      conversation_id,
      from_agent_id,
      to_agent_id,
      assigned_by_role,
      assigned_by_agent_id
    )
    VALUES (
      ${input.conversationId},
      ${input.fromAgentId ?? null},
      ${input.toAgentId ?? null},
      ${input.assignedByRole},
      ${input.assignedByAgentId ?? null}
    )
  `);
}

function parseAgentIds(raw: unknown): number[] {
  const source = Array.isArray(raw)
    ? raw.map((v) => Number(v))
    : String(raw ?? "")
        .split(",")
        .map((v) => Number(v.trim()));
  return Array.from(
    new Set(source.filter((v) => Number.isInteger(v) && v > 0)),
  );
}

function normalizeAdId(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
}

const AD_PRODUCT_ROUTE_KEYS = new Set(["diabetes", "diabetes_y_peso", "dolor_y_estres", "dolor_articular"]);

function normalizeAdProductRoute(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return AD_PRODUCT_ROUTE_KEYS.has(value) ? value : null;
}

function normalizeReportDate(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function mapAdLeadRoutingRow(row: any): AdLeadRoutingRule {
  return {
    id: Number(row.id),
    adId: String(row.ad_id || ""),
    agentIds: parseAgentIds(row.agent_ids),
    isActive: Boolean(row.is_active),
    isExclusive: Boolean(row.is_exclusive),
    productRoute: normalizeAdProductRoute(row.product_route),
    updatedAt: row.updated_at ?? null,
  };
}

type DailyReport = {
  id: number;
  reportDate: string;
  agentId: number;
  operatorName: string;
  calls: {
    made: number;
    answered: number;
    missed: number;
    pending: number;
  };
  salesByCity: Record<string, Record<string, number>>;
  updatedAt: Date | string | null;
};

function parseSalesByCity(raw: any): Record<string, Record<string, number>> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, Record<string, number>>;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function normalizeReportDateOutput(raw: any): string {
  if (!raw) return "";
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toISOString().slice(0, 10);
}

function mapDailyReportRow(row: any): DailyReport {
  return {
    id: Number(row.id),
    reportDate: normalizeReportDateOutput(row.report_date),
    agentId: Number(row.agent_id),
    operatorName: String(row.operator_name || ""),
    calls: {
      made: Number(row.calls_made || 0),
      answered: Number(row.calls_answered || 0),
      missed: Number(row.calls_missed || 0),
      pending: Number(row.calls_pending || 0),
    },
    salesByCity: parseSalesByCity(row.sales_by_city),
    updatedAt: row.updated_at ?? null,
  };
}

async function getAdLeadRoutingRules(): Promise<AdLeadRoutingRule[]> {
  await ensureAdLeadRoutingTableExists();
  const result: any = await db.execute(sql`
    SELECT id, ad_id, agent_ids, is_active, is_exclusive, product_route, updated_at
    FROM ad_lead_routing_rules
    ORDER BY updated_at DESC, id DESC
  `);
  return (result?.rows ?? []).map((row: any) => mapAdLeadRoutingRow(row));
}

async function getExclusiveAdRoutingAgentIds(): Promise<Set<number>> {
  const rules = await getAdLeadRoutingRules();
  const reserved = new Set<number>();
  for (const rule of rules) {
    if (!rule.isActive || !rule.isExclusive) continue;
    for (const id of rule.agentIds) {
      reserved.add(id);
    }
  }
  return reserved;
}

async function getAdLeadRoutingRuleByAdId(adIdRaw: string): Promise<AdLeadRoutingRule | null> {
  await ensureAdLeadRoutingTableExists();
  const adId = normalizeAdId(adIdRaw);
  if (!adId) return null;
  const result: any = await db.execute(sql`
    SELECT id, ad_id, agent_ids, is_active, is_exclusive, product_route, updated_at
    FROM ad_lead_routing_rules
    WHERE ad_id = ${adId}
    LIMIT 1
  `);
  const row = result?.rows?.[0];
  return row ? mapAdLeadRoutingRow(row) : null;
}

async function upsertAdLeadRoutingRule(input: { adId: string; agentIds: number[]; isActive?: boolean; isExclusive?: boolean; productRoute?: string | null }): Promise<AdLeadRoutingRule> {
  await ensureAdLeadRoutingTableExists();
  const adId = normalizeAdId(input.adId);
  const agentIds = parseAgentIds(input.agentIds);
  const isActive = typeof input.isActive === "boolean" ? input.isActive : true;
  const isExclusive = typeof input.isExclusive === "boolean" ? input.isExclusive : true;
  const productRoute = normalizeAdProductRoute(input.productRoute);
  const result: any = await db.execute(sql`
    INSERT INTO ad_lead_routing_rules (ad_id, agent_ids, is_active, is_exclusive, product_route)
    VALUES (${adId}, ${agentIds.join(",")}, ${isActive}, ${isExclusive}, ${productRoute})
    ON CONFLICT (ad_id)
    DO UPDATE SET
      agent_ids = EXCLUDED.agent_ids,
      is_active = EXCLUDED.is_active,
      is_exclusive = EXCLUDED.is_exclusive,
      product_route = EXCLUDED.product_route,
      updated_at = NOW()
    RETURNING id, ad_id, agent_ids, is_active, is_exclusive, product_route, updated_at
  `);
  return mapAdLeadRoutingRow(result.rows[0]);
}

async function updateAdLeadRoutingRule(id: number, input: { adId: string; agentIds: number[]; isActive?: boolean; isExclusive?: boolean; productRoute?: string | null }): Promise<AdLeadRoutingRule | null> {
  await ensureAdLeadRoutingTableExists();
  const adId = normalizeAdId(input.adId);
  const agentIds = parseAgentIds(input.agentIds);
  const isActive = typeof input.isActive === "boolean" ? input.isActive : true;
  const isExclusive = typeof input.isExclusive === "boolean" ? input.isExclusive : true;
  const productRoute = normalizeAdProductRoute(input.productRoute);
  const result: any = await db.execute(sql`
    UPDATE ad_lead_routing_rules
    SET
      ad_id = ${adId},
      agent_ids = ${agentIds.join(",")},
      is_active = ${isActive},
      is_exclusive = ${isExclusive},
      product_route = ${productRoute},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, ad_id, agent_ids, is_active, is_exclusive, product_route, updated_at
  `);
  const row = result.rows?.[0];
  return row ? mapAdLeadRoutingRow(row) : null;
}

async function deleteAdLeadRoutingRule(id: number): Promise<void> {
  await ensureAdLeadRoutingTableExists();
  await db.execute(sql`DELETE FROM ad_lead_routing_rules WHERE id = ${id}`);
}

async function getAnalyticsViewPermissions(): Promise<AnalyticsViewPermission[]> {
  await ensureAnalyticsViewPermissionsTableExists();
  const result: any = await db.execute(sql`
    SELECT viewer_agent_id, visible_agent_ids, updated_at
    FROM analytics_view_permissions
    ORDER BY viewer_agent_id ASC
  `);
  return (result?.rows ?? []).map((row: any) => mapAnalyticsViewPermissionRow(row));
}

async function getAnalyticsViewPermissionByViewerAgentId(viewerAgentId: number): Promise<AnalyticsViewPermission | null> {
  await ensureAnalyticsViewPermissionsTableExists();
  const result: any = await db.execute(sql`
    SELECT viewer_agent_id, visible_agent_ids, updated_at
    FROM analytics_view_permissions
    WHERE viewer_agent_id = ${viewerAgentId}
    LIMIT 1
  `);
  const row = result?.rows?.[0];
  return row ? mapAnalyticsViewPermissionRow(row) : null;
}

async function upsertAnalyticsViewPermission(input: { viewerAgentId: number; visibleAgentIds: number[] }): Promise<AnalyticsViewPermission> {
  await ensureAnalyticsViewPermissionsTableExists();
  const viewerAgentId = Number(input.viewerAgentId);
  const visibleAgentIds = parseAgentIds(input.visibleAgentIds).filter((id) => id !== viewerAgentId);
  const result: any = await db.execute(sql`
    INSERT INTO analytics_view_permissions (viewer_agent_id, visible_agent_ids)
    VALUES (${viewerAgentId}, ${visibleAgentIds.join(",")})
    ON CONFLICT (viewer_agent_id)
    DO UPDATE SET
      visible_agent_ids = EXCLUDED.visible_agent_ids,
      updated_at = NOW()
    RETURNING viewer_agent_id, visible_agent_ids, updated_at
  `);
  return mapAnalyticsViewPermissionRow(result.rows[0]);
}

async function getAllowedAnalyticsAgentIdsForViewer(viewerAgentId: number): Promise<Set<number>> {
  const allowed = new Set<number>([viewerAgentId]);
  const permission = await getAnalyticsViewPermissionByViewerAgentId(viewerAgentId);
  for (const id of permission?.visibleAgentIds ?? []) {
    allowed.add(Number(id));
  }
  return allowed;
}

function resolveAnalyticsDepositViewerAgentId(session: any, requestedViewerAgentId?: unknown): number | null {
  if (session?.role === "agent") {
    const ownAgentId = Number(session.agentId);
    return Number.isInteger(ownAgentId) && ownAgentId > 0 ? ownAgentId : null;
  }

  if (session?.role === "admin") {
    const viewerAgentId = Number(requestedViewerAgentId);
    return Number.isInteger(viewerAgentId) && viewerAgentId > 0 ? viewerAgentId : null;
  }

  return null;
}

function extractAdIdFromIncomingMessage(msg: any): string | null {
  const directCandidates = [
    msg?.referral?.source_id,
    msg?.referral?.ad_id,
    msg?.context?.referral?.source_id,
    msg?.context?.referral?.ad_id,
    msg?.ad_id,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeAdId(candidate);
    if (normalized) return normalized;
  }
  return null;
}

async function getNextAgentForAdIdRouting(adIdRaw: string): Promise<{ agent?: { id: number; name: string; weight?: number | null }; rule?: AdLeadRoutingRule }> {
  const adId = normalizeAdId(adIdRaw);
  if (!adId) return {};
  const rule = (await getAdLeadRoutingRuleByAdId(adId)) || undefined;
  if (!rule || !rule.isActive || rule.agentIds.length === 0) return { rule };

  const activeAgents = await storage.getActiveAgents();
  const targetAgents = activeAgents.filter((agent) => rule.agentIds.includes(agent.id));
  if (targetAgents.length === 0) return { rule };

  const weightedSlots: number[] = [];
  for (const agent of targetAgents) {
    const weight = Math.max(1, Math.floor(Number(agent.weight ?? 1)));
    for (let i = 0; i < weight; i++) {
      weightedSlots.push(agent.id);
    }
  }
  if (weightedSlots.length === 0) return { rule, agent: targetAgents[0] };

  const prevCursor = adRoutingCursorByAdId.get(adId) ?? -1;
  const nextCursor = ((prevCursor + 1) % weightedSlots.length + weightedSlots.length) % weightedSlots.length;
  adRoutingCursorByAdId.set(adId, nextCursor);
  const nextAgentId = weightedSlots[nextCursor];
  const agent = targetAgents.find((item) => item.id === nextAgentId) || targetAgents[0];
  return { rule, agent };
}

function normalizeInboundText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMojibakeArtifacts(text: string): number {
  const matches = text.match(/(?:Ã.|Â.|ðŸ|â.|ï¸|�)/g);
  return matches ? matches.length : 0;
}

function repairMojibakeText(text: string): string {
  if (!text) return text;
  let candidate = text;
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = countMojibakeArtifacts(candidate);
    if (before === 0) break;
    const repaired = Buffer.from(candidate, "latin1").toString("utf8");
    const after = countMojibakeArtifacts(repaired);
    if (!repaired || after >= before) break;
    candidate = repaired;
  }
  return candidate;
}

function repairMojibakeDeep<T>(value: T): T {
  if (typeof value === "string") {
    return repairMojibakeText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => repairMojibakeDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const repairedObject: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      repairedObject[key] = repairMojibakeDeep(nestedValue);
    }
    return repairedObject as T;
  }
  return value;
}

function getAgentPushExternalId(agentId?: number | null) {
  return typeof agentId === "number" ? `agent:${agentId}` : null;
}

function getAdminPushExternalId() {
  return "admin:global";
}

function getPushRecipientExternalIds(assignedAgentId?: number | null) {
  const recipients = [getAdminPushExternalId()];
  const agentExternalId = getAgentPushExternalId(assignedAgentId);
  if (agentExternalId) {
    recipients.push(agentExternalId);
  }
  return Array.from(new Set(recipients));
}

function getConversationPushOptions(conversation?: { assignedAgentId?: number | null } | null) {
  return { targetExternalIds: getPushRecipientExternalIds(conversation?.assignedAgentId) };
}

async function filterPushExternalIdsByAgentSettings(externalIds: string[]) {
  const filtered: string[] = [];
  for (const externalId of Array.from(new Set(externalIds.filter(Boolean)))) {
    const match = /^agent:(\d+)$/.exec(externalId);
    if (!match) {
      filtered.push(externalId);
      continue;
    }
    const agent = await storage.getAgent(Number(match[1]));
    if (!agent || (agent as any).isPushEnabled !== false) {
      filtered.push(externalId);
    }
  }
  return filtered;
}

function getPushTargetUrl(data?: Record<string, string>) {
  const conversationId = data?.conversationId;
  const baseUrl = process.env.APP_URL || "https://ryzapp.org";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  
  if (conversationId && /^\d+$/.test(conversationId)) {
    return `${normalizedBase}/?conversationId=${conversationId}`;
  }
  return `${normalizedBase}/`;
}

function getConversationAdvisorName(assignedAgentName?: string | null) {
  const normalized = (assignedAgentName || "").trim();
  return normalized || DEFAULT_ADVISOR_NAME;
}

function parseClientDevice(userAgentRaw?: string | null) {
  const userAgent = String(userAgentRaw || "");
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome|Chromium/.test(userAgent)
      ? "Chrome"
      : /Safari/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent)
        ? "Safari"
        : /Firefox/.test(userAgent)
          ? "Firefox"
          : "Desconocido";
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS"
      : /Windows NT/.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "macOS"
          : "Desconocido";
  const deviceType = /Mobile|Android|iPhone|iPad|iPod/.test(userAgent) ? "Movil" : "Escritorio";
  return { browser, os, deviceType };
}

function maskIpAddress(ipRaw?: string | null) {
  const ip = String(ipRaw || "").replace(/^::ffff:/, "").trim();
  if (!ip) return "desconocida";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}:*`;
  return ip;
}

function getRequestIp(req: any) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "";
}

function buildSessionClientInfo(req: any) {
  const userAgent = String(req.headers?.["user-agent"] || "");
  return {
    ...parseClientDevice(userAgent),
    ip: maskIpAddress(getRequestIp(req)),
    userAgent: userAgent.slice(0, 300),
  };
}

function resolvePublicImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (!imageUrl.startsWith("/")) return imageUrl;
  const baseUrl = (process.env.APP_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return `${baseUrl}${imageUrl}`;
}

function findCatalogProductByRouteName(products: StoredProduct[], routeProductName: string) {
  const routeName = normalizeInboundText(routeProductName);
  if (!routeName) return null;
  return (
    products.find((product) => {
      const productName = normalizeInboundText(product.name || "");
      if (productName === routeName) return true;
      if (productName.includes(routeName) || routeName.includes(productName)) return true;
      const keywords = normalizeInboundText(product.keywords || "");
      return Boolean(keywords && (keywords.includes(routeName) || routeName.includes(keywords)));
    }) || null
  );
}

function getPreferredCatalogProductImage(product: StoredProduct | null) {
  if (!product) return "";
  return (
    resolvePublicImageUrl(product.imageUrl) ||
    resolvePublicImageUrl(product.imageBottleUrl) ||
    resolvePublicImageUrl(product.imageDoseUrl) ||
    resolvePublicImageUrl(product.imageIngredientsUrl) ||
    ""
  );
}

async function getStoredProductImageByFileName(fileName: string): Promise<{ mimeType: string; data: Buffer } | null> {
  await ensureProductImageStorageTableExists();
  const result: any = await db.execute(sql`
    SELECT mime_type, data
    FROM product_uploaded_images
    WHERE file_name = ${fileName}
    LIMIT 1
  `);
  const row = result?.rows?.[0];
  if (!row?.data) return null;
  const dataBuffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  return {
    mimeType: String(row.mime_type || "application/octet-stream"),
    data: dataBuffer,
  };
}

function isGenericFirstContactTrigger(text: string): boolean {
  const normalized = normalizeInboundText(text);
  if (!normalized) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;

  const allowedTokens = new Set([
    "hola",
    "ola",
    "buenas",
    "buenos",
    "dias",
    "dia",
    "tardes",
    "noches",
    "precio",
    "info",
    "informacion",
    "mas",
    "esto",
    "por",
    "favor",
    "consulta",
  ]);

  const coreTokens = new Set([
    "hola",
    "ola",
    "buenas",
    "precio",
    "info",
    "informacion",
    "esto",
    "consulta",
  ]);

  return tokens.every(token => allowedTokens.has(token)) && tokens.some(token => coreTokens.has(token));
}

function shouldForceFirstContactProblemMenu(
  messageForAi: string,
  recentMessages: StoredMessage[],
  imageBase64ForAi?: string,
  wasAudioMessage?: boolean,
): boolean {
  if (!messageForAi || imageBase64ForAi || wasAudioMessage) return false;

  const lastTenMessages = recentMessages.slice(-10);
  const hasOutboundHistory = lastTenMessages.some(message => message.direction === "out");
  if (hasOutboundHistory) return false;

  return isGenericFirstContactTrigger(messageForAi);
}

function getForcedFirstContactRouteResponse(
  messageForAi: string,
  recentMessages: StoredMessage[],
) {
  const latestOutbound = [...recentMessages].reverse().find(message => message.direction === "out");
  if (!latestOutbound?.text) {
    return null;
  }

  const normalized = normalizeInboundText(messageForAi);
  const isTopLevelMenu = latestOutbound.text.includes(FIRST_CONTACT_TOP_LEVEL_BUTTONS);
  const isAzucarPesoMenu = latestOutbound.text.includes(FIRST_CONTACT_AZUCAR_PESO_BUTTONS);

  if (isTopLevelMenu) {
    if (normalized === "azucar y peso") return FIRST_CONTACT_ROUTE_RESPONSES.azucar_y_peso_menu;
    if (normalized === "dolor y estres") return FIRST_CONTACT_ROUTE_RESPONSES.dolor_y_estres;
    if (normalized === "dolor articular") return FIRST_CONTACT_ROUTE_RESPONSES.dolor_articular;
  }

  if (isAzucarPesoMenu) {
    if (normalized === "solo diabetes") return FIRST_CONTACT_ROUTE_RESPONSES.diabetes;
    if (
      normalized === "diabetes peso" ||
      normalized === "diabetes bajar de peso" ||
      normalized === "diabetes y bajar de peso"
    ) {
      return FIRST_CONTACT_ROUTE_RESPONSES.diabetes_y_peso;
    }
  }

  return null;
}

function getAdProductRouteResponse(productRoute?: string | null) {
  const route = normalizeAdProductRoute(productRoute);
  if (!route) return null;
  return FIRST_CONTACT_ROUTE_RESPONSES[route as keyof typeof FIRST_CONTACT_ROUTE_RESPONSES] || null;
}

function getCurrentProductContext(recentMessages: StoredMessage[]) {
  const latestOutbound = [...recentMessages].reverse().find(message => message.direction === "out" && typeof message.text === "string");
  if (!latestOutbound?.text) return null;

  const outboundText = latestOutbound.text;
  return Object.values(FIRST_CONTACT_ROUTE_RESPONSES).find(product =>
    outboundText.includes(product.productName) || outboundText.includes(product.listText)
  ) || null;
}

function shouldSendImageForProduct(
  recentMessages: StoredMessage[],
  productName: string,
  imageUrl: string,
): boolean {
  const lastTenMessages = recentMessages.slice(-10);

  return !lastTenMessages.some(message => {
    if (message.direction !== "out" || typeof message.text !== "string") return false;
    return message.text.includes(imageUrl) || message.text.includes(productName);
  });
}

async function ensurePushSettingsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_notification_settings (
      id INTEGER PRIMARY KEY,
      notify_new_messages BOOLEAN NOT NULL DEFAULT true,
      notify_pending BOOLEAN NOT NULL DEFAULT true,
      reminder_lead_minutes TEXT NOT NULL DEFAULT '30,15',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT push_notification_settings_singleton CHECK (id = 1)
    )
  `);
  await db.execute(sql`
    ALTER TABLE push_notification_settings
    ADD COLUMN IF NOT EXISTS reminder_lead_minutes TEXT NOT NULL DEFAULT '30,15'
  `);
  await db.execute(sql`
    INSERT INTO push_notification_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
}

function normalizeReminderLeadMinutes(raw: unknown): number[] {
  const source = Array.isArray(raw)
    ? raw.map((v) => Number(v))
    : String(raw ?? "")
        .split(",")
        .map((v) => Number(v.trim()));

  const unique = Array.from(
    new Set(
      source.filter((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 1440),
    ),
  ).sort((a, b) => b - a);

  if (unique.length === 0) return [...DEFAULT_REMINDER_LEAD_MINUTES];
  return unique.slice(0, 8);
}

async function getPushNotificationPreferences(force = false): Promise<PushNotificationPreferences> {
  const now = Date.now();
  if (!force && pushSettingsCache && now - pushSettingsCache.loadedAt < PUSH_SETTINGS_CACHE_TTL_MS) {
    return pushSettingsCache.settings;
  }

  await ensurePushSettingsTable();
  const result: any = await db.execute(sql`
    SELECT notify_new_messages, notify_pending, reminder_lead_minutes
    FROM push_notification_settings
    WHERE id = 1
    LIMIT 1
  `);
  const rows = result?.rows ?? [];
  const row = rows[0];

  const settings: PushNotificationPreferences = {
    notifyNewMessages: row ? Boolean(row.notify_new_messages) : true,
    notifyPending: row ? Boolean(row.notify_pending) : true,
    reminderLeadMinutes: normalizeReminderLeadMinutes(row?.reminder_lead_minutes),
  };
  pushSettingsCache = { settings, loadedAt: now };
  return settings;
}

async function updatePushNotificationPreferences(next: PushNotificationPreferences): Promise<PushNotificationPreferences> {
  await ensurePushSettingsTable();
  const reminderLeadMinutes = normalizeReminderLeadMinutes(next.reminderLeadMinutes);
  await db.execute(sql`
    UPDATE push_notification_settings
    SET
      notify_new_messages = ${next.notifyNewMessages},
      notify_pending = ${next.notifyPending},
      reminder_lead_minutes = ${reminderLeadMinutes.join(",")},
      updated_at = NOW()
    WHERE id = 1
  `);
  const normalized: PushNotificationPreferences = {
    notifyNewMessages: next.notifyNewMessages,
    notifyPending: next.notifyPending,
    reminderLeadMinutes,
  };
  pushSettingsCache = { settings: normalized, loadedAt: Date.now() };
  return normalized;
}

async function ensureAgentAiColumnExists() {
  if (agentAiColumnEnsured) return;
  await db.execute(sql`
    ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS is_ai_auto_reply_enabled BOOLEAN NOT NULL DEFAULT true
  `);
  await db.execute(sql`
    ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS is_push_enabled BOOLEAN NOT NULL DEFAULT true
  `);
  agentAiColumnEnsured = true;
}

async function getPromptProfiles() {
  const [settings, trainingData] = await Promise.all([
    storage.getAiSettings(),
    storage.getAiTrainingData(),
  ]);

  const byTitle = new Map(trainingData.map(item => [item.title || "", item]));
  const primaryPrompt = byTitle.get(PROMPT_PROFILE_PRIMARY_TITLE)?.content || settings?.systemPrompt || "";
  const secondaryPrompt = byTitle.get(PROMPT_PROFILE_SECONDARY_TITLE)?.content || "";
  const tertiaryPrompt = byTitle.get(PROMPT_PROFILE_TERTIARY_TITLE)?.content || "";
  const rawActive = byTitle.get(PROMPT_PROFILE_ACTIVE_TITLE)?.content || "primary";
  const activeSlot = rawActive === "tertiary" ? "tertiary" : (rawActive === "secondary" ? "secondary" : "primary");

  return { primaryPrompt, secondaryPrompt, tertiaryPrompt, activeSlot };
}

async function upsertPromptProfile(title: string, content: string) {
  const trainingData = await storage.getAiTrainingData();
  const existing = trainingData.find(item => item.title === title);
  if (existing) {
    return storage.updateAiTrainingData(existing.id, { content, title, type: "text" });
  }
  return storage.createAiTrainingData({ type: "text", title, content });
}

function isHiddenPromptProfileTitle(title?: string | null) {
  return HIDDEN_PROMPT_PROFILE_TITLES.has(title || "");
}

function flushMessageBuffer(waId: string) {
  const buffer = messageBuffers.get(waId);
  if (!buffer || buffer.messages.length === 0) return;
  messageBuffers.delete(waId);

  const msgs = buffer.messages;
  const combined: BufferedMessage = {
    messageForAi: msgs.map(m => m.messageForAi).join("\n"),
    imageBase64ForAi: msgs.find(m => m.imageBase64ForAi)?.imageBase64ForAi,
    wasAudioMessage: msgs.some(m => m.wasAudioMessage),
    conversationId: msgs[msgs.length - 1].conversationId,
    from: msgs[0].from,
    name: msgs[0].name,
    adProductRoute: msgs.find(m => m.adProductRoute)?.adProductRoute || null,
  };

  processAiResponse(combined).catch(err => console.error("Buffered AI error:", err));
}

async function processAiResponse(data: BufferedMessage) {
  const { conversationId, messageForAi, from, name, imageBase64ForAi, wasAudioMessage, adProductRoute } = data;
  const conversation = await storage.getConversation(conversationId);
  if (!conversation || conversation.aiDisabled) return;
  let assignedAgentName: string | null = null;
  if (conversation.assignedAgentId) {
    const assignedAgent = await storage.getAgent(conversation.assignedAgentId);
    assignedAgentName = assignedAgent?.name || null;
    if (assignedAgent && assignedAgent.isAiAutoReplyEnabled === false) return;
  }
  const advisorName = getConversationAdvisorName(assignedAgentName);

  try {
    const aiSettings = await storage.getAiSettings();
    const fixedCommerceFlowEnabled = aiSettings?.learningMode !== true;
    const recentMessages = await storage.getMessages(conversationId);

    const adRouteResponse = fixedCommerceFlowEnabled && !imageBase64ForAi && !wasAudioMessage
      ? getAdProductRouteResponse(adProductRoute)
      : null;
    const hasOutboundHistory = recentMessages.slice(-10).some(message => message.direction === "out");
    if (adRouteResponse && !hasOutboundHistory) {
      let imageUrlToSend = resolvePublicImageUrl(adRouteResponse.imageUrl);
      const products = await storage.getProducts();
      const matchedCatalogProduct = findCatalogProductByRouteName(products, adRouteResponse.productName);
      const catalogImage = getPreferredCatalogProductImage(matchedCatalogProduct);
      if (catalogImage) {
        imageUrlToSend = catalogImage;
      }

      if (imageUrlToSend && shouldSendImageForProduct(recentMessages, adRouteResponse.productName, imageUrlToSend)) {
        const imgResponse = await sendToWhatsApp(from, "image", { imageUrl: imageUrlToSend });
        await storage.createMessage({
          conversationId,
          waMessageId: imgResponse.messages[0].id,
          direction: "out",
          type: "image",
          text: imageUrlToSend,
          mediaId: null,
          mimeType: null,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          status: "sent",
          rawJson: imgResponse,
        });
      }

      const waResponse = await sendAiResponseToWhatsApp(from, adRouteResponse.responseText);
      const waMessageId = waResponse.messages[0].id;

      await storage.createMessage({
        conversationId,
        waMessageId,
        direction: "out",
        type: "text",
        text: adRouteResponse.responseText,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent",
        rawJson: waResponse,
      });

      await storage.updateConversation(conversationId, {
        needsHumanAttention: false,
        lastMessage: adRouteResponse.responseText,
        lastMessageTimestamp: new Date(),
      });

      return;
    }

    if (fixedCommerceFlowEnabled && shouldForceFirstContactProblemMenu(messageForAi, recentMessages, imageBase64ForAi, wasAudioMessage)) {
      const firstContactResponseText = getFirstContactProblemMenuResponse(advisorName);
      const waResponse = await sendAiResponseToWhatsApp(from, firstContactResponseText);
      const waMessageId = waResponse.messages[0].id;

      await storage.createMessage({
        conversationId,
        waMessageId,
        direction: "out",
        type: "text",
        text: firstContactResponseText,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent",
        rawJson: waResponse,
      });

      await storage.updateConversation(conversationId, {
        needsHumanAttention: false,
        lastMessage: firstContactResponseText,
        lastMessageTimestamp: new Date(),
      });

      return;
    }

    const forcedRouteResponse = fixedCommerceFlowEnabled
      ? getForcedFirstContactRouteResponse(messageForAi, recentMessages)
      : null;
    if (forcedRouteResponse && !imageBase64ForAi && !wasAudioMessage) {
      let imageUrlToSend = resolvePublicImageUrl(forcedRouteResponse.imageUrl);
      const products = await storage.getProducts();
      const matchedCatalogProduct = findCatalogProductByRouteName(products, forcedRouteResponse.productName);
      const catalogImage = getPreferredCatalogProductImage(matchedCatalogProduct);
      if (catalogImage) {
        imageUrlToSend = catalogImage;
      }

      if (imageUrlToSend && shouldSendImageForProduct(recentMessages, forcedRouteResponse.productName, imageUrlToSend)) {
        const imgResponse = await sendToWhatsApp(from, "image", { imageUrl: imageUrlToSend });
        await storage.createMessage({
          conversationId,
          waMessageId: imgResponse.messages[0].id,
          direction: "out",
          type: "image",
          text: imageUrlToSend,
          mediaId: null,
          mimeType: null,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          status: "sent",
          rawJson: imgResponse,
        });
      }

      const waResponse = await sendAiResponseToWhatsApp(from, forcedRouteResponse.responseText);
      const waMessageId = waResponse.messages[0].id;

      await storage.createMessage({
        conversationId,
        waMessageId,
        direction: "out",
        type: "text",
        text: forcedRouteResponse.responseText,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent",
        rawJson: waResponse,
      });

      await storage.updateConversation(conversationId, {
        needsHumanAttention: false,
        lastMessage: forcedRouteResponse.responseText,
        lastMessageTimestamp: new Date(),
      });

      return;
    }

    const currentProductContext = fixedCommerceFlowEnabled ? getCurrentProductContext(recentMessages) : null;
    const normalizedMessage = normalizeInboundText(messageForAi);
    if (currentProductContext && !imageBase64ForAi && !wasAudioMessage) {
      const submenuResponse =
        normalizedMessage === "beneficios" || normalizedMessage === "beneficio"
          ? currentProductContext.benefitsText
          : normalizedMessage === "indicaciones" || normalizedMessage === "indicacion"
            ? currentProductContext.indicationsText
            : null;

      if (submenuResponse) {
        const waResponse = await sendAiResponseToWhatsApp(from, submenuResponse);
        const waMessageId = waResponse.messages[0].id;

        await storage.createMessage({
          conversationId,
          waMessageId,
          direction: "out",
          type: "text",
          text: submenuResponse,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          status: "sent",
          rawJson: waResponse,
        });

        await storage.updateConversation(conversationId, {
          needsHumanAttention: false,
          lastMessage: submenuResponse,
          lastMessageTimestamp: new Date(),
        });

        return;
      }
    }

    const aiResult = await generateAiResponse(conversationId, messageForAi, recentMessages, imageBase64ForAi, advisorName);

    if (aiResult && aiResult.needsHuman) {
      await storage.updateConversation(conversationId, { needsHumanAttention: true });
      console.log("=== AI NEEDS HUMAN - MARKED FOR ATTENTION ===", conversationId);
      sendPushNotification(
        "Atencion Humana Requerida",
        `${name}: El cliente necesita hablar con un humano`,
        { conversationId: conversationId.toString(), waId: from, event: "human_attention" },
        getConversationPushOptions(conversation)
      );
    } else if (aiResult && aiResult.response) {
      await storage.updateConversation(conversationId, { needsHumanAttention: false });

      const shouldSendAudio = wasAudioMessage && aiSettings?.audioResponseEnabled;
      if (aiResult.imageUrl) {
        const imgResponse = await sendToWhatsApp(from, 'image', { imageUrl: aiResult.imageUrl });
        await storage.createMessage({
          conversationId,
          waMessageId: imgResponse.messages[0].id,
          direction: "out",
          type: "image",
          // Keep the source URL so the UI can render outbound AI images even without mediaId.
          text: aiResult.imageUrl,
          mediaId: null,
          mimeType: null,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          status: "sent",
          rawJson: imgResponse,
        });
      }

      let waResponse: any;
      let waMessageId: string;
      let outboundMessageType: "text" | "audio" = "text";

      if (shouldSendAudio) {
        const ttsProvider = aiSettings?.ttsProvider || "openai";
        const selectedVoice = aiSettings?.audioVoice || "nova";
        const elevenlabsVoiceId = aiSettings?.elevenlabsVoiceId || "JBFqnCBsd6RMkjVDRZzb";
        const ttsSpeed = aiSettings?.ttsSpeed ? aiSettings.ttsSpeed / 100 : 1.0;
        const ttsInstructions = aiSettings?.ttsInstructions || null;
        console.log("=== SENDING AUDIO ===", ttsProvider, selectedVoice, ttsSpeed);

        const audioSent = await sendAudioResponse(from, aiResult.response, selectedVoice, { speed: ttsSpeed, instructions: ttsInstructions, provider: ttsProvider, elevenlabsVoiceId });
        if (audioSent) {
          waMessageId = `audio_${Date.now()}`;
          waResponse = { messages: [{ id: waMessageId }] };
          outboundMessageType = "audio";
        } else {
          console.log("=== AUDIO FAILED, TEXT FALLBACK ===");
          waResponse = await sendAiResponseToWhatsApp(from, aiResult.response);
          waMessageId = waResponse.messages[0].id;
        }
      } else {
        waResponse = await sendAiResponseToWhatsApp(from, aiResult.response);
        waMessageId = waResponse.messages[0].id;
      }

      await storage.createMessage({
        conversationId,
        waMessageId,
        direction: "out",
        type: outboundMessageType,
        text: aiResult.response,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent",
        rawJson: waResponse,
      });

      const updateData: any = {
        lastMessage: aiResult.response,
        lastMessageTimestamp: new Date(),
      };

      if (aiResult.orderReady) {
        updateData.orderStatus = 'ready';
        console.log("=== MARKING ORDER AS READY ===", conversationId);
        sendPushNotification(
          "Pedido Listo para Enviar",
          `${name}: Pedido completo, listo para despachar`,
          { conversationId: conversationId.toString(), waId: from, event: "order_ready" },
          getConversationPushOptions(conversation)
        );
      }

      if (aiResult.shouldCall) {
        updateData.shouldCall = true;
        console.log("=== MARKING FOR CALL (NEUROVENTA) ===", conversationId);
        sendPushNotification(
          "Llamar al Cliente",
          `${name}: Alta probabilidad de compra - llamar ahora`,
          { conversationId: conversationId.toString(), waId: from, event: "should_call" },
          getConversationPushOptions(conversation)
        );
      }

      await storage.updateConversation(conversationId, updateData);

      console.log("=== AI RESPONSE SENT (BUFFERED) ===");
      console.log("Response:", aiResult.response);
      console.log("Tokens:", aiResult.tokensUsed);
    }
  } catch (aiError) {
    console.error("AI Response Error (buffered):", aiError);
  }
}

// Debug log storage for production troubleshooting
const audioDebugLogs: Array<{ timestamp: string; step: string; data: any }> = [];
function logAudioDebug(step: string, data: any) {
  const entry = { timestamp: new Date().toISOString(), step, data };
  audioDebugLogs.push(entry);
  if (audioDebugLogs.length > 50) audioDebugLogs.shift(); // Keep last 50 entries
  console.log(`[Audio] ${step}:`, JSON.stringify(data));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseMetaAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:.-]+)\s*=\s*(['"])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[3];
  }
  return attrs;
}

function extractOgImageFromHtml(html: string, pageUrl: string): string | null {
  const metaTagRegex = /<meta\s+[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = metaTagRegex.exec(html)) !== null) {
    const attrs = parseMetaAttributes(tagMatch[0]);
    const property = (attrs.property || attrs.name || "").toLowerCase().trim();
    if (!["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(property)) continue;
    const content = decodeHtmlEntities((attrs.content || "").trim());
    if (!content) continue;
    try {
      return new URL(content, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchOgImageFromProvider(targetUrl: string): Promise<string | null> {
  try {
    const providerResponse = await axios.get("https://api.microlink.io/", {
      timeout: 9000,
      params: {
        url: targetUrl,
        screenshot: false,
        video: false,
        audio: false,
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RyzappLinkPreview/1.0)",
        Accept: "application/json",
      },
    });
    const candidate =
      providerResponse.data?.data?.image?.url ||
      providerResponse.data?.data?.logo?.url ||
      "";
    if (!candidate) return null;
    return new URL(String(candidate), targetUrl).toString();
  } catch {
    return null;
  }
}

function inferAudioMimeType(rawMimeType: string, filename: string): string {
  const normalized = String(rawMimeType || "").toLowerCase().split(";")[0].trim();
  if (normalized && normalized !== "application/octet-stream") return normalized;

  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
  if (ext === ".ogg" || ext === ".oga" || ext === ".opus") return "audio/ogg";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".amr") return "audio/amr";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".webm") return "audio/webm";
  if (ext === ".3gp" || ext === ".3gpp") return "audio/3gpp";
  return normalized;
}

function isSupportedVideoInput(file: Express.Multer.File): boolean {
  const normalizedMime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  const normalizedExt = path.extname(String(file.originalname || "")).toLowerCase();
  if (normalizedMime.startsWith("video/")) return true;
  if (normalizedMime === "application/octet-stream") {
    return [".mp4", ".mov", ".m4v", ".3gp", ".3gpp"].includes(normalizedExt);
  }
  return false;
}

async function transcodeToWhatsAppVideo(input: Buffer): Promise<Buffer> {
  const ffmpegPath = ffmpegStatic || process.env.FFMPEG_PATH || "ffmpeg";
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `wa_video_in_${nonce}`);
  const outputPath = path.join(os.tmpdir(), `wa_video_out_${nonce}.mp4`);

  const runPass = (options: { crf: string; maxrate: string; bufsize: string; audioBitrate: string; maxEdge: string }) =>
    new Promise<void>((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-map_metadata",
        "-1",
        "-vf",
        `scale='min(${options.maxEdge},iw)':'min(${options.maxEdge},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        options.crf,
        "-maxrate",
        options.maxrate,
        "-bufsize",
        options.bufsize,
        "-c:a",
        "aac",
        "-b:a",
        options.audioBitrate,
        "-ac",
        "2",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
        outputPath,
      ];

      const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      const errChunks: Buffer[] = [];

      ffmpeg.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
      ffmpeg.on("error", (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(errChunks).toString("utf8").trim();
          return reject(new Error(stderr || `FFmpeg exited with code ${code}`));
        }
        resolve();
      });
    });

  try {
    await fs.promises.writeFile(inputPath, input);

    await runPass({
      crf: "30",
      maxrate: "1200k",
      bufsize: "2400k",
      audioBitrate: "96k",
      maxEdge: "960",
    });
    let output = await fs.promises.readFile(outputPath);
    if (output.length <= WHATSAPP_VIDEO_MAX_BYTES) return output;

    await runPass({
      crf: "34",
      maxrate: "700k",
      bufsize: "1400k",
      audioBitrate: "64k",
      maxEdge: "720",
    });
    output = await fs.promises.readFile(outputPath);
    return output;
  } finally {
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});
  }
}

async function transcodeToWhatsAppAudio(input: Buffer): Promise<Buffer> {
  const ffmpegPath = ffmpegStatic || process.env.FFMPEG_PATH || "ffmpeg";

  return await new Promise<Buffer>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-f",
      "ogg",
      "pipe:1",
    ];
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => outChunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    ffmpeg.on("error", (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf8").trim();
        return reject(new Error(stderr || `FFmpeg exited with code ${code}`));
      }
      const output = Buffer.concat(outChunks);
      if (!output.length) return reject(new Error("FFmpeg output is empty"));
      resolve(output);
    });

    ffmpeg.stdin.on("error", () => {
      // ignore EPIPE when ffmpeg exits early on invalid input
    });
    ffmpeg.stdin.end(input);
  });
}

// Download audio from WhatsApp and transcribe with Whisper
async function transcribeWhatsAppAudio(mediaId: string, mimeType?: string): Promise<string | null> {
  const token = process.env.META_ACCESS_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  logAudioDebug("START", { mediaId, mimeType, hasToken: !!token, hasOpenAI: !!openaiKey });
  
  if (!token) {
    logAudioDebug("ERROR", { reason: "Missing META_ACCESS_TOKEN" });
    return null;
  }
  
  if (!openaiKey) {
    logAudioDebug("ERROR", { reason: "Missing OPENAI_API_KEY" });
    return null;
  }
  
  // Create OpenAI client with current API key
  const openai = new OpenAI({ apiKey: openaiKey });

  // Determine file extension from mime type
  // Note: OpenAI Whisper accepts: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
  // WhatsApp sends "audio/ogg; codecs=opus" - must use .ogg extension (not .opus)
  let extension = ".ogg";
  if (mimeType) {
    if (mimeType.includes("ogg") || mimeType.includes("opus")) extension = ".ogg";
    else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) extension = ".mp3";
    else if (mimeType.includes("mp4") || mimeType.includes("m4a")) extension = ".m4a";
    else if (mimeType.includes("wav")) extension = ".wav";
    else if (mimeType.includes("webm")) extension = ".webm";
    else if (mimeType.includes("flac")) extension = ".flac";
  }

  let tempPath: string | null = null;

  try {
    // Step 1: Get media URL from WhatsApp
    logAudioDebug("STEP1_GET_URL", { mediaId });
    const mediaResponse = await axios.get(
      `https://graph.facebook.com/v24.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const mediaUrl = mediaResponse.data.url;
    const mediaMimeType = mediaResponse.data.mime_type || mimeType;
    logAudioDebug("STEP1_SUCCESS", { hasUrl: !!mediaUrl, mime: mediaMimeType });

    // Step 2: Download the audio file
    logAudioDebug("STEP2_DOWNLOAD", { urlPrefix: mediaUrl?.substring(0, 50) });
    const audioResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer'
    });

    const audioSize = audioResponse.data.byteLength;
    logAudioDebug("STEP2_SUCCESS", { size: audioSize });

    if (audioSize < 100) {
      logAudioDebug("ERROR", { reason: "File too small", size: audioSize });
      return null;
    }

    // Step 3: Save to temp file
    tempPath = path.join(os.tmpdir(), `wa_audio_${mediaId}${extension}`);
    fs.writeFileSync(tempPath, Buffer.from(audioResponse.data));
    logAudioDebug("STEP3_SAVED", { path: tempPath, extension });

    // Step 4: Transcribe with OpenAI Whisper
    logAudioDebug("STEP4_TRANSCRIBE", { model: "whisper-1" });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      language: "es"
    });
    
    logAudioDebug("STEP4_SUCCESS", { text: transcription.text });
    return transcription.text || null;

  } catch (error: any) {
    logAudioDebug("ERROR", { 
      message: error.message, 
      status: error.response?.status,
      data: error.response?.data 
    });
    return null;
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
        logAudioDebug("CLEANUP", { deleted: tempPath });
      } catch (e: any) {
        logAudioDebug("CLEANUP_ERROR", { error: e.message });
      }
    }
  }
}

// TTS options interface
interface TtsOptions {
  speed?: number; // 0.25 - 4.0, default 1.0
  instructions?: string | null; // Only for realistic voices
  provider?: string; // "openai" or "elevenlabs"
  elevenlabsVoiceId?: string; // ElevenLabs voice ID
}

function normalizeTextForTts(rawText: string): string {
  if (!rawText) return rawText;

  const repairedText = repairMojibakeText(rawText);
  const parsedInteractive = parseInteractiveElements(repairedText);

  const normalized = (parsedInteractive.cleanText || repairedText)
    .replace(/\[IMAGEN:\s*[^\]]+\]/gi, " ")
    .replace(/\[(?:PEDIDO_LISTO|LLAMAR|NECESITO_HUMANO)\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\|/g, ", ")
    .replace(/(\d[\d.,]*)\s*bs\b/gi, "$1 bolivianos")
    .replace(/\bbs\b/gi, "bolivianos")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return normalized;
}

// Get ElevenLabs API key via Replit connector
async function getElevenLabsApiKey(): Promise<string> {
  const directApiKey = process.env.ELEVENLABS_API_KEY;
  if (directApiKey && directApiKey.trim().length > 0) {
    return directApiKey.trim();
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('ElevenLabs connector token not found');
  }

  const res = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=elevenlabs',
    { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }
  );
  const data = await res.json();
  const conn = data.items?.[0];
  if (!conn || !conn.settings?.api_key) {
    throw new Error('ElevenLabs not connected');
  }
  return conn.settings.api_key;
}

function getElevenLabsErrorMessage(error: any): string {
  const data = error?.response?.data;
  if (!data) return error?.message || "Unknown ElevenLabs error";
  if (Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString("utf8")).detail?.message || data.toString("utf8");
    } catch {
      return data.toString("utf8");
    }
  }
  if (typeof data === "string") return data;
  return data?.detail?.message || data?.detail || data?.message || JSON.stringify(data);
}

// Generate audio buffer using ElevenLabs TTS with model fallback for account compatibility
async function generateElevenLabsAudio(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = await getElevenLabsApiKey();
  const modelsToTry = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"];
  const attemptErrors: string[] = [];

  for (const modelId of modelsToTry) {
    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128&optimize_streaming_latency=4`,
        {
          text,
          model_id: modelId,
          language_code: "es",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            use_speaker_boost: false,
          },
        },
        {
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
        }
      );
      console.log("[ElevenLabs] TTS success", { voiceId, modelId, size: response.data?.byteLength || 0 });
      return Buffer.from(response.data);
    } catch (error: any) {
      const message = getElevenLabsErrorMessage(error);
      attemptErrors.push(`${modelId}: ${message}`);
      console.error("[ElevenLabs] TTS attempt failed", { voiceId, modelId, message });
    }
  }

  throw new Error(`ElevenLabs TTS failed. ${attemptErrors.join(" | ")}`);
}

async function generateTtsAudioBuffer(
  text: string,
  voice: string = "nova",
  options: TtsOptions = {},
  output: "whatsapp" | "preview" = "whatsapp",
): Promise<{ audioBuffer: Buffer; fileExt: "mp3" | "opus"; contentType: string }> {
  const provider = options.provider || "openai";
  const isElevenLabs = provider === "elevenlabs";
  const openaiKey = process.env.OPENAI_API_KEY;

  if (isElevenLabs) {
    const elVoiceId = options.elevenlabsVoiceId || "JBFqnCBsd6RMkjVDRZzb";
    const audioBuffer = await generateElevenLabsAudio(text, elVoiceId);
    return {
      audioBuffer,
      fileExt: "mp3",
      contentType: "audio/mpeg",
    };
  }

  if (!openaiKey) {
    throw new Error("Missing OpenAI API key");
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const realisticVoices = ["ash", "ballad", "sage", "verse", "marin", "cedar"];
  const isRealisticVoice = realisticVoices.includes(voice.toLowerCase());
  const ttsModel = isRealisticVoice ? "gpt-4o-mini-tts" : "tts-1";
  const speed = options.speed ? Math.max(0.25, Math.min(4.0, options.speed)) : 1.0;
  const responseFormat = output === "preview" ? "mp3" : "opus";

  const ttsRequest: any = {
    model: ttsModel,
    voice: voice as any,
    input: text,
    response_format: responseFormat,
    speed,
  };

  if (isRealisticVoice && options.instructions) {
    ttsRequest.instructions = options.instructions;
  }

  const audioResponse = await openai.audio.speech.create(ttsRequest);
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  if (output === "preview") {
    return {
      audioBuffer,
      fileExt: "mp3",
      contentType: "audio/mpeg",
    };
  }

  return {
    audioBuffer,
    fileExt: "opus",
    contentType: "audio/ogg; codecs=opus",
  };
}

// Generate audio response and send via WhatsApp
async function sendAudioResponse(phoneNumber: string, text: string, voice: string = "nova", options: TtsOptions = {}): Promise<boolean> {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  
  if (!token || !phoneNumberId) {
    console.log("[TTS] Missing WhatsApp credentials");
    return false;
  }
  
  const provider = options.provider || "openai";
  
  let tempPath: string | null = null;
  
  try {
    const ttsText = normalizeTextForTts(text);
    if (!ttsText) {
      console.log("[TTS] Skipping audio: no speech-safe text after normalization");
      return false;
    }
    console.log("[TTS] Prepared speech text", {
      provider,
      originalLength: text.length,
      speechLength: ttsText.length,
    });

    const generated = await generateTtsAudioBuffer(ttsText, voice, options, "whatsapp");
    const sourceAudioBuffer = generated.audioBuffer;
    console.log("[TTS] Audio generated:", sourceAudioBuffer.length, "bytes", {
      provider,
      fileExt: generated.fileExt,
      contentType: generated.contentType,
    });

    const audioBuffer = await transcodeToWhatsAppAudio(sourceAudioBuffer);
    const fileExt = "ogg";
    const contentType = "audio/ogg";
    console.log("[TTS] Audio transcoded for WhatsApp:", audioBuffer.length, "bytes");
    
    tempPath = path.join(os.tmpdir(), `tts_${Date.now()}.${fileExt}`);
    fs.writeFileSync(tempPath, audioBuffer);
    
    // Step 3: Upload to WhatsApp Media
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempPath), {
      filename: `audio.${fileExt}`,
      contentType: contentType
    });
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', contentType);
    
    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...formData.getHeaders()
        }
      }
    );
    
    const mediaId = uploadResponse.data.id;
    console.log("[TTS] Media uploaded, ID:", mediaId);
    
    // Step 4: Send audio message
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "audio",
        audio: { id: mediaId }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    console.log("[TTS] Audio message sent successfully");
    return true;
    
  } catch (error: any) {
    console.error("[TTS] Error:", error.message);
    if (error.response?.data) {
      console.error("[TTS] Details:", JSON.stringify(error.response.data));
    }
    return false;
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }
}

// Push notification logs (in-memory, max 50)
const pushLogs: Array<{timestamp: string, title: string, message: string, event: string, success: boolean, error?: string}> = [];
const waStatusLogs: Array<{
  timestamp: string;
  messageId?: string;
  recipientId?: string;
  status?: string;
  conversationId?: string;
  errors?: any;
}> = [];

// Send push notification via OneSignal
async function sendPushNotification(
  title: string,
  message: string,
  data?: Record<string, string>,
  options?: { targetExternalIds?: string[] },
) {
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  const appId = process.env.ONESIGNAL_APP_ID;
  const configuredSegmentsRaw = process.env.ONESIGNAL_SEGMENTS || process.env.ONESIGNAL_SEGMENT || "Subscribed Users";
  const configuredSegments = configuredSegmentsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const timestamp = new Date().toISOString();
  const event = data?.event || "unknown";
  const uniqueTopic = `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetExternalIds = await filterPushExternalIdsByAgentSettings(options?.targetExternalIds?.filter(Boolean) || []);
  const targetUrl = getPushTargetUrl(data);

  console.log("[OneSignal] Attempting to send notification:", { title, message });
  console.log("[OneSignal] API Key configured:", !!apiKey);

  if (!apiKey) {
    console.log("[OneSignal] ERROR: API key not configured, skipping push notification");
    pushLogs.unshift({ timestamp, title, message, event, success: false, error: "API key not configured" });
    if (pushLogs.length > 50) pushLogs.pop();
    return;
  }

  if (!appId) {
    console.log("[OneSignal] ERROR: App ID not configured, skipping push notification");
    pushLogs.unshift({ timestamp, title, message, event, success: false, error: "App ID not configured" });
    if (pushLogs.length > 50) pushLogs.pop();
    return;
  }

  try {
    const payload: Record<string, any> = {
      app_id: appId,
      headings: { en: title },
      contents: { en: message },
      data: data || {},
      url: targetUrl,
      chrome_web_icon: "https://ryzapp.org/icon-512.png",
      web_push_topic: uniqueTopic,
      ttl: 60,
    };

    if (targetExternalIds.length > 0) {
      payload.include_aliases = { external_id: targetExternalIds };
      payload.target_channel = "push";
    } else {
      payload.included_segments = configuredSegments;
    }
    
    console.log("[OneSignal] Sending payload:", JSON.stringify(payload, null, 2));
    
    const response = await axios.post(
      "https://onesignal.com/api/v1/notifications",
      payload,
      {
        headers: {
          Authorization: `Basic ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("[OneSignal] SUCCESS - Response:", JSON.stringify(response.data, null, 2));
    pushLogs.unshift({ timestamp, title, message, event, success: true });
    if (pushLogs.length > 50) pushLogs.pop();
  } catch (error: any) {
    console.error("[OneSignal] FAILED - Error:", error.response?.data || error.message);
    const errorMsg = JSON.stringify(error.response?.data) || error.message;
    
    // If configured segment fails, try "All" segment as fallback
    if (
      targetExternalIds.length === 0 &&
      error.response?.data?.errors?.some?.((e: string) => typeof e === "string" && e.includes("Segment") && e.includes("was not found"))
    ) {
      console.log("[OneSignal] Retrying with 'All' segment...");
      try {
        const fallbackResponse = await axios.post(
          "https://onesignal.com/api/v1/notifications",
          {
            app_id: appId,
            included_segments: ["All"],
            headings: { en: title },
            contents: { en: message },
            data: data || {},
            url: targetUrl,
            chrome_web_icon: "https://ryzapp.org/icon-512.png",
            web_push_topic: uniqueTopic,
            ttl: 60,
          },
          {
            headers: {
              Authorization: `Basic ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log("[OneSignal] Fallback SUCCESS:", JSON.stringify(fallbackResponse.data, null, 2));
        pushLogs.unshift({ timestamp, title, message, event, success: true });
        if (pushLogs.length > 50) pushLogs.pop();
      } catch (fallbackError: any) {
        console.error("[OneSignal] Fallback FAILED:", fallbackError.response?.data || fallbackError.message);
        pushLogs.unshift({ timestamp, title, message, event, success: false, error: errorMsg });
        if (pushLogs.length > 50) pushLogs.pop();
      }
    } else {
      pushLogs.unshift({ timestamp, title, message, event, success: false, error: errorMsg });
      if (pushLogs.length > 50) pushLogs.pop();
    }
  }
}

async function flushIncomingPushSummary(conversationId: number) {
  const state = incomingPushStateByConversation.get(conversationId);
  if (!state) return;

  state.timer = null;
  if (state.pendingCount <= 0) return;
  const prefs = await getPushNotificationPreferences();
  if (!prefs.notifyNewMessages) {
    state.pendingCount = 0;
    return;
  }

  const count = state.pendingCount;
  const summaryTitle = count === 1 ? "Nuevo mensaje" : "Nuevos mensajes";
  const summaryMessage =
    count === 1
      ? `${state.senderName}: ${state.latestPreview}`
      : `${state.senderName}: ${count} mensajes nuevos`;

  sendPushNotification(summaryTitle, summaryMessage, {
    conversationId: conversationId.toString(),
    event: "incoming_message_batch",
    count: count.toString(),
  }, {
    targetExternalIds: state.targetExternalIds,
  });

  state.pendingCount = 0;
  state.lastSentAt = Date.now();
}

async function queueIncomingMessagePush(
  conversationId: number,
  senderName: string,
  previewRaw: string | null | undefined,
  waId: string,
  assignedAgentId?: number | null,
) {
  const prefs = await getPushNotificationPreferences();
  if (!prefs.notifyNewMessages) return;
  const preview = (previewRaw || "[Mensaje]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const safeSender = senderName || waId;
  const now = Date.now();
  const targetExternalIds = getPushRecipientExternalIds(assignedAgentId);

  let state = incomingPushStateByConversation.get(conversationId);
  if (!state) {
    sendPushNotification("Nuevo mensaje", `${safeSender}: ${preview}`, {
      conversationId: conversationId.toString(),
      waId,
      event: "incoming_message",
    }, {
      targetExternalIds,
    });
    incomingPushStateByConversation.set(conversationId, {
      lastSentAt: now,
      pendingCount: 0,
      latestPreview: preview,
      senderName: safeSender,
      targetExternalIds,
      timer: null,
    });
    return;
  }

  state.pendingCount += 1;
  state.latestPreview = preview;
  state.senderName = safeSender;
  state.targetExternalIds = targetExternalIds;

  if (!state.timer) {
    const elapsed = now - state.lastSentAt;
    const delay = Math.max(0, INCOMING_PUSH_COOLDOWN_MS - elapsed);
    state.timer = setTimeout(() => {
      void flushIncomingPushSummary(conversationId);
    }, delay);
  }
}

function reminderPushKey(conversationId: number, reminderAt: Date, minutesBefore: number) {
  return `${conversationId}:${reminderAt.toISOString()}:${minutesBefore}`;
}

async function checkAndSendReminderPushes() {
  const now = Date.now();
  const prefs = await getPushNotificationPreferences();
  const reminderLeadMinutes = normalizeReminderLeadMinutes(prefs.reminderLeadMinutes);
  if (reminderLeadMinutes.length === 0) return;
  const maxLeadMinutes = Math.max(...reminderLeadMinutes);
  const remindersResult: any = await db.execute(sql`
    SELECT id, wa_id, contact_name, reminder_at, reminder_note, assigned_agent_id
    FROM conversations
    WHERE reminder_at IS NOT NULL
      AND COALESCE(reminder_done, false) = false
      AND reminder_at > NOW()
      AND reminder_at <= NOW() + ${maxLeadMinutes + 1} * INTERVAL '1 minute'
  `);
  const reminders = remindersResult?.rows ?? [];
  const activeKeys = new Set<string>();

  for (const row of reminders) {
    if (!row?.reminder_at) continue;
    const reminderAt = new Date(row.reminder_at as Date | string);
    if (Number.isNaN(reminderAt.getTime())) continue;

    const diffMs = reminderAt.getTime() - now;
    if (diffMs <= 0) continue;

    for (const minutesBefore of reminderLeadMinutes) {
      const conversationId = Number(row.id);
      if (!Number.isFinite(conversationId)) continue;
      const key = reminderPushKey(conversationId, reminderAt, minutesBefore);
      activeKeys.add(key);
      if (sentReminderPushKeys.has(key)) continue;

      const targetMs = minutesBefore * 60 * 1000;
      const lowerBound = targetMs - REMINDER_PUSH_WINDOW_MS;
      const upperBound = targetMs + REMINDER_PUSH_WINDOW_MS;
      if (diffMs < lowerBound || diffMs > upperBound) continue;

      const note = String(row.reminder_note || "").trim();
      const summary = note ? note.replace(/\s+/g, " ").slice(0, 90) : "Tiene un recordatorio pendiente";
      const contact = String(row.contact_name || row.wa_id || "Cliente");
      const waId = String(row.wa_id || "");
      const assignedAgentId =
        row.assigned_agent_id === null || row.assigned_agent_id === undefined
          ? null
          : Number(row.assigned_agent_id);

      await sendPushNotification(
        `Recordatorio en ${minutesBefore} min`,
        `${contact}: ${summary}`,
        {
          conversationId: conversationId.toString(),
          waId,
          event: `reminder_${minutesBefore}m`,
        },
        getConversationPushOptions({ assignedAgentId }),
      );

      sentReminderPushKeys.set(key, now);
    }
  }

  sentReminderPushKeys.forEach((sentAt, key) => {
    if (!activeKeys.has(key) && now - sentAt > 6 * 60 * 60 * 1000) {
      sentReminderPushKeys.delete(key);
    }
  });
}

// Endpoint to get push logs
export function getPushLogs() {
  return pushLogs;
}

// Parse interactive elements from AI response text
function parseInteractiveElements(text: string): { cleanText: string; buttons?: string[]; list?: { title: string; options: string[] } } {
  // Check for buttons: [BOTONES: opt1, opt2, opt3]
  const buttonMatch = text.match(/\[BOTONES:\s*(.+?)\]/i);
  if (buttonMatch) {
    const buttons = buttonMatch[1].split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
    const cleanText = text.replace(/\[BOTONES:\s*.+?\]/i, '').trim();
    if (buttons.length > 0) return { cleanText, buttons };
  }

  // Check for list: [LISTA: title | opt1, opt2, ..., opt10]
  const listMatch = text.match(/\[LISTA:\s*(.+?)\s*\|\s*(.+?)\]/i);
  if (listMatch) {
    const title = listMatch[1].trim();
    const options = listMatch[2].split(',').map(o => o.trim()).filter(Boolean).slice(0, 10);
    const cleanText = text.replace(/\[LISTA:\s*.+?\]/i, '').trim();
    if (options.length > 0) return { cleanText, list: { title, options } };
  }

  return { cleanText: text };
}

// Helper to send messages via Graph API
async function sendToWhatsApp(to: string, type: 'text' | 'image' | 'interactive', content: any) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;

  console.log("=== SENDING MESSAGE ===");
  console.log("To:", to);
  console.log("Type:", type);
  console.log("PhoneId:", phoneId);
  console.log("Token exists:", !!token);

  if (!token || !phoneId) {
    throw new Error("Missing Meta configuration (token or phone ID)");
  }

  const url = `https://graph.facebook.com/v24.0/${phoneId}/messages`;
  
  const formattedTo = to.startsWith('+') ? to : `+${to}`;
  
  const payload: any = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: type,
  };
  if (content.replyToMessageId) {
    payload.context = { message_id: content.replyToMessageId };
  }

  if (type === 'text') {
    payload.text = { body: content.text };
  } else if (type === 'image') {
    payload.image = { link: resolvePublicImageUrl(content.imageUrl) };
    if (content.caption) {
      payload.image.caption = content.caption;
    }
  } else if (type === 'interactive') {
    payload.interactive = content.interactive;
  }

  const sanitizedPayload = repairMojibakeDeep(payload);

  console.log("URL:", url);
  console.log("Payload:", JSON.stringify(sanitizedPayload, null, 2));

  try {
    const response = await axios.post(url, sanitizedPayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    console.log("WhatsApp Response:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: any) {
    console.error("=== WHATSAPP API ERROR ===");
    console.error("Status:", error.response?.status);
    console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

// Send AI response with interactive elements if detected
async function sendAiResponseToWhatsApp(to: string, responseText: string) {
  const sanitizedResponseText = repairMojibakeText(responseText);
  const parsed = parseInteractiveElements(sanitizedResponseText);

  if (parsed.buttons && parsed.buttons.length > 0) {
    const interactive = {
      type: "button",
      body: { text: parsed.cleanText || "Elige una opcion:" },
      action: {
        buttons: parsed.buttons.map((btn, i) => ({
          type: "reply",
          reply: { id: `btn_${i}_${Date.now()}`, title: btn.substring(0, 20) },
        })),
      },
    };
    return sendToWhatsApp(to, 'interactive', { interactive });
  }

  if (parsed.list && parsed.list.options.length > 0) {
    const interactive = {
      type: "list",
      body: { text: parsed.cleanText || "Elige una opcion:" },
      action: {
        button: parsed.list.title.substring(0, 20),
        sections: [{
          title: parsed.list.title.substring(0, 24),
          rows: parsed.list.options.map((opt, i) => ({
            id: `list_${i}_${Date.now()}`,
            title: opt.substring(0, 24),
          })),
        }],
      },
    };
    return sendToWhatsApp(to, 'interactive', { interactive });
  }

  return sendToWhatsApp(to, 'text', { text: sanitizedResponseText });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await ensureProductImageColumnsExist();
  await ensureConversationLabelColumnsExist();
  await ensureDailyCostSettingsTableExists();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
    ON user_sessions (expire)
  `);

  // === SESSION SETUP ===
  const SessionStore = MemoryStore(session);
  const PgSessionStore = connectPgSimple(session);
  const sessionStoreMode = String(process.env.SESSION_STORE || "memory").trim().toLowerCase();
  const sessionSecret = process.env.SESSION_SECRET || "default_secret";
  let sessionStore: session.Store = new SessionStore({
    checkPeriod: 86400000,
  });

  if (sessionSecret === "default_secret") {
    console.warn("[Session] SESSION_SECRET not set. Using default secret is not recommended for production.");
  }

  if (sessionStoreMode === "postgres") {
    try {
      await pool.query("SELECT 1");
      sessionStore = new PgSessionStore({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: false,
      });
      console.log("[Session] Using Postgres session store (table: user_sessions)");
    } catch (error) {
      console.error("[Session] Failed to initialize Postgres store. Falling back to MemoryStore.", error);
      sessionStore = new SessionStore({
        checkPeriod: 86400000,
      });
    }
  } else {
    console.log("[Session] Using MemoryStore (SESSION_STORE=memory)");
  }

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 2592000000 }, // 30 days
      store: sessionStore,
    })
  );

  app.use((req: any, _res, next) => {
    if (req.session?.authenticated) {
      req.session.clientInfo = buildSessionClientInfo(req);
      req.session.lastSeenAt = new Date().toISOString();
      if (!req.session.loginAt) {
        req.session.loginAt = req.session.lastSeenAt;
      }
    }
    next();
  });

  // === DIAGNOSTIC ENDPOINTS (Public) ===
  app.get("/api/public-config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({
      oneSignalAppId: process.env.ONESIGNAL_APP_ID || process.env.VITE_ONESIGNAL_APP_ID || null,
    });
  });

  app.get("/api/audio-logs", (req, res) => {
    res.json({ logs: audioDebugLogs, count: audioDebugLogs.length });
  });

  app.get("/api/test-whisper", async (req, res) => {
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.json({ error: "OPENAI_API_KEY not configured", keyAvailable: false });
      }
      
      const openai = new OpenAI({ apiKey: openaiKey });
      
      // Try to list models to verify the key works
      const models = await openai.models.list();
      const audioModels = models.data.filter(m => 
        m.id.includes('whisper') || m.id.includes('transcribe') || m.id.includes('tts')
      );
      
      return res.json({
        keyAvailable: true,
        keyPrefix: openaiKey.substring(0, 12) + "...",
        audioModelsAvailable: audioModels.map(m => m.id),
        totalModels: models.data.length,
        hasWhisper: audioModels.some(m => m.id.includes('whisper')),
        hasTranscribe: audioModels.some(m => m.id.includes('transcribe'))
      });
    } catch (error: any) {
      return res.json({ error: error.message, keyAvailable: !!process.env.OPENAI_API_KEY });
    }
  });

  // === WEBHOOK DEBUG (Temporary) ===
  const webhookDebugLog: Array<{ timestamp: string; hasBody: boolean; object: string; entryCount: number; raw: string }> = [];
  
  app.get("/webhook-debug", (req, res) => {
    res.json({ count: webhookDebugLog.length, logs: webhookDebugLog });
  });

  // === WEBHOOK (Public) ===
  
  // Verification
  app.get("/webhook", (req, res) => {
    const verifyToken = process.env.WA_VERIFY_TOKEN;
    
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === verifyToken) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  // Receiving messages
  app.post("/webhook", async (req, res) => {
    console.log("=== WEBHOOK RECEIVED ===");
    console.log("Body:", JSON.stringify(req.body, null, 2));
    
    webhookDebugLog.push({
      timestamp: new Date().toISOString(),
      hasBody: !!req.body,
      object: req.body?.object || "none",
      entryCount: req.body?.entry?.length || 0,
      raw: JSON.stringify(req.body).substring(0, 500),
    });
    if (webhookDebugLog.length > 20) webhookDebugLog.shift();
    
    // Always return 200 OK to Meta immediately
    res.sendStatus(200);

    try {
      const body = req.body;
      
      // Basic validation of the payload structure
      if (!body.object) {
        console.log("No body.object found, skipping");
        return;
      }

      if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;
            
            if (!value) continue;

            // Handle Messages (iterate ALL messages in payload)
            if (value.messages && value.messages.length > 0) {
              for (const msg of value.messages) {
              console.log("=== MESSAGE RECEIVED ===");
              console.log("Message ID:", msg.id);
              console.log("From:", msg.from);
              console.log("Type:", msg.type);
              const from = msg.from; // wa_id
              const name = value.contacts?.[0]?.profile?.name || from;
              
              let messageText: string | null = null;
              let messageForAi: string | null = null;
              let wasAudioMessage = false;
              let imageBase64ForAi: string | undefined = undefined;
              
              if (msg.type === 'text') {
                messageText = msg.text.body;
                messageForAi = msg.text.body;
              } else if (msg.type === 'location') {
                // Handle location/GPS/Maps messages
                const loc = msg.location;
                const lat = loc?.latitude;
                const lon = loc?.longitude;
                const locName = loc?.name || '';
                const locAddress = loc?.address || '';
                
                messageText = locName 
                  ? `[Ubicacion: ${locName}${locAddress ? ' - ' + locAddress : ''}]`
                  : `[Ubicacion GPS: ${lat}, ${lon}]`;
                
                // Tell AI they received a location/address
                messageForAi = `[El cliente envio su UBICACION/DIRECCION DE ENTREGA: ${locName || 'Ubicacion GPS'}${locAddress ? ', ' + locAddress : ''}. Coordenadas: ${lat}, ${lon}. Esto significa que esta compartiendo su direccion para un pedido.]`;
                
                console.log("=== LOCATION RECEIVED ===", { lat, lon, locName, locAddress });
              } else if (msg.type === 'image') {
                messageText = '[Imagen]';
                const imageId = msg.image?.id;
                
                if (imageId) {
                  try {
                    // Download image from WhatsApp and convert to base64 for vision
                    const token = process.env.META_ACCESS_TOKEN;
                    const mediaResponse = await axios.get(
                      `https://graph.facebook.com/v24.0/${imageId}`,
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    const mediaUrl = mediaResponse.data.url;
                    
                    const imageResponse = await axios.get(mediaUrl, {
                      headers: { Authorization: `Bearer ${token}` },
                      responseType: 'arraybuffer'
                    });
                    
                    imageBase64ForAi = Buffer.from(imageResponse.data).toString('base64');
                    messageForAi = 'El cliente envio esta imagen. Analiza que producto muestra y responde.';
                    console.log("=== IMAGE DOWNLOADED FOR VISION ===", { imageId, size: imageResponse.data.byteLength });
                  } catch (imgError) {
                    console.error("Error downloading image for vision:", imgError);
                    messageForAi = '[El cliente envio una imagen que no se pudo analizar]';
                  }
                } else {
                  messageForAi = '[El cliente envio una imagen]';
                }
              } else if (msg.type === 'sticker') {
                messageText = '[Sticker]';
                messageForAi = '[El cliente envio un sticker]';
              } else if (msg.type === 'audio') {
                // Handle voice notes and audio messages
                wasAudioMessage = true;
                const audioId = msg.audio?.id;
                const audioMimeType = msg.audio?.mime_type;
                console.log("=== AUDIO MESSAGE RECEIVED ===", { audioId, mimeType: audioMimeType });
                
                if (audioId) {
                  // Transcribe the audio with Whisper
                  const transcription = await transcribeWhatsAppAudio(audioId, audioMimeType);
                  
                  if (transcription) {
                    messageText = `[Audio]: "${transcription}"`;
                    messageForAi = transcription; // Pass transcription directly to AI
                    console.log("=== AUDIO TRANSCRIBED ===", transcription);
                  } else {
                    messageText = '[Audio - no se pudo transcribir]';
                    messageForAi = '[El cliente envio un audio que no se pudo transcribir]';
                  }
                } else {
                  messageText = '[Audio]';
                  messageForAi = '[El cliente envio un audio]';
                }
              } else if (msg.type === 'video') {
                const videoCaption = String(msg.video?.caption || "").trim();
                messageText = videoCaption || "[Video]";
                messageForAi = videoCaption || "[El cliente envio un video]";
              } else if (msg.type === 'interactive') {
                // Handle button or list replies
                const interactiveReply = msg.interactive;
                if (interactiveReply?.type === 'button_reply') {
                  messageText = interactiveReply.button_reply.title;
                  messageForAi = interactiveReply.button_reply.title;
                } else if (interactiveReply?.type === 'list_reply') {
                  messageText = interactiveReply.list_reply.title;
                  messageForAi = interactiveReply.list_reply.title;
                } else {
                  messageText = `[Respuesta interactiva]`;
                  messageForAi = `[El cliente selecciono una opcion interactiva]`;
                }
                console.log("=== INTERACTIVE REPLY ===", messageText);
              } else {
                messageText = `[${msg.type}]`;
                messageForAi = `[El cliente envio un mensaje de tipo: ${msg.type}]`;
              }

              // 2. Ensure Conversation Exists (now using correct messageText)
              let conversation = await storage.getConversationByWaId(from);
              let adProductRouteForAi: string | null = null;
              if (!conversation) {
                const incomingAdId = extractAdIdFromIncomingMessage(msg);
                const adRouting = incomingAdId ? await getNextAgentForAdIdRouting(incomingAdId) : {};
                if (adRouting.rule?.isActive) {
                  adProductRouteForAi = adRouting.rule.productRoute || null;
                }
                const nextAgent = adRouting.agent || await storage.getNextAgentForAssignment({
                  excludeAgentIds: await getExclusiveAdRoutingAgentIds(),
                });
                conversation = await storage.createConversation({
                  waId: from,
                  contactName: name,
                  lastMessage: messageText || `[${msg.type}]`,
                  lastMessageTimestamp: new Date(parseInt(msg.timestamp) * 1000),
                  assignedAgentId: nextAgent?.id || null,
                });
                if (nextAgent) {
                  if (incomingAdId && adRouting.agent) {
                    console.log(
                      `[Auto-Assign][AdRule] ad_id=${incomingAdId} -> agent=${nextAgent.name} (id: ${nextAgent.id})`,
                    );
                  } else if (incomingAdId && adRouting.rule && !adRouting.agent) {
                    console.log(
                      `[Auto-Assign][AdRule-Fallback] ad_id=${incomingAdId} no active mapped agents, fallback -> ${nextAgent.name} (id: ${nextAgent.id})`,
                    );
                  } else {
                    console.log(`[Auto-Assign] New conversation assigned to agent: ${nextAgent.name} (id: ${nextAgent.id})`);
                  }
                }
              } else {
                await storage.updateConversation(conversation.id, {
                  contactName: name,
                  lastMessage: messageText || `[${msg.type}]`,
                  lastMessageTimestamp: new Date(parseInt(msg.timestamp) * 1000),
                  lastFollowUpAt: null,
                });
              }

              // 3. Prevent Duplicate Messages
              const existing = await storage.getMessageByWaId(msg.id);
              if (existing) continue;

              // 4. Save Message (include mediaId for media types)
              const mediaId = msg.image?.id || msg.sticker?.id || msg.audio?.id || msg.video?.id || null;
              const mimeType = msg.image?.mime_type || msg.sticker?.mime_type || msg.audio?.mime_type || msg.video?.mime_type || null;
              
              await storage.createMessage({
                conversationId: conversation.id,
                waMessageId: msg.id,
                direction: "in",
                type: msg.type,
                text: messageText,
                mediaId: mediaId,
                mimeType: mimeType,
                timestamp: msg.timestamp,
                status: "received",
                rawJson: msg,
              });

              await queueIncomingMessagePush(
                conversation.id,
                conversation.contactName || name || from,
                messageText,
                from,
                conversation.assignedAgentId,
              );

              // 5. AI Auto-Response with debounce buffer (groups rapid messages)
              let agentAllowsAi = true;
              if (conversation.assignedAgentId) {
                const assignedAgent = await storage.getAgent(conversation.assignedAgentId);
                if (assignedAgent && assignedAgent.isAiAutoReplyEnabled === false) {
                  agentAllowsAi = false;
                }
              }
              if (messageForAi && !conversation.aiDisabled && agentAllowsAi) {
                const bufferedMsg: BufferedMessage = {
                  messageForAi,
                  imageBase64ForAi,
                  wasAudioMessage,
                  conversationId: conversation.id,
                  from,
                  name,
                  adProductRoute: adProductRouteForAi,
                };

                const existing = messageBuffers.get(from);
                if (existing) {
                  clearTimeout(existing.timer);
                  existing.messages.push(bufferedMsg);
                  if (existing.messages.length >= 10) {
                    flushMessageBuffer(from);
                    console.log(`=== BUFFER FULL, FLUSHING for ${from} ===`);
                  } else {
                    existing.timer = setTimeout(() => flushMessageBuffer(from), AI_DEBOUNCE_MS);
                    console.log(`=== BUFFERED MESSAGE ${existing.messages.length} for ${from} ===`);
                  }
                } else {
                  const timer = setTimeout(() => flushMessageBuffer(from), AI_DEBOUNCE_MS);
                  messageBuffers.set(from, { messages: [bufferedMsg], timer });
                  console.log(`=== BUFFER STARTED for ${from} (${AI_DEBOUNCE_MS}ms) ===`);
                }
              }
              } // end for (const msg of value.messages)
            }

            // Handle Statuses (delivered, read)
            if (value.statuses && value.statuses.length > 0) {
              for (const status of value.statuses) {
                await storage.updateMessageStatus(status.id, status.status);
                const statusEntry = {
                  timestamp: new Date().toISOString(),
                  messageId: status.id,
                  recipientId: status.recipient_id,
                  status: status.status,
                  conversationId: status.conversation?.id,
                  errors: status.errors || null,
                };
                waStatusLogs.unshift(statusEntry);
                if (waStatusLogs.length > 100) waStatusLogs.pop();
                if (status.status === "failed") {
                  console.error("[WA STATUS FAILED]", JSON.stringify(statusEntry, null, 2));
                } else {
                  console.log("[WA STATUS]", status.id, status.status, status.recipient_id || "");
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error processing webhook:", error);
    }
  });


  // === AUTH MIDDLEWARE ===
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.session && req.session.authenticated) {
      next();
    } else {
      res.status(401).json({ message: "Unauthorized" });
    }
  };

  // === API ROUTES ===

  // Auth
  app.post(api.auth.login.path, async (req, res) => {
    const { username, password } = api.auth.login.input.parse(req.body);
    if (await storage.validateAdmin(username, password)) {
      (req.session as any).authenticated = true;
      (req.session as any).username = username;
      (req.session as any).role = "admin";
      (req.session as any).isPrimaryAdmin = true;
      (req.session as any).agentId = undefined;
      (req.session as any).subadminId = undefined;
      (req.session as any).loginAt = new Date().toISOString();
      (req.session as any).lastSeenAt = (req.session as any).loginAt;
      (req.session as any).clientInfo = buildSessionClientInfo(req);
      res.json({ success: true });
    } else {
      const subadmin = await storage.getSubadminByUsername(username);
      if (subadmin && subadmin.password === password && subadmin.isActive) {
        (req.session as any).authenticated = true;
        (req.session as any).username = subadmin.name;
        (req.session as any).role = "admin";
        (req.session as any).isPrimaryAdmin = false;
        (req.session as any).agentId = undefined;
        (req.session as any).subadminId = subadmin.id;
        (req.session as any).loginAt = new Date().toISOString();
        (req.session as any).lastSeenAt = (req.session as any).loginAt;
        (req.session as any).clientInfo = buildSessionClientInfo(req);
        res.json({ success: true });
      } else {
        const agent = await storage.getAgentByUsername(username);
        if (agent && agent.password === password) {
          (req.session as any).authenticated = true;
          (req.session as any).username = agent.name;
          (req.session as any).role = "agent";
          (req.session as any).isPrimaryAdmin = false;
          (req.session as any).agentId = agent.id;
          (req.session as any).subadminId = undefined;
          (req.session as any).loginAt = new Date().toISOString();
          (req.session as any).lastSeenAt = (req.session as any).loginAt;
          (req.session as any).clientInfo = buildSessionClientInfo(req);
          res.json({ success: true });
        } else {
          res.status(401).json({ message: "Invalid credentials" });
        }
      }
    }
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if ((req.session as any).authenticated) {
      res.json({ 
        authenticated: true, 
        username: (req.session as any).username,
        role: (req.session as any).role || "admin",
        agentId: (req.session as any).agentId,
        isPrimaryAdmin: (req.session as any).isPrimaryAdmin === true,
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.session && req.session.authenticated && req.session.role === "admin") {
      next();
    } else {
      res.status(403).json({ message: "Admin access required" });
    }
  };

  app.get("/api/admin/export-conversations", requireAdmin, async (req, res) => {
    try {
      const convs = await db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.lastMessageTimestamp))
        .limit(300);

      let textOutput = `======================================================================\n`;
      textOutput += `EXPORTE DE CONVERSACIONES DE CHAT (LÍMITE: 300)\n`;
      textOutput += `======================================================================\n\n`;

      for (const conv of convs) {
        const chatMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(messages.id);

        if (chatMessages.length === 0) continue;

        textOutput += `======================================================================\n`;
        textOutput += `CHAT: ${conv.contactName || "Sin Nombre"} (${conv.waId})\n`;
        textOutput += `======================================================================\n`;

        for (const m of chatMessages) {
          const sender = m.direction === "in" ? "CLIENTE" : "CRM";
          const body = m.body || `[${m.type}]`;
          textOutput += `${sender}: ${body}\n`;
        }
        textOutput += `\n`;
      }

      res.setHeader("Content-disposition", "attachment; filename=conversaciones_exportadas.txt");
      res.setHeader("Content-type", "text/plain; charset=utf-8");
      res.send(textOutput);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const requirePrimaryAdmin = (req: any, res: any, next: any) => {
    if (
      req.session &&
      req.session.authenticated &&
      req.session.role === "admin" &&
      req.session.isPrimaryAdmin === true
    ) {
      next();
    } else {
      res.status(403).json({ message: "Primary admin access required" });
    }
  };

  app.get("/api/agent-sessions", requireAdmin, async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT sid, sess, expire
        FROM user_sessions
        WHERE sess->>'authenticated' = 'true'
          AND sess->>'role' = 'agent'
        ORDER BY COALESCE(sess->>'lastSeenAt', sess->>'loginAt') DESC NULLS LAST, expire DESC
      `);

      const sessions = (result.rows as any[]).map((row) => {
        const sessionBody = typeof row.sess === "string" ? JSON.parse(row.sess) : row.sess;
        const clientInfo = sessionBody?.clientInfo || {};
        return {
          sid: row.sid,
          agentId: Number(sessionBody?.agentId || 0),
          username: sessionBody?.username || "Agente",
          loginAt: sessionBody?.loginAt || null,
          lastSeenAt: sessionBody?.lastSeenAt || null,
          expiresAt: row.expire || null,
          browser: clientInfo.browser || "Desconocido",
          os: clientInfo.os || "Desconocido",
          deviceType: clientInfo.deviceType || "Dispositivo",
          ip: clientInfo.ip || "IP oculta",
          userAgent: clientInfo.userAgent || "",
        };
      }).filter((item) => Number.isInteger(item.agentId) && item.agentId > 0);

      res.json(sessions);
    } catch (error) {
      console.error("Error fetching agent sessions:", error);
      res.status(500).json({ message: "Error fetching agent sessions" });
    }
  });

  app.delete("/api/agent-sessions/:sid", requireAdmin, async (req, res) => {
    try {
      const sid = String(req.params.sid || "");
      if (!sid) {
        return res.status(400).json({ message: "Session id required" });
      }
      if (sid === req.sessionID) {
        return res.status(400).json({ message: "No puedes cerrar tu propia sesion desde aqui" });
      }

      const result = await db.execute(sql`
        DELETE FROM user_sessions
        WHERE sid = ${sid}
          AND sess->>'authenticated' = 'true'
          AND sess->>'role' = 'agent'
        RETURNING sid
      `);
      if ((result.rows as any[]).length === 0) {
        return res.status(404).json({ message: "Sesion no encontrada" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting agent session:", error);
      res.status(500).json({ message: "Error deleting agent session" });
    }
  });

  // Conversations
  app.get(api.conversations.list.path, requireAuth, async (req, res) => {
    const session = req.session as any;
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit = typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
      ? parsedLimit
      : undefined;

    const beforeRaw = typeof req.query.before === "string" ? req.query.before : undefined;
    const parsedBefore = beforeRaw ? new Date(beforeRaw) : undefined;
    const before = parsedBefore && !Number.isNaN(parsedBefore.getTime()) ? parsedBefore : undefined;

    const searchRaw = typeof req.query.q === "string" ? req.query.q : undefined;
    const search = searchRaw?.trim() ? searchRaw.trim() : undefined;

    const assignedAgentId = session.role === "agent"
      ? Number(session.agentId)
      : undefined;

    const page = await storage.getConversationsPage({
      limit,
      before,
      assignedAgentId,
      search,
    });

    if (typeof assignedAgentId !== "number" || !Number.isFinite(assignedAgentId) || before || search) {
      res.json(page);
      return;
    }

    const assignmentRows = await db.execute(sql`
      SELECT
        conversation_id AS "conversationId",
        MAX(created_at) AS "assignedToMeAt"
      FROM conversation_assignment_events
      WHERE to_agent_id = ${assignedAgentId}
        AND assigned_by_role = 'admin'
        AND DATE(created_at AT TIME ZONE 'America/La_Paz') = (NOW() AT TIME ZONE 'America/La_Paz')::date
      GROUP BY conversation_id
      ORDER BY MAX(created_at) DESC
    `);
    const assignedToday = (assignmentRows.rows as any[])
      .map((row) => ({
        conversationId: Number(row.conversationId),
        assignedToMeAt: row.assignedToMeAt ?? null,
      }))
      .filter((row) => Number.isInteger(row.conversationId) && row.conversationId > 0 && row.assignedToMeAt);

    if (assignedToday.length === 0) {
      res.json(page);
      return;
    }

    const assignedByConversationId = new Map<number, any>(
      assignedToday.map((row) => [row.conversationId, row.assignedToMeAt]),
    );
    const pageById = new Map(page.map((conversation) => [conversation.id, conversation]));
    const extraAssignedConversations = [];

    for (const row of assignedToday) {
      if (pageById.has(row.conversationId)) continue;
      const conversation = await storage.getConversation(row.conversationId);
      if (conversation?.assignedAgentId === assignedAgentId) {
        extraAssignedConversations.push(conversation);
      }
    }

    const responsePage = [...extraAssignedConversations, ...page].map((conversation) => ({
      ...conversation,
      assignedToMeAt: assignedByConversationId.get(conversation.id) ?? null,
    }));

    res.json(responsePage);
  });

  app.get(api.conversations.get.path, requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string);
    const conversation = await storage.getConversation(id);
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    if ((req.session as any).role === "agent" && conversation.assignedAgentId !== (req.session as any).agentId) {
      return res.status(403).json({ message: "Access denied" });
    }
    const messages = await storage.getMessages(id);
    res.json({ conversation, messages });
  });

  const updateMessageTextSchema = z.object({
    text: z.string().trim().min(1).max(4000),
  });

  const reportSalesSchema = z.object({
    citrato: z.number().int().min(0).max(10000),
    berberina: z.number().int().min(0).max(10000),
    berberina2: z.number().int().min(0).max(10000),
  });

  const reportPayloadSchema = z.object({
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    operatorName: z.string().trim().max(120).optional().default(""),
    calls: z.object({
      made: z.number().int().min(0).max(10000),
      answered: z.number().int().min(0).max(10000),
      missed: z.number().int().min(0).max(10000),
      pending: z.number().int().min(0).max(10000),
    }),
    salesByCity: z.object({
      santaCruz: reportSalesSchema,
      laPaz: reportSalesSchema,
      cochabamba: reportSalesSchema,
      tarija: reportSalesSchema,
    }),
  });

  app.patch("/api/messages/:id", requireAuth, async (req, res) => {
    try {
      const messageId = Number(req.params.id);
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return res.status(400).json({ message: "Invalid message id" });
      }

      const parsed = updateMessageTextSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
      }

      const [existingMessage] = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.id, messageId))
        .limit(1);

      if (!existingMessage) {
        return res.status(404).json({ message: "Message not found" });
      }

      if (existingMessage.direction !== "out") {
        return res.status(400).json({ message: "Only outbound messages can be edited" });
      }

      if (!existingMessage.text || !existingMessage.text.trim()) {
        return res.status(400).json({ message: "Only text messages can be edited" });
      }

      const conversation = await storage.getConversation(existingMessage.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      if ((req.session as any).role === "agent" && conversation.assignedAgentId !== (req.session as any).agentId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const nextText = parsed.data.text.trim();

      const [updatedMessage] = await db
        .update(messagesTable)
        .set({ text: nextText })
        .where(eq(messagesTable.id, messageId))
        .returning();

      const [latestMessageInConversation] = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, existingMessage.conversationId))
        .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id))
        .limit(1);

      if (latestMessageInConversation?.id === messageId) {
        await storage.updateConversation(existingMessage.conversationId, { lastMessage: nextText });
      }

      res.json({ message: updatedMessage });
    } catch (error) {
      console.error("Error updating message text:", error);
      res.status(500).json({ message: "Error updating message" });
    }
  });

  app.delete("/api/conversations/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteConversation(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Error deleting conversation" });
    }
  });

  // Sending
  app.post(api.messages.send.path, requireAuth, async (req, res) => {
    try {
      const { to, type, text, imageUrl, caption, replyToMessageId } = api.messages.send.input.parse(req.body);
      const normalizedText = typeof text === "string" ? text.trim() : "";
      const normalizedImageUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
      const normalizedCaption = typeof caption === "string" ? caption.trim() : "";
      const effectiveImageCaption = type === "image" ? (normalizedCaption || normalizedText || undefined) : undefined;

      if (type === "text" && !normalizedText) {
        return res.status(400).json({ message: "Text is required for text messages" });
      }
      if (type === "image" && !normalizedImageUrl) {
        return res.status(400).json({ message: "imageUrl is required for image messages" });
      }
      
      // 1. Generate local predicted waMessageId
      const waMessageId = `outbound_${Date.now()}`;

      // 2. Find conversation (fast local db)
      let conversation = await storage.getConversationByWaId(to);
      if (!conversation) {
        // Should ideally exist if we are replying, but create if new outbound
        conversation = await storage.createConversation({
          waId: to,
          contactName: to, // No name known yet
          lastMessage: type === 'text' ? normalizedText : '[image]',
          lastMessageTimestamp: new Date(),
        });
      } else {
        await storage.updateConversation(conversation.id, {
          lastMessage: type === 'text' ? normalizedText : '[image]',
          lastMessageTimestamp: new Date(),
        });
      }

      // 3. Save Message with status "sending"
      const outboundRawJson = {
        ...(replyToMessageId ? { context: { id: replyToMessageId } } : {}),
        ...(type === "image"
          ? {
              _outboundImageUrl: normalizedImageUrl,
              _outboundImageCaption: effectiveImageCaption || null,
            }
          : {})
      };

      await storage.createMessage({
        conversationId: conversation.id,
        waMessageId: waMessageId,
        direction: "out",
        type: type,
        text: type === "image" ? (effectiveImageCaption || null) : normalizedText,
        mediaId: null,
        mimeType: null,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sending",
        rawJson: outboundRawJson,
      });

      // 4. Send to WhatsApp in background (non-blocking)
      sendToWhatsApp(
        to,
        type,
        type === "image"
          ? { imageUrl: normalizedImageUrl, caption: effectiveImageCaption, replyToMessageId }
          : { text: normalizedText, replyToMessageId }
      ).then(async (waResponse) => {
        const realId = waResponse.messages[0].id;
        const finalRawJson = type === "image"
          ? {
              ...waResponse,
              ...outboundRawJson
            }
          : waResponse;

        // Update to sent with real Meta ID
        await db
          .update(messagesTable)
          .set({ waMessageId: realId, status: "sent", rawJson: finalRawJson })
          .where(eq(messagesTable.waMessageId, waMessageId));
      }).catch(async (error) => {
        console.error("Background WhatsApp send failed:", error.response?.data || error.message);
        // Mark as failed
        await db
          .update(messagesTable)
          .set({ status: "failed" })
          .where(eq(messagesTable.waMessageId, waMessageId));
      });

      // 5. Respond immediately
      res.json({ success: true, messageId: waMessageId });

    } catch (error: any) {
      console.error("Send error:", error.response?.data || error.message);
      const errorData = error.response?.data?.error || {};
      res.status(500).json({ 
        message: "Failed to send message",
        error: {
          code: errorData.code || error.response?.status || "unknown",
          type: errorData.type || "api_error",
          details: errorData.message || error.message || "Unknown error"
        }
      });
    }
  });

  app.post("/api/send-image", requireAuth, upload.single("image"), async (req, res) => {
    try {
      const file = req.file;
      const to = req.body.to;
      const caption = req.body.caption || undefined;
      
      if (!file || !to) {
        return res.status(400).json({ message: "Missing image or recipient" });
      }

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ message: "Formato no soportado. Usa JPG, PNG o WebP." });
      }

      const token = process.env.META_ACCESS_TOKEN;
      const phoneId = process.env.WA_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        return res.status(500).json({ message: "Missing Meta configuration" });
      }

      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      formData.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
      formData.append("messaging_product", "whatsapp");
      formData.append("type", file.mimetype);

      const uploadRes = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/media`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() } }
      );
      const mediaId = uploadRes.data.id;

      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      const payload: any = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "image",
        image: { id: mediaId },
      };
      if (caption) payload.image.caption = caption;

      const waResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      const waMessageId = waResponse.data.messages[0].id;

      const normalizedTo = to.replace(/^\+/, "");
      let conversation = await storage.getConversationByWaId(normalizedTo);
      if (!conversation) {
        conversation = await storage.createConversation({
          waId: normalizedTo, contactName: normalizedTo,
          lastMessage: "[imagen]", lastMessageTimestamp: new Date(),
        });
      } else {
        await storage.updateConversation(conversation.id, {
          lastMessage: "[imagen]", lastMessageTimestamp: new Date(),
        });
      }

      await storage.createMessage({
        conversationId: conversation.id, waMessageId,
        direction: "out", type: "image",
        text: caption || "[imagen]",
        mediaId, mimeType: file.mimetype,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent", rawJson: waResponse.data,
      });

      res.json({ success: true, messageId: waMessageId });
    } catch (error: any) {
      console.error("Image upload error:", error.response?.data || error.message);
      res.status(500).json({ message: "Failed to send image", error: error.message });
    }
  });

  app.post("/api/send-video", requireAuth, uploadVideo.single("video"), async (req, res) => {
    try {
      const file = req.file;
      const to = req.body.to;
      const caption = typeof req.body.caption === "string" ? req.body.caption.trim() : "";

      if (!file || !to) {
        return res.status(400).json({ message: "Missing video or recipient" });
      }

      if (!isSupportedVideoInput(file)) {
        return res.status(400).json({ message: "Formato no soportado. Usa MP4, MOV o 3GP." });
      }

      const token = process.env.META_ACCESS_TOKEN;
      const phoneId = process.env.WA_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        return res.status(500).json({ message: "Missing Meta configuration" });
      }

      const transcodedVideo = await transcodeToWhatsAppVideo(file.buffer);
      if (transcodedVideo.length > WHATSAPP_VIDEO_MAX_BYTES) {
        return res.status(400).json({
          message: "El video sigue siendo muy pesado tras comprimir. Recortalo o envialo mas corto.",
        });
      }

      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      const uploadFilename = `video-${Date.now()}.mp4`;
      formData.append("file", transcodedVideo, { filename: uploadFilename, contentType: "video/mp4" });
      formData.append("messaging_product", "whatsapp");
      formData.append("type", "video/mp4");

      const uploadRes = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/media`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() } }
      );
      const mediaId = uploadRes.data.id;

      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      const payload: any = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "video",
        video: { id: mediaId },
      };
      if (caption) payload.video.caption = caption;

      const waResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      const waMessageId = waResponse.data.messages[0].id;
      const waMessageStatus = waResponse.data.messages[0]?.message_status || null;

      const normalizedTo = to.replace(/^\+/, "");
      let conversation = await storage.getConversationByWaId(normalizedTo);
      if (!conversation) {
        conversation = await storage.createConversation({
          waId: normalizedTo,
          contactName: normalizedTo,
          lastMessage: caption || "[video]",
          lastMessageTimestamp: new Date(),
        });
      } else {
        await storage.updateConversation(conversation.id, {
          lastMessage: caption || "[video]",
          lastMessageTimestamp: new Date(),
        });
      }

      await storage.createMessage({
        conversationId: conversation.id,
        waMessageId,
        direction: "out",
        type: "video",
        text: caption || null,
        mediaId,
        mimeType: "video/mp4",
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent",
        rawJson: {
          ...waResponse.data,
          _transcodedToMp4: true,
          _originalMimeType: file.mimetype,
          _originalSizeBytes: file.size,
          _transcodedSizeBytes: transcodedVideo.length,
        },
      });

      res.json({
        success: true,
        messageId: waMessageId,
        messageStatus: waMessageStatus,
        transcoded: true,
        finalSizeBytes: transcodedVideo.length,
      });
    } catch (error: any) {
      const details = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      console.error("Video upload error:", error.response?.data || error.message);
      res.status(500).json({ message: "Failed to send video", error: details });
    }
  });

  // Labels
  app.get("/api/labels", requireAuth, async (req, res) => {
    const allLabels = await storage.getLabels();
    const session = req.session as any;
    if (session.role === "agent" && session.agentId) {
      // Return own + shared/admin labels so existing conversation labels always render.
      return res.json(allLabels.filter((l) => l.agentId === session.agentId || !l.agentId));
    }
    // Admin receives all labels so assigned labels from agents render in kanban/chat.
    return res.json(allLabels);
  });

  app.post("/api/labels", requireAuth, async (req, res) => {
    try {
      const parsed = api.labels.create.input.parse(req.body);
      const session = req.session as any;
      const agentId = session.role === "agent" ? (session.agentId || null) : null;
      const label = await storage.createLabel({ ...parsed, agentId });
      res.json(label);
    } catch (error) {
      res.status(400).json({ message: "Invalid label data" });
    }
  });

  app.patch("/api/labels/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid label id" });
    }

    const parsed = z.object({
      name: z.string().min(1).max(50).optional(),
      color: z.string().min(1).max(20).optional(),
    }).safeParse(req.body);

    if (!parsed.success || (!parsed.data.name && !parsed.data.color)) {
      return res.status(400).json({ message: "Invalid label payload" });
    }

    const session = req.session as any;
    const label = await storage.getLabel(id);
    if (!label) {
      return res.status(404).json({ message: "Label not found" });
    }

    const isOwner = session.role === "agent"
      ? label.agentId === session.agentId
      : !label.agentId;
    if (!isOwner) {
      return res.status(403).json({ message: "Forbidden label access" });
    }

    const updates: { name?: string; color?: string } = {};
    if (parsed.data.name) {
      const trimmedName = parsed.data.name.trim();
      if (!trimmedName) {
        return res.status(400).json({ message: "Label name is required" });
      }
      updates.name = trimmedName;
    }
    if (parsed.data.color) updates.color = parsed.data.color;

    const updated = await storage.updateLabel(id, updates);
    return res.json(updated);
  });

  app.delete("/api/labels/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid label id" });
    }

    const session = req.session as any;
    const label = await storage.getLabel(id);
    if (!label) {
      return res.status(404).json({ message: "Label not found" });
    }

    const isOwner = session.role === "agent"
      ? label.agentId === session.agentId
      : !label.agentId;
    if (!isOwner) {
      return res.status(403).json({ message: "Forbidden label access" });
    }

    await storage.clearLabelFromConversations(id);
    await storage.deleteLabel(id);
    return res.json({ success: true });
  });

  // Quick Messages
  app.get("/api/quick-messages", requireAuth, async (req, res) => {
    const qms = await storage.getQuickMessages();
    res.json(qms);
  });

  app.post("/api/quick-messages", requireAuth, async (req, res) => {
    try {
      const parsed = api.quickMessages.create.input.parse(req.body);
      const qm = await storage.createQuickMessage(parsed);
      res.json(qm);
    } catch (error) {
      res.status(400).json({ message: "Invalid quick message data" });
    }
  });

  app.patch("/api/quick-messages/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid quick message id" });
      }
      const parsed = api.quickMessages.update.input.parse(req.body);
      const qm = await storage.updateQuickMessage(id, parsed);
      if (!qm) {
        return res.status(404).json({ message: "Quick message not found" });
      }
      res.json(qm);
    } catch (error) {
      res.status(400).json({ message: "Invalid quick message data" });
    }
  });

  app.delete("/api/quick-messages/:id", requireAuth, async (req, res) => {
    await storage.deleteQuickMessage(parseInt(req.params.id));
    res.json({ success: true });
  });

  const dailyCostSettingsUpdateSchema = z.object({
    unitCostBs: z.coerce.number().positive(),
    officialRateBs: z.coerce.number().positive(),
    parallelRateBs: z.coerce.number().positive(),
    openaiUsdPer1kTokens: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
    elevenlabsBsPerAudio: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
  });

  app.get("/api/daily-cost-settings", requireAuth, async (req, res) => {
    try {
      await ensureDailyCostSettingsTableExists();
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateFrom && !dateRegex.test(dateFrom)) {
        return res.status(400).json({ message: "Invalid dateFrom format. Use YYYY-MM-DD" });
      }
      if (dateTo && !dateRegex.test(dateTo)) {
        return res.status(400).json({ message: "Invalid dateTo format. Use YYYY-MM-DD" });
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        return res.status(400).json({ message: "dateFrom must be before or equal to dateTo" });
      }

      const rows: any = await db.execute(sql`
        SELECT date::text AS date, unit_cost_bs, official_rate_bs, parallel_rate_bs, openai_usd_per_1k_tokens, elevenlabs_bs_per_audio, updated_at
        FROM daily_cost_settings
        WHERE 1 = 1
          ${!dateFrom && !dateTo ? sql`AND date >= ((NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '29 days')::date` : sql``}
          ${dateFrom ? sql`AND date >= ${dateFrom}::date` : sql``}
          ${dateTo ? sql`AND date <= ${dateTo}::date` : sql``}
        ORDER BY date DESC
      `);

      const result = (rows?.rows ?? []).map((row: any) => mapDailyCostSettingRow(row));
      res.json(result);
    } catch (error) {
      console.error("Error fetching daily cost settings:", error);
      res.status(500).json({ message: "Error fetching daily cost settings" });
    }
  });

  const analyticsDepositUpsertSchema = z.object({
    viewerAgentId: z.number().int().positive().optional(),
    depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountBs: z.number().positive(),
    note: z.string().trim().max(300).nullable().optional(),
  });

  app.put("/api/daily-cost-settings/:date", requireAdmin, async (req, res) => {
    try {
      await ensureDailyCostSettingsTableExists();
      const date = String(req.params.date || "").trim();
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      }

      const parsed = dailyCostSettingsUpdateSchema.parse(req.body);
      const updated: any = await db.execute(sql`
        INSERT INTO daily_cost_settings (date, unit_cost_bs, official_rate_bs, parallel_rate_bs, openai_usd_per_1k_tokens, elevenlabs_bs_per_audio)
        VALUES (
          ${date}::date,
          ${parsed.unitCostBs},
          ${parsed.officialRateBs},
          ${parsed.parallelRateBs},
          ${parsed.openaiUsdPer1kTokens ?? null},
          ${parsed.elevenlabsBsPerAudio ?? null}
        )
        ON CONFLICT (date)
        DO UPDATE SET
          unit_cost_bs = EXCLUDED.unit_cost_bs,
          official_rate_bs = EXCLUDED.official_rate_bs,
          parallel_rate_bs = EXCLUDED.parallel_rate_bs,
          openai_usd_per_1k_tokens = EXCLUDED.openai_usd_per_1k_tokens,
          elevenlabs_bs_per_audio = EXCLUDED.elevenlabs_bs_per_audio,
          updated_at = NOW()
        RETURNING date::text AS date, unit_cost_bs, official_rate_bs, parallel_rate_bs, openai_usd_per_1k_tokens, elevenlabs_bs_per_audio, updated_at
      `);
      res.json(mapDailyCostSettingRow(updated.rows[0]));
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid daily cost settings data", errors: error.errors });
      }
      console.error("Error updating daily cost settings:", error);
      res.status(500).json({ message: "Error updating daily cost settings" });
    }
  });

  app.get("/api/analytics-deposits", requireAuth, async (req, res) => {
    try {
      await ensureAnalyticsDepositsTableExists();

      const session = req.session as any;
      const viewerAgentId = resolveAnalyticsDepositViewerAgentId(session, req.query.viewerAgentId);
      if (!viewerAgentId) {
        return res.json([]);
      }

      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateFrom && !dateRegex.test(dateFrom)) {
        return res.status(400).json({ message: "Invalid dateFrom format. Use YYYY-MM-DD" });
      }
      if (dateTo && !dateRegex.test(dateTo)) {
        return res.status(400).json({ message: "Invalid dateTo format. Use YYYY-MM-DD" });
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        return res.status(400).json({ message: "dateFrom must be before or equal to dateTo" });
      }

      const rows: any = await db.execute(sql`
        SELECT
          id,
          viewer_agent_id,
          deposit_date::text AS deposit_date,
          amount_bs,
          note,
          created_at
        FROM analytics_deposits
        WHERE viewer_agent_id = ${viewerAgentId}
          ${!dateFrom && !dateTo ? sql`AND deposit_date >= ((NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '29 days')::date` : sql``}
          ${dateFrom ? sql`AND deposit_date >= ${dateFrom}::date` : sql``}
          ${dateTo ? sql`AND deposit_date <= ${dateTo}::date` : sql``}
        ORDER BY deposit_date DESC, id DESC
      `);

      res.json((rows?.rows ?? []).map((row: any) => mapAnalyticsDepositRow(row)));
    } catch (error) {
      console.error("Error fetching analytics deposits:", error);
      res.status(500).json({ message: "Error fetching analytics deposits" });
    }
  });

  app.post("/api/analytics-deposits", requireAuth, async (req, res) => {
    try {
      await ensureAnalyticsDepositsTableExists();

      const parsed = analyticsDepositUpsertSchema.parse(req.body);
      const session = req.session as any;
      const viewerAgentId = resolveAnalyticsDepositViewerAgentId(session, parsed.viewerAgentId);
      if (!viewerAgentId) {
        return res.status(400).json({ message: "viewerAgentId is required" });
      }

      const created: any = await db.execute(sql`
        INSERT INTO analytics_deposits (viewer_agent_id, deposit_date, amount_bs, note)
        VALUES (
          ${viewerAgentId},
          ${parsed.depositDate}::date,
          ${parsed.amountBs},
          ${parsed.note ?? null}
        )
        RETURNING
          id,
          viewer_agent_id,
          deposit_date::text AS deposit_date,
          amount_bs,
          note,
          created_at
      `);

      res.json(mapAnalyticsDepositRow(created.rows[0]));
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid analytics deposit data", errors: error.errors });
      }
      console.error("Error creating analytics deposit:", error);
      res.status(500).json({ message: "Error creating analytics deposit" });
    }
  });

  app.delete("/api/analytics-deposits/:id", requireAuth, async (req, res) => {
    try {
      await ensureAnalyticsDepositsTableExists();

      const depositId = Number(req.params.id);
      if (!Number.isInteger(depositId) || depositId <= 0) {
        return res.status(400).json({ message: "Invalid deposit id" });
      }

      const existing: any = await db.execute(sql`
        SELECT id, viewer_agent_id
        FROM analytics_deposits
        WHERE id = ${depositId}
        LIMIT 1
      `);
      const row = existing?.rows?.[0];
      if (!row) {
        return res.status(404).json({ message: "Deposit not found" });
      }

      const session = req.session as any;
      if (session?.role === "agent") {
        const ownAgentId = Number(session.agentId);
        if (!Number.isInteger(ownAgentId) || ownAgentId <= 0 || Number(row.viewer_agent_id) !== ownAgentId) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      await db.execute(sql`DELETE FROM analytics_deposits WHERE id = ${depositId}`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting analytics deposit:", error);
      res.status(500).json({ message: "Error deleting analytics deposit" });
    }
  });

  // Agent message stats + inbound chats + estimated cost by daily settings
  app.get("/api/agent-stats", requireAuth, async (req, res) => {
    try {
      await ensureDailyCostSettingsTableExists();
      await ensureConversationAssignmentEventsTableExists();

      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateFrom && !dateRegex.test(dateFrom)) {
        return res.status(400).json({ message: "Invalid dateFrom format. Use YYYY-MM-DD" });
      }
      if (dateTo && !dateRegex.test(dateTo)) {
        return res.status(400).json({ message: "Invalid dateTo format. Use YYYY-MM-DD" });
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        return res.status(400).json({ message: "dateFrom must be before or equal to dateTo" });
      }

      const dayExpression = sql`
        DATE(
          COALESCE(
            CASE
              WHEN m.timestamp ~ '^[0-9]+$' THEN to_timestamp(m.timestamp::double precision)
              ELSE NULL
            END,
            m.created_at
          ) AT TIME ZONE 'America/La_Paz'
        )
      `;
      const aiDayExpression = sql`DATE(al.created_at AT TIME ZONE 'America/La_Paz')`;
      const assignmentDayExpression = sql`DATE(ae.created_at AT TIME ZONE 'America/La_Paz')`;

      const rows: any = await db.execute(sql`
        WITH stats AS (
          SELECT
            a.id AS agent_id,
            a.name AS agent_name,
            ${dayExpression} AS date,
            COUNT(*) FILTER (WHERE m.direction IN ('in', 'incoming')) AS incoming,
            COUNT(*) FILTER (WHERE m.direction IN ('out', 'outgoing')) AS outgoing,
            COUNT(*) FILTER (WHERE m.direction IN ('out', 'outgoing') AND m.type = 'audio') AS outgoing_audios,
            COUNT(DISTINCT m.conversation_id) FILTER (WHERE m.direction IN ('in', 'incoming')) AS inbound_new_chats
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          JOIN agents a ON c.assigned_agent_id = a.id
          WHERE 1 = 1
            ${!dateFrom && !dateTo ? sql`AND ${dayExpression} >= ((NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '29 days')::date` : sql``}
            ${dateFrom ? sql`AND ${dayExpression} >= ${dateFrom}::date` : sql``}
            ${dateTo ? sql`AND ${dayExpression} <= ${dateTo}::date` : sql``}
          GROUP BY a.id, a.name, ${dayExpression}
        ),
        ai_stats AS (
          SELECT
            a.id AS agent_id,
            a.name AS agent_name,
            ${aiDayExpression} AS date,
            SUM(
              CASE
                WHEN LOWER(COALESCE(al.ai_response, '')) LIKE '[openai]%' THEN COALESCE(al.tokens_used, 0)
                ELSE 0
              END
            ) AS openai_tokens
          FROM ai_logs al
          JOIN conversations c ON al.conversation_id = c.id
          JOIN agents a ON c.assigned_agent_id = a.id
          WHERE al.success = true
            ${!dateFrom && !dateTo ? sql`AND ${aiDayExpression} >= ((NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '29 days')::date` : sql``}
            ${dateFrom ? sql`AND ${aiDayExpression} >= ${dateFrom}::date` : sql``}
            ${dateTo ? sql`AND ${aiDayExpression} <= ${dateTo}::date` : sql``}
          GROUP BY a.id, a.name, ${aiDayExpression}
        ),
        assignment_stats AS (
          SELECT
            a.id AS agent_id,
            a.name AS agent_name,
            ${assignmentDayExpression} AS date,
            COUNT(DISTINCT ae.conversation_id) AS assigned_in_chats
          FROM conversation_assignment_events ae
          JOIN agents a ON ae.to_agent_id = a.id
          WHERE ae.to_agent_id IS NOT NULL
            AND ae.assigned_by_role = 'admin'
            ${!dateFrom && !dateTo ? sql`AND ${assignmentDayExpression} >= ((NOW() AT TIME ZONE 'America/La_Paz')::date - INTERVAL '29 days')::date` : sql``}
            ${dateFrom ? sql`AND ${assignmentDayExpression} >= ${dateFrom}::date` : sql``}
            ${dateTo ? sql`AND ${assignmentDayExpression} <= ${dateTo}::date` : sql``}
          GROUP BY a.id, a.name, ${assignmentDayExpression}
        ),
        combined_keys AS (
          SELECT s.agent_id, s.date FROM stats s
          UNION
          SELECT ai.agent_id, ai.date FROM ai_stats ai
          UNION
          SELECT ass.agent_id, ass.date FROM assignment_stats ass
        ),
        combined AS (
          SELECT
            k.agent_id,
            COALESCE(s.agent_name, ai.agent_name, ass.agent_name) AS agent_name,
            k.date,
            COALESCE(s.incoming, 0) AS incoming,
            COALESCE(s.outgoing, 0) AS outgoing,
            COALESCE(s.outgoing_audios, 0) AS outgoing_audios,
            COALESCE(s.inbound_new_chats, 0) AS inbound_new_chats,
            COALESCE(ass.assigned_in_chats, 0) AS assigned_in_chats,
            COALESCE(s.inbound_new_chats, 0) + COALESCE(ass.assigned_in_chats, 0) AS inbound_chats,
            COALESCE(ai.openai_tokens, 0) AS openai_tokens
          FROM combined_keys k
          LEFT JOIN stats s
            ON s.agent_id = k.agent_id
            AND s.date = k.date
          LEFT JOIN ai_stats ai
            ON ai.agent_id = k.agent_id
            AND ai.date = k.date
          LEFT JOIN assignment_stats ass
            ON ass.agent_id = k.agent_id
            AND ass.date = k.date
        ),
        scored AS (
          SELECT
            c.agent_id,
            c.agent_name,
            c.date::text AS date,
            c.incoming,
            c.outgoing,
            c.outgoing_audios,
            c.inbound_new_chats,
            c.assigned_in_chats,
            c.inbound_chats,
            c.openai_tokens,
            dcs.unit_cost_bs,
            dcs.official_rate_bs,
            dcs.parallel_rate_bs,
            dcs.openai_usd_per_1k_tokens,
            dcs.elevenlabs_bs_per_audio,
            CASE
              WHEN dcs.unit_cost_bs IS NULL THEN NULL
              ELSE c.inbound_chats * dcs.unit_cost_bs
            END AS base_cost_bs,
            CASE
              WHEN dcs.unit_cost_bs IS NULL OR dcs.official_rate_bs <= 0 THEN NULL
              ELSE (c.inbound_chats * dcs.unit_cost_bs) / dcs.official_rate_bs
            END AS usd_cost,
            CASE
              WHEN dcs.unit_cost_bs IS NULL OR dcs.official_rate_bs <= 0 OR dcs.parallel_rate_bs <= 0 THEN NULL
              ELSE ((c.inbound_chats * dcs.unit_cost_bs) / dcs.official_rate_bs) * dcs.parallel_rate_bs
            END AS parallel_cost_bs,
            CASE
              WHEN dcs.openai_usd_per_1k_tokens IS NULL THEN NULL
              ELSE (c.openai_tokens::numeric / 1000.0) * dcs.openai_usd_per_1k_tokens
            END AS openai_cost_usd,
            CASE
              WHEN dcs.openai_usd_per_1k_tokens IS NULL OR dcs.parallel_rate_bs <= 0 THEN NULL
              ELSE ((c.openai_tokens::numeric / 1000.0) * dcs.openai_usd_per_1k_tokens) * dcs.parallel_rate_bs
            END AS openai_parallel_cost_bs,
            CASE
              WHEN dcs.elevenlabs_bs_per_audio IS NULL THEN NULL
              ELSE c.outgoing_audios * dcs.elevenlabs_bs_per_audio
            END AS elevenlabs_cost_bs
          FROM combined c
          LEFT JOIN daily_cost_settings dcs ON dcs.date = c.date
        )
        SELECT
          s.agent_id,
          s.agent_name,
          s.date,
          s.incoming,
          s.outgoing,
          s.outgoing_audios,
          s.inbound_new_chats,
          s.assigned_in_chats,
          s.inbound_chats,
          s.openai_tokens,
          s.unit_cost_bs,
          s.official_rate_bs,
          s.parallel_rate_bs,
          s.openai_usd_per_1k_tokens,
          s.elevenlabs_bs_per_audio,
          s.base_cost_bs,
          s.usd_cost,
          s.parallel_cost_bs,
          s.openai_cost_usd,
          s.openai_parallel_cost_bs,
          s.elevenlabs_cost_bs,
          CASE
            WHEN s.parallel_cost_bs IS NULL AND s.openai_parallel_cost_bs IS NULL AND s.elevenlabs_cost_bs IS NULL THEN NULL
            ELSE COALESCE(s.parallel_cost_bs, 0) + COALESCE(s.openai_parallel_cost_bs, 0) + COALESCE(s.elevenlabs_cost_bs, 0)
          END AS total_estimated_parallel_cost_bs
        FROM scored s
        ORDER BY s.date DESC, s.agent_name
      `);

      const mapped = (rows?.rows ?? []).map((row: any) => ({
        agent_id: Number(row.agent_id),
        agent_name: String(row.agent_name || ""),
        date: String(row.date),
        incoming: Number(row.incoming || 0),
        outgoing: Number(row.outgoing || 0),
        outgoing_audios: Number(row.outgoing_audios || 0),
        inbound_new_chats: Number(row.inbound_new_chats || 0),
        assigned_in_chats: Number(row.assigned_in_chats || 0),
        inbound_chats: Number(row.inbound_chats || 0),
        openai_tokens: Number(row.openai_tokens || 0),
        unit_cost_bs: row.unit_cost_bs == null ? null : Number(row.unit_cost_bs),
        official_rate_bs: row.official_rate_bs == null ? null : Number(row.official_rate_bs),
        parallel_rate_bs: row.parallel_rate_bs == null ? null : Number(row.parallel_rate_bs),
        openai_usd_per_1k_tokens: row.openai_usd_per_1k_tokens == null ? null : Number(row.openai_usd_per_1k_tokens),
        elevenlabs_bs_per_audio: row.elevenlabs_bs_per_audio == null ? null : Number(row.elevenlabs_bs_per_audio),
        base_cost_bs: row.base_cost_bs == null ? null : Number(row.base_cost_bs),
        usd_cost: row.usd_cost == null ? null : Number(row.usd_cost),
        parallel_cost_bs: row.parallel_cost_bs == null ? null : Number(row.parallel_cost_bs),
        openai_cost_usd: row.openai_cost_usd == null ? null : Number(row.openai_cost_usd),
        openai_parallel_cost_bs: row.openai_parallel_cost_bs == null ? null : Number(row.openai_parallel_cost_bs),
        elevenlabs_cost_bs: row.elevenlabs_cost_bs == null ? null : Number(row.elevenlabs_cost_bs),
        total_estimated_parallel_cost_bs: row.total_estimated_parallel_cost_bs == null ? null : Number(row.total_estimated_parallel_cost_bs),
      }));

      const session = req.session as any;
      if (session?.role === "agent") {
        const viewerAgentId = Number(session.agentId);
        if (Number.isInteger(viewerAgentId) && viewerAgentId > 0) {
          const allowedAgentIds = await getAllowedAnalyticsAgentIdsForViewer(viewerAgentId);
          return res.json(mapped.filter((r: any) => allowedAgentIds.has(Number(r.agent_id))));
        }
      }
      res.json(mapped);
    } catch (error) {
      console.error("Agent stats error:", error);
      // Safe fallback: avoid breaking user UI due analytics errors
      res.json([]);
    }
  });

  app.post("/api/send-audio", requireAuth, uploadAudio.single("audio"), async (req, res) => {
    try {
      const file = req.file;
      const to = req.body.to;

      if (!file || !to) {
        return res.status(400).json({ message: "Missing audio or recipient" });
      }

      const normalizedMimeType = String(file.mimetype || "").toLowerCase();
      const inferredMimeType = inferAudioMimeType(normalizedMimeType, file.originalname);
      const allowedInputAudioPrefixes = [
        "audio/aac",
        "audio/amr",
        "audio/ogg",
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/3gpp",
      ];
      const hasSupportedMime = allowedInputAudioPrefixes.some((prefix) => inferredMimeType.startsWith(prefix));
      if (!hasSupportedMime) {
        return res.status(400).json({
          message: "Formato no soportado. Usa MP3, M4A, OGG, AAC, AMR o WEBM.",
          error: `MIME detectado: ${inferredMimeType || normalizedMimeType || "desconocido"}`,
        });
      }

      const token = process.env.META_ACCESS_TOKEN;
      const phoneId = process.env.WA_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        return res.status(500).json({ message: "Missing Meta configuration" });
      }

      let transcodedBuffer: Buffer;
      try {
        transcodedBuffer = await transcodeToWhatsAppAudio(file.buffer);
      } catch (transcodeError: any) {
        console.error("Audio transcode error:", transcodeError?.message || transcodeError);
        return res.status(400).json({
          message: "No se pudo procesar el audio",
          error: transcodeError?.message || "Transcode failed",
        });
      }
      const mimeTypeForMeta = "audio/ogg";
      const uploadFilename = `audio-${Date.now()}.ogg`;

      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      formData.append("file", transcodedBuffer, { filename: uploadFilename, contentType: mimeTypeForMeta });
      formData.append("messaging_product", "whatsapp");
      formData.append("type", mimeTypeForMeta);

      const uploadRes = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/media`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() } }
      );
      const mediaId = uploadRes.data.id;

      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      const payload: any = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "audio",
        audio: { id: mediaId },
      };

      const waResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      const waMessageId = waResponse.data.messages[0].id;
      const waMessageStatus = waResponse.data.messages[0]?.message_status || null;

      const normalizedTo = to.replace(/^\+/, "");
      let conversation = await storage.getConversationByWaId(normalizedTo);
      if (!conversation) {
        conversation = await storage.createConversation({
          waId: normalizedTo, contactName: normalizedTo,
          lastMessage: "[audio]", lastMessageTimestamp: new Date(),
        });
      } else {
        await storage.updateConversation(conversation.id, {
          lastMessage: "[audio]", lastMessageTimestamp: new Date(),
        });
      }

      await storage.createMessage({
        conversationId: conversation.id, waMessageId,
        direction: "out", type: "audio",
        text: "[audio]",
        mediaId, mimeType: mimeTypeForMeta,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent", rawJson: waResponse.data,
      });

      res.json({ success: true, messageId: waMessageId, messageStatus: waMessageStatus });
    } catch (error: any) {
      const details = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      console.error("Audio upload error:", error.response?.data || error.message);
      res.status(500).json({ message: "Failed to send audio", error: details });
    }
  });

  app.post("/api/send-document", requireAuth, uploadDocument.single("document"), async (req, res) => {
    try {
      const file = req.file;
      const to = req.body.to;
      const caption = req.body.caption || undefined;

      if (!file || !to) {
        return res.status(400).json({ message: "Missing document or recipient" });
      }

      const normalizedMimeType = String(file.mimetype || "").toLowerCase();
      const normalizedFileName = String(file.originalname || "").toLowerCase();
      const isPdf = normalizedMimeType === "application/pdf" || normalizedFileName.endsWith(".pdf");
      if (!isPdf) {
        return res.status(400).json({ message: "Formato no soportado. Solo PDF." });
      }

      const token = process.env.META_ACCESS_TOKEN;
      const phoneId = process.env.WA_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        return res.status(500).json({ message: "Missing Meta configuration" });
      }

      const safeFileName = file.originalname?.trim() || `documento-${Date.now()}.pdf`;
      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      formData.append("file", file.buffer, { filename: safeFileName, contentType: "application/pdf" });
      formData.append("messaging_product", "whatsapp");
      formData.append("type", "application/pdf");

      const uploadRes = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/media`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() } }
      );
      const mediaId = uploadRes.data.id;

      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      const payload: any = {
        messaging_product: "whatsapp",
        to: formattedTo,
        type: "document",
        document: { id: mediaId, filename: safeFileName },
      };
      if (caption) payload.document.caption = caption;

      const waResponse = await axios.post(
        `https://graph.facebook.com/v24.0/${phoneId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      const waMessageId = waResponse.data.messages[0].id;
      const waMessageStatus = waResponse.data.messages[0]?.message_status || null;

      const normalizedTo = to.replace(/^\+/, "");
      let conversation = await storage.getConversationByWaId(normalizedTo);
      const lastMessageText = `[pdf] ${safeFileName}`;
      if (!conversation) {
        conversation = await storage.createConversation({
          waId: normalizedTo, contactName: normalizedTo,
          lastMessage: lastMessageText, lastMessageTimestamp: new Date(),
        });
      } else {
        await storage.updateConversation(conversation.id, {
          lastMessage: lastMessageText, lastMessageTimestamp: new Date(),
        });
      }

      await storage.createMessage({
        conversationId: conversation.id, waMessageId,
        direction: "out", type: "document",
        text: lastMessageText,
        mediaId, mimeType: "application/pdf",
        timestamp: Math.floor(Date.now() / 1000).toString(),
        status: "sent", rawJson: waResponse.data,
      });

      res.json({ success: true, messageId: waMessageId, messageStatus: waMessageStatus });
    } catch (error: any) {
      const details = error.response?.data?.error?.message || error.response?.data?.message || error.message;
      console.error("Document upload error:", error.response?.data || error.message);
      res.status(500).json({ message: "Failed to send document", error: details });
    }
  });

  // Agent self settings (global AI auto-reply toggle)
  app.get("/api/agents/me/settings", requireAuth, async (req, res) => {
    const session = req.session as any;
    if (session.role !== "agent" || !session.agentId) {
      return res.status(403).json({ message: "Agent access required" });
    }
    const agent = await storage.getAgent(session.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json({ isAiAutoReplyEnabled: agent.isAiAutoReplyEnabled !== false });
  });

  app.patch("/api/agents/me/settings", requireAuth, async (req, res) => {
    const session = req.session as any;
    if (session.role !== "agent" || !session.agentId) {
      return res.status(403).json({ message: "Agent access required" });
    }
    const parsed = z.object({ isAiAutoReplyEnabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid settings payload" });
    }
    const updated = await storage.updateAgent(session.agentId, {
      isAiAutoReplyEnabled: parsed.data.isAiAutoReplyEnabled,
    });
    res.json({ isAiAutoReplyEnabled: updated.isAiAutoReplyEnabled !== false });
  });

  // Reassign conversation to agent
  app.patch("/api/conversations/:id/assign", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const current = await storage.getConversation(id);
    if (!current) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const rawAgentId = req.body?.agentId;
    const nextAgentId =
      rawAgentId === null || rawAgentId === undefined || rawAgentId === ""
        ? null
        : Number(rawAgentId);

    if (nextAgentId !== null && (!Number.isInteger(nextAgentId) || nextAgentId <= 0)) {
      return res.status(400).json({ message: "Invalid agent id" });
    }

    if (nextAgentId === null) {
      const updated = await storage.updateConversation(id, { assignedAgentId: null });
      res.json(updated);
      return;
    }

    await storage.assignConversationToAgent(id, nextAgentId);
    const previousAgentId = current.assignedAgentId ?? null;
    if (previousAgentId !== nextAgentId) {
      await createConversationAssignmentEvent({
        conversationId: id,
        fromAgentId: previousAgentId,
        toAgentId: nextAgentId,
        assignedByRole: "admin",
      });
    }
    const updated = await storage.getConversation(id);
    res.json(updated);
  });

  // Set conversation label
  app.patch("/api/conversations/:id/label", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const session = req.session as any;
    const rawLabelIds: any[] = Array.isArray(req.body?.labelIds)
      ? req.body.labelIds
      : req.body?.labelId
        ? [req.body.labelId]
        : [];

    const parsedLabelIds: number[] = Array.from(
      new Set(
        rawLabelIds
          .map((labelId: any) => Number(labelId))
          .filter((labelId: number) => Number.isInteger(labelId) && labelId > 0),
      ),
    );

    if (rawLabelIds.length > 0 && parsedLabelIds.length === 0) {
      return res.status(400).json({ message: "Invalid label id" });
    }

    if (parsedLabelIds.length > 2) {
      return res.status(400).json({ message: "Solo se permiten 2 etiquetas por conversacion" });
    }

    for (const labelId of parsedLabelIds) {
      const label = await storage.getLabel(labelId);
      if (!label) {
        return res.status(404).json({ message: "Label not found" });
      }
      const isOwner = session.role === "agent"
        ? label.agentId === session.agentId
        : !label.agentId;
      if (!isOwner) {
        return res.status(403).json({ message: "Forbidden label access" });
      }
    }

    const [firstLabelId, secondLabelId] = parsedLabelIds;
    const updated = await storage.updateConversation(id, {
      labelId: firstLabelId ?? null,
      labelId2: secondLabelId ?? null,
    });
    res.json(updated);
  });

  // Create or update reminder on conversation
  app.patch("/api/conversations/:id/reminder", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const parsed = z.object({
      reminderAt: z.string().datetime().nullable().optional(),
      reminderNote: z.string().max(300).optional().nullable(),
      reminderColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional().nullable(),
      reminderDone: z.boolean().optional(),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid reminder payload", details: parsed.error.errors });
    }

    const current = await storage.getConversation(id);
    if (!current) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    let reminderAt = current.reminderAt ?? null;
    if (parsed.data.reminderAt !== undefined) {
      reminderAt = parsed.data.reminderAt ? new Date(parsed.data.reminderAt) : null;
    }
    const reminderNote = parsed.data.reminderNote === undefined ? (current.reminderNote ?? null) : (parsed.data.reminderNote?.trim() || null);
    const reminderColor = parsed.data.reminderColor === undefined ? (current.reminderColor ?? null) : (parsed.data.reminderColor || null);
    const reminderDone = parsed.data.reminderDone === undefined ? Boolean(current.reminderDone) : parsed.data.reminderDone;

    if (reminderAt && Number.isNaN(reminderAt.getTime())) {
      return res.status(400).json({ message: "Invalid reminder date" });
    }

    const updated = await storage.updateConversation(id, {
      reminderAt,
      reminderNote,
      reminderColor,
      reminderDone,
      reminderUpdatedAt: reminderAt ? new Date() : null,
    });
    res.json(updated);
  });

  // Delete reminder from conversation
  app.delete("/api/conversations/:id/reminder", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.updateConversation(id, {
      reminderAt: null,
      reminderNote: null,
      reminderColor: null,
      reminderDone: false,
      reminderUpdatedAt: null,
    });
    res.json(updated);
  });

  // === DAILY REPORTS ===
  app.get("/api/reports/me", requireAuth, async (req, res) => {
    try {
      const session = req.session as any;
      if (session.role !== "agent" || !session.agentId) {
        return res.status(403).json({ message: "Agent access required" });
      }

      const reportDate = normalizeReportDate(req.query.date);
      await ensureDailyReportsTableExists();

      let report: DailyReport | null = null;
      if (reportDate) {
        const result: any = await db.execute(sql`
          SELECT id, report_date, agent_id, operator_name, calls_made, calls_answered, calls_missed, calls_pending, sales_by_city, updated_at
          FROM daily_reports
          WHERE agent_id = ${session.agentId}
            AND report_date = ${reportDate}::date
          LIMIT 1
        `);
        const row = result?.rows?.[0];
        report = row ? mapDailyReportRow(row) : null;
      }

      const latestResult: any = await db.execute(sql`
        SELECT operator_name
        FROM daily_reports
        WHERE agent_id = ${session.agentId}
          AND operator_name <> ''
        ORDER BY report_date DESC, updated_at DESC
        LIMIT 1
      `);
      const latestOperatorName = String(latestResult?.rows?.[0]?.operator_name || "");

      res.json({ report, latestOperatorName });
    } catch (error) {
      console.error("Error fetching daily report:", error);
      res.status(500).json({ message: "Error fetching report" });
    }
  });

  app.put("/api/reports/me", requireAuth, async (req, res) => {
    try {
      const session = req.session as any;
      if (session.role !== "agent" || !session.agentId) {
        return res.status(403).json({ message: "Agent access required" });
      }

      const parsed = reportPayloadSchema.parse(req.body);
      const reportDate = normalizeReportDate(parsed.reportDate);
      if (!reportDate) {
        return res.status(400).json({ message: "Invalid report date" });
      }

      await ensureDailyReportsTableExists();
      const salesByCityJson = JSON.stringify(parsed.salesByCity);

      const result: any = await db.execute(sql`
        INSERT INTO daily_reports (
          report_date,
          agent_id,
          operator_name,
          calls_made,
          calls_answered,
          calls_missed,
          calls_pending,
          sales_by_city
        )
        VALUES (
          ${reportDate}::date,
          ${session.agentId},
          ${parsed.operatorName || ""},
          ${parsed.calls.made},
          ${parsed.calls.answered},
          ${parsed.calls.missed},
          ${parsed.calls.pending},
          ${salesByCityJson}::jsonb
        )
        ON CONFLICT (report_date, agent_id) DO UPDATE SET
          operator_name = EXCLUDED.operator_name,
          calls_made = EXCLUDED.calls_made,
          calls_answered = EXCLUDED.calls_answered,
          calls_missed = EXCLUDED.calls_missed,
          calls_pending = EXCLUDED.calls_pending,
          sales_by_city = EXCLUDED.sales_by_city,
          updated_at = NOW()
        RETURNING id, report_date, agent_id, operator_name, calls_made, calls_answered, calls_missed, calls_pending, sales_by_city, updated_at
      `);

      const row = result?.rows?.[0];
      res.json(row ? mapDailyReportRow(row) : null);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid report data", errors: error.errors });
      }
      console.error("Error saving report:", error);
      res.status(500).json({ message: "Error saving report" });
    }
  });

  app.get("/api/reports/agent/:agentId", requireAdmin, async (req, res) => {
    try {
      const agentId = Number(req.params.agentId);
      if (!Number.isInteger(agentId) || agentId <= 0) {
        return res.status(400).json({ message: "Invalid agent id" });
      }

      const reportDate = normalizeReportDate(req.query.date);
      await ensureDailyReportsTableExists();

      const result: any = reportDate
        ? await db.execute(sql`
            SELECT id, report_date, agent_id, operator_name, calls_made, calls_answered, calls_missed, calls_pending, sales_by_city, updated_at
            FROM daily_reports
            WHERE agent_id = ${agentId}
              AND report_date = ${reportDate}::date
            LIMIT 1
          `)
        : await db.execute(sql`
            SELECT id, report_date, agent_id, operator_name, calls_made, calls_answered, calls_missed, calls_pending, sales_by_city, updated_at
            FROM daily_reports
            WHERE agent_id = ${agentId}
            ORDER BY report_date DESC, updated_at DESC
            LIMIT 1
          `);

      const row = result?.rows?.[0];
      const report = row ? mapDailyReportRow(row) : null;
      res.json({ report });
    } catch (error) {
      console.error("Error fetching agent report:", error);
      res.status(500).json({ message: "Error fetching report" });
    }
  });

  // Toggle pin
  app.patch("/api/conversations/:id/pin", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { isPinned } = req.body;
    const updated = await storage.updateConversation(id, { isPinned });
    res.json(updated);
  });

  // Update order status with Zod validation
  app.patch("/api/conversations/:id/order-status", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    
    // Validate with Zod schema
    const parsed = updateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid order status. Must be null, 'pending', 'ready', or 'delivered'", details: parsed.error.errors });
    }
    
    const updated = await storage.updateConversation(id, { orderStatus: parsed.data.orderStatus });
    if (parsed.data.orderStatus === "pending") {
      const prefs = await getPushNotificationPreferences();
      if (prefs.notifyPending) {
        sendPushNotification(
          "Pedido en Proceso",
          `${updated.contactName || updated.waId}: Pedido marcado en proceso`,
          { conversationId: id.toString(), waId: updated.waId, event: "order_pending" },
          getConversationPushOptions(updated),
        );
      }
    } else if (parsed.data.orderStatus === "ready") {
      sendPushNotification(
        "Pedido Listo para Enviar",
        `${updated.contactName || updated.waId}: Pedido listo para despacho`,
        { conversationId: id.toString(), waId: updated.waId, event: "order_ready" },
        getConversationPushOptions(updated),
      );
    } else if (parsed.data.orderStatus === "delivered") {
      sendPushNotification(
        "Pedido Entregado",
        `${updated.contactName || updated.waId}: Pedido marcado como entregado`,
        { conversationId: id.toString(), waId: updated.waId, event: "order_delivered" },
        getConversationPushOptions(updated),
      );
    }
    res.json(updated);
  });

  // Toggle AI for a specific conversation
  app.patch("/api/conversations/:id/ai-toggle", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { aiDisabled } = req.body;
    
    if (typeof aiDisabled !== 'boolean') {
      return res.status(400).json({ error: "aiDisabled must be a boolean" });
    }
    
    const updated = await storage.updateConversation(id, { aiDisabled });
    res.json(updated);
  });

  // Clear human attention flag
  app.patch("/api/conversations/:id/clear-attention", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.updateConversation(id, { needsHumanAttention: false });
    res.json(updated);
  });

  // Set kanban column status in one operation (used by drag & drop)
  app.patch("/api/conversations/:id/kanban-status", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const parsed = z.object({
      column: z.enum(["humano", "nuevo", "llamar", "proceso", "listo", "entregado"]),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid column" });
    }

    const { column } = parsed.data;
    let updates: Record<string, any>;

    if (column === "humano") {
      updates = { needsHumanAttention: true, shouldCall: false, orderStatus: null };
    } else if (column === "nuevo") {
      updates = { needsHumanAttention: false, shouldCall: false, orderStatus: null };
    } else if (column === "llamar") {
      updates = { needsHumanAttention: false, shouldCall: true, orderStatus: null };
    } else if (column === "proceso") {
      updates = { needsHumanAttention: false, shouldCall: false, orderStatus: "pending" };
    } else if (column === "listo") {
      updates = { needsHumanAttention: false, shouldCall: false, orderStatus: "ready" };
    } else {
      updates = { needsHumanAttention: false, shouldCall: false, orderStatus: "delivered" };
    }

    const updated = await storage.updateConversation(id, updates);
    if (column === "humano") {
      sendPushNotification(
        "Atencion Humana Requerida",
        `${updated.contactName || updated.waId}: El cliente necesita hablar con un humano`,
        { conversationId: id.toString(), waId: updated.waId, event: "human_attention" },
        getConversationPushOptions(updated),
      );
    } else if (column === "llamar") {
      sendPushNotification(
        "Llamar al Cliente",
        `${updated.contactName || updated.waId}: Marcado para llamada`,
        { conversationId: id.toString(), waId: updated.waId, event: "should_call" },
        getConversationPushOptions(updated),
      );
    } else if (column === "proceso") {
      const prefs = await getPushNotificationPreferences();
      if (prefs.notifyPending) {
        sendPushNotification(
          "Pedido en Proceso",
          `${updated.contactName || updated.waId}: Pedido marcado en proceso`,
          { conversationId: id.toString(), waId: updated.waId, event: "order_pending" },
          getConversationPushOptions(updated),
        );
      }
    } else if (column === "listo") {
      sendPushNotification(
        "Pedido Listo para Enviar",
        `${updated.contactName || updated.waId}: Pedido listo para despacho`,
        { conversationId: id.toString(), waId: updated.waId, event: "order_ready" },
        getConversationPushOptions(updated),
      );
    } else if (column === "entregado") {
      sendPushNotification(
        "Pedido Entregado",
        `${updated.contactName || updated.waId}: Pedido marcado como entregado`,
        { conversationId: id.toString(), waId: updated.waId, event: "order_delivered" },
        getConversationPushOptions(updated),
      );
    }
    res.json(updated);
  });

  // Toggle should call (purchase probability indicator)
  app.patch("/api/conversations/:id/should-call", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { shouldCall } = req.body;
    const updated = await storage.updateConversation(id, { shouldCall: !!shouldCall });
    res.json(updated);
  });

  app.patch("/api/conversations/:id/call-status", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const parsed = z.object({
      status: z.enum(["answered", "missed", "later", "clear"]),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid call status" });
    }

    const current = await storage.getConversation(id);
    if (!current) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const currentAttempts = Number((current as any).callAttempts || 0);
    const now = new Date();
    const status = parsed.data.status;
    const updates: Record<string, any> = {
      callStatus: status === "clear" ? null : status,
      callAttempts: status === "clear"
        ? 0
        : status === "missed"
          ? currentAttempts + 1
          : Math.max(currentAttempts, 1),
      callUpdatedAt: status === "clear" ? null : now,
    };

    const updated = await storage.updateConversation(id, updates);
    res.json(updated);
  });

  // Get follow-up conversations (those where we sent last message and customer didn't respond)
  app.get("/api/follow-up", requireAuth, async (req, res) => {
    const { timeFilter } = req.query; // 'today', 'yesterday', 'before_yesterday'
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const beforeYesterday = new Date(today.getTime() - 48 * 60 * 60 * 1000);

    const normalizedFilter = typeof timeFilter === "string" ? timeFilter : "";
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    if (normalizedFilter === "today") {
      rangeStart = today;
    } else if (normalizedFilter === "yesterday") {
      rangeStart = yesterday;
      rangeEnd = today;
    } else if (normalizedFilter === "before_yesterday") {
      rangeStart = beforeYesterday;
      rangeEnd = yesterday;
    }

    const startClause = rangeStart ? sql`AND rm.created_at >= ${rangeStart}` : sql``;
    const endClause = rangeEnd ? sql`AND rm.created_at < ${rangeEnd}` : sql``;

    const result = await db.execute(sql`
      WITH ranked_messages AS (
        SELECT
          m.id,
          m.conversation_id,
          m.body,
          m.created_at,
          m.direction,
          COUNT(*) OVER (PARTITION BY m.conversation_id) AS message_count,
          ROW_NUMBER() OVER (
            PARTITION BY m.conversation_id
            ORDER BY m.created_at DESC, m.id DESC
          ) AS rn
        FROM messages m
      )
      SELECT
        c.id,
        c.wa_id AS "waId",
        c.contact_name AS "contactName",
        c.label_id AS "labelId",
        c.label_id_2 AS "labelId2",
        c.is_pinned AS "isPinned",
        c.order_status AS "orderStatus",
        c.ai_disabled AS "aiDisabled",
        c.needs_human_attention AS "needsHumanAttention",
        c.should_call AS "shouldCall",
        c.last_follow_up_at AS "lastFollowUpAt",
        c.assigned_agent_id AS "assignedAgentId",
        c.last_message AS "lastMessage",
        c.last_message_timestamp AS "lastMessageTimestamp",
        c.updated_at AS "updatedAt",
        rm.message_count AS "messageCount",
        json_build_object(
          'text', rm.body,
          'createdAt', rm.created_at
        ) AS "lastOutboundMessage"
      FROM conversations c
      JOIN ranked_messages rm ON rm.conversation_id = c.id
      WHERE rm.rn = 1
        AND rm.direction = 'out'
        ${startClause}
        ${endClause}
      ORDER BY rm.created_at DESC
    `);

    res.json(result.rows);
  });

  // Analyze purchase probability for a conversation
  app.post("/api/conversations/:id/analyze-purchase", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const conversation = await storage.getConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const messages = await storage.getMessages(id);
    const settings = await storage.getAiSettings();
    
    if (!settings?.enabled || !process.env.OPENAI_API_KEY) {
      return res.json({ probability: 'unknown', reason: 'AI not configured' });
    }
    
    // Build conversation context for analysis
    const recentMessages = messages.slice(-10).map(m => 
      `${m.direction === 'in' ? 'Cliente' : 'Tu'}: ${m.text || '[media]'}`
    ).join('\n');
    
    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        messages: [
          {
            role: 'system',
            content: `Analiza esta conversacion y responde SOLO con uno de estos: ALTA, MEDIA, BAJA.
ALTA = cliente mostro interes claro en comprar, pidio precios, pregunto por disponibilidad
MEDIA = cliente tiene interes pero no ha decidido, hizo preguntas generales
BAJA = solo preguntas informativas, sin intencion clara de compra
Responde en formato: PROBABILIDAD|razon breve (max 20 palabras)`
          },
          {
            role: 'user',
            content: recentMessages
          }
        ]
      });
      
      const result = response.choices[0]?.message?.content || 'BAJA|Sin informacion suficiente';
      const [probability, reason] = result.split('|');
      
      const prob = probability?.trim() || 'BAJA';
      const reasoning = reason?.trim() || 'Sin informacion';
      
      // If high probability, mark for calling
      if (prob === 'ALTA') {
        await storage.updateConversation(id, { shouldCall: true });
      }
      
      // Save analysis to history
      await storage.createPurchaseAnalysis({
        conversationId: id,
        probability: prob,
        reasoning: reasoning,
      });
      
      res.json({ 
        probability: prob, 
        reason: reasoning,
        shouldCall: prob === 'ALTA'
      });
    } catch (error: any) {
      console.error('Error analyzing purchase probability:', error);
      res.json({ probability: 'unknown', reason: error.message });
    }
  });

  // Get purchase analysis history for a conversation
  app.get("/api/conversations/:id/purchase-history", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const history = await storage.getPurchaseAnalyses(id);
    res.json(history);
  });

  // Generate follow-up message for a conversation
  app.post("/api/conversations/:id/generate-followup", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const conversation = await storage.getConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const messages = await storage.getMessages(id);
    const settings = await storage.getAiSettings();
    
    if (!settings?.enabled || !process.env.OPENAI_API_KEY) {
      return res.json({ message: 'Hola! Como estas? Me gustaria saber si tienes alguna pregunta.' });
    }
    
    const recentMessages = messages.slice(-6).map(m => 
      `${m.direction === 'in' ? 'Cliente' : 'Tu'}: ${m.text || '[media]'}`
    ).join('\n');
    
    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content: `Genera un mensaje de seguimiento amigable y corto (maximo 2 lineas) para retomar contacto con este cliente.
El mensaje debe ser natural, no invasivo, y relacionado con la conversacion anterior.
NO uses saludos formales. Se directo y amigable.`
          },
          {
            role: 'user',
            content: `Conversacion:\n${recentMessages}\n\nGenera un mensaje de seguimiento:`
          }
        ]
      });
      
      const message = response.choices[0]?.message?.content || 'Hola! Tienes alguna pregunta?';
      res.json({ message: message.trim() });
    } catch (error: any) {
      console.error('Error generating follow-up:', error);
      res.json({ message: 'Hola! Como estas? Me gustaria saber si tienes alguna pregunta.' });
    }
  });

  // Debug endpoint - check configuration
  app.get("/api/debug", requireAuth, async (req, res) => {
    const config = {
      hasMetaToken: !!process.env.META_ACCESS_TOKEN,
      hasPhoneId: !!process.env.WA_PHONE_NUMBER_ID,
      phoneId: process.env.WA_PHONE_NUMBER_ID || "NOT SET",
      hasVerifyToken: !!process.env.WA_VERIFY_TOKEN,
      hasAdminUser: !!process.env.ADMIN_USER,
      hasAdminPass: !!process.env.ADMIN_PASS,
      conversationCount: (await storage.getConversations()).length,
      timestamp: new Date().toISOString(),
    };
    res.json(config);
  });

  app.get("/api/link-preview", requireAuth, async (req, res) => {
    try {
      const rawUrl = String(req.query.url || "").trim();
      if (!rawUrl) {
        return res.status(400).json({ message: "Missing url" });
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(rawUrl);
      } catch {
        return res.status(400).json({ message: "Invalid url" });
      }

      if (!["http:", "https:"].includes(targetUrl.protocol)) {
        return res.status(400).json({ message: "Invalid protocol" });
      }

      const hostname = (targetUrl.hostname || "").toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local")) {
        return res.status(400).json({ message: "Blocked hostname" });
      }

      try {
        const htmlResponse = await axios.get(targetUrl.toString(), {
          responseType: "text",
          timeout: 8000,
          maxRedirects: 5,
          maxContentLength: 1024 * 1024,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; RyzappLinkPreview/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
        });

        const html = String(htmlResponse.data || "");
        const imageFromPage = extractOgImageFromHtml(html, targetUrl.toString());
        if (imageFromPage) {
          return res.json({ imageUrl: imageFromPage, source: "page-og" });
        }
      } catch {
        // ignore and try provider fallback
      }

      const imageFromProvider = await fetchOgImageFromProvider(targetUrl.toString());
      if (imageFromProvider) {
        return res.json({ imageUrl: imageFromProvider, source: "provider-og" });
      }

      res.json({ imageUrl: null });
    } catch (error: any) {
      console.error("Link preview error:", error?.message || error);
      res.json({ imageUrl: null });
    }
  });

  // Media Proxy
  app.get("/api/media/:mediaId", requireAuth, async (req, res) => {
    try {
      const mediaId = req.params.mediaId;
      const token = process.env.META_ACCESS_TOKEN;
      
      if (!token) return res.status(500).send("Meta Token missing");

      // 1. Get Media URL
      const urlResponse = await axios.get(`https://graph.facebook.com/v24.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const mediaUrl = urlResponse.data.url;

      // 2. Stream the media
      const mediaStream = await axios({
        url: mediaUrl,
        method: 'GET',
        responseType: 'stream',
        headers: { Authorization: `Bearer ${token}` }
      });

      // Forward content type
      res.setHeader('Content-Type', mediaStream.headers['content-type']);
      mediaStream.data.pipe(res);

    } catch (error) {
      console.error("Media fetch error:", error);
      res.status(404).send("Media not found");
    }
  });

  // === AI AGENT ROUTES ===

  // Validation schemas for AI routes
  const aiSettingsUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    systemPrompt: z.string().nullable().optional(),
    catalog: z.string().nullable().optional(),
    maxTokens: z.number().min(50).max(500).optional(),
    temperature: z.number().min(0).max(100).optional(),
    aiProvider: z.enum(["openai", "gemini"]).optional(),
    model: z.string().optional(),
    maxPromptChars: z.number().min(500).max(20000).optional(),
    conversationHistory: z.number().min(1).max(20).optional(),
    audioResponseEnabled: z.boolean().optional(),
    audioVoice: z.string().optional(),
    ttsProvider: z.enum(["openai", "elevenlabs"]).optional(),
    elevenlabsVoiceId: z.string().optional(),
    ttsSpeed: z.number().min(25).max(400).optional(),
    ttsInstructions: z.string().nullable().optional(),
    learningMode: z.boolean().optional(),
    followUpEnabled: z.boolean().optional(),
    followUpMinutes: z.number().min(5).max(60).optional(),
    followUpCheckIntervalMinutes: z.number().min(1).max(60).optional(),
    followUpBatchSize: z.number().min(1).max(100).optional(),
    followUpMessageMode: z.enum(["ai", "fixed"]).optional(),
    followUpFixedMessage: z.string().nullable().optional(),
  });

  const promptProfilesUpdateSchema = z.object({
    primaryPrompt: z.string().max(20000),
    secondaryPrompt: z.string().max(20000),
    tertiaryPrompt: z.string().max(20000),
    activeSlot: z.enum(["primary", "secondary", "tertiary"]),
  });

  const aiTrainingCreateSchema = z.object({
    type: z.enum(["text", "url", "image_url"]),
    title: z.string().max(200).nullable().optional(),
    content: z.string().min(1),
  });
  const ttsPreviewSchema = z.object({
    provider: z.enum(["openai", "elevenlabs"]),
    voice: z.string().optional(),
    elevenlabsVoiceId: z.string().optional(),
    speed: z.number().min(25).max(400).optional(),
    instructions: z.string().nullable().optional(),
    text: z.string().min(1).max(300).optional(),
    previewUrl: z.string().url().optional(),
  });

  // Get ElevenLabs available voices (user's own + shared Latin American female voices)
  app.get("/api/elevenlabs/voices", requireAuth, async (req, res) => {
    try {
      const apiKey = await getElevenLabsApiKey();
      
      const [userVoicesRes, sharedPopular, sharedTrending, sharedConversational, sharedAndrea] = await Promise.all([
        axios.get("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": apiKey }
        }),
        axios.get("https://api.elevenlabs.io/v1/shared-voices", {
          headers: { "xi-api-key": apiKey },
          params: { gender: "female", language: "es", page_size: 100, sort: "usage_character_count_7d" }
        }).catch(() => ({ data: { voices: [] } })),
        axios.get("https://api.elevenlabs.io/v1/shared-voices", {
          headers: { "xi-api-key": apiKey },
          params: { gender: "female", language: "es", page_size: 100, sort: "trending" }
        }).catch(() => ({ data: { voices: [] } })),
        axios.get("https://api.elevenlabs.io/v1/shared-voices", {
          headers: { "xi-api-key": apiKey },
          params: { gender: "female", language: "es", use_cases: "conversational", page_size: 100, sort: "usage_character_count_7d" }
        }).catch(() => ({ data: { voices: [] } })),
        axios.get("https://api.elevenlabs.io/v1/shared-voices", {
          headers: { "xi-api-key": apiKey },
          params: { language: "es", search: "andrea", page_size: 50 }
        }).catch(() => ({ data: { voices: [] } }))
      ]);

      const allSharedRaw = [
        ...(sharedPopular.data.voices || []),
        ...(sharedTrending.data.voices || []),
        ...(sharedConversational.data.voices || []),
        ...(sharedAndrea.data.voices || []),
      ];
      const sharedDeduped = Array.from(new Map(allSharedRaw.map((v: any) => [v.voice_id, v])).values());

      const userVoices = userVoicesRes.data.voices.map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || "user",
        labels: v.labels || {},
        preview_url: v.preview_url,
        source: "library" as const,
      }));

      const seenIds = new Set(userVoices.map((v: any) => v.voice_id));

      const sharedVoices = sharedDeduped
        .filter((v: any) => !seenIds.has(v.voice_id || v.public_owner_id))
        .map((v: any) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category || "shared",
          labels: { accent: v.accent || "latin american", gender: v.gender || "female", use_case: v.use_case || "", description: v.description || "", ...(v.labels || {}) },
          preview_url: v.preview_url,
          source: "shared" as const,
        }));

      res.json([...userVoices, ...sharedVoices]);
    } catch (error: any) {
      console.error("Error fetching ElevenLabs voices:", error.message);
      res.status(500).json({ message: "Error fetching ElevenLabs voices" });
    }
  });

  // Get AI Settings
  app.get("/api/ai/settings", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getAiSettings();
      res.json(settings || { enabled: false, systemPrompt: null, catalog: null });
    } catch (error) {
      console.error("Error fetching AI settings:", error);
      res.status(500).json({ message: "Error fetching AI settings" });
    }
  });

  // Update AI Settings
  app.patch("/api/ai/settings", requireAuth, async (req, res) => {
    try {
      const parsed = aiSettingsUpdateSchema.parse(req.body);
      const updated = await storage.updateAiSettings(parsed);
      res.json(updated);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid settings data", errors: error.errors });
      }
      console.error("Error updating AI settings:", error);
      res.status(500).json({ message: "Error updating AI settings" });
    }
  });

  app.get("/api/ai/prompt-profiles", requireAuth, async (_req, res) => {
    try {
      const profiles = await getPromptProfiles();
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching prompt profiles:", error);
      res.status(500).json({ message: "Error fetching prompt profiles" });
    }
  });

  app.patch("/api/ai/prompt-profiles", requireAuth, async (req, res) => {
    try {
      const parsed = promptProfilesUpdateSchema.parse(req.body);
      await Promise.all([
        upsertPromptProfile(PROMPT_PROFILE_PRIMARY_TITLE, parsed.primaryPrompt),
        upsertPromptProfile(PROMPT_PROFILE_SECONDARY_TITLE, parsed.secondaryPrompt),
        upsertPromptProfile(PROMPT_PROFILE_TERTIARY_TITLE, parsed.tertiaryPrompt),
        upsertPromptProfile(PROMPT_PROFILE_ACTIVE_TITLE, parsed.activeSlot),
      ]);

      const activePrompt = parsed.activeSlot === "tertiary"
        ? parsed.tertiaryPrompt
        : (parsed.activeSlot === "secondary" ? parsed.secondaryPrompt : parsed.primaryPrompt);
      await storage.updateAiSettings({ systemPrompt: activePrompt });

      res.json({
        primaryPrompt: parsed.primaryPrompt,
        secondaryPrompt: parsed.secondaryPrompt,
        tertiaryPrompt: parsed.tertiaryPrompt,
        activeSlot: parsed.activeSlot,
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid prompt profile data", errors: error.errors });
      }
      console.error("Error updating prompt profiles:", error);
      res.status(500).json({ message: "Error updating prompt profiles" });
    }
  });

  // Get Training Data
  app.get("/api/ai/training", requireAuth, async (req, res) => {
    try {
      const data = await storage.getAiTrainingData();
      res.json(data.filter(item => !isHiddenPromptProfileTitle(item.title)));
    } catch (error) {
      console.error("Error fetching training data:", error);
      res.status(500).json({ message: "Error fetching training data" });
    }
  });

  // Add Training Data
  app.post("/api/ai/training", requireAuth, async (req, res) => {
    try {
      const parsed = aiTrainingCreateSchema.parse(req.body);
      if (isHiddenPromptProfileTitle(parsed.title)) {
        return res.status(400).json({ message: "Reserved training data title" });
      }
      const created = await storage.createAiTrainingData(parsed);
      res.json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid training data", errors: error.errors });
      }
      console.error("Error creating training data:", error);
      res.status(500).json({ message: "Error creating training data" });
    }
  });

  // Update Training Data
  app.patch("/api/ai/training/:id", requireAuth, async (req, res) => {
    try {
      const parsed = aiTrainingCreateSchema.partial().parse(req.body);
      if (isHiddenPromptProfileTitle(parsed.title)) {
        return res.status(400).json({ message: "Reserved training data title" });
      }
      const updated = await storage.updateAiTrainingData(parseInt(req.params.id), parsed);
      res.json(updated);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid training data", errors: error.errors });
      }
      console.error("Error updating training data:", error);
      res.status(500).json({ message: "Error updating training data" });
    }
  });

  // Delete Training Data
  app.delete("/api/ai/training/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteAiTrainingData(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting training data:", error);
      res.status(500).json({ message: "Error deleting training data" });
    }
  });

  // Get AI Logs
  app.get("/api/ai/logs", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getAiLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching AI logs:", error);
      res.status(500).json({ message: "Error fetching AI logs" });
    }
  });

  // Get push notification logs
  app.get("/api/push-logs", requireAuth, async (req, res) => {
    res.json(pushLogs);
  });

  // Get WhatsApp delivery status logs (includes failed reasons when provided by Meta)
  app.get("/api/wa-status-logs", requireAuth, async (_req, res) => {
    res.json(waStatusLogs);
  });

  const TTS_PREVIEW_DEFAULT_TEXT = "Hola, esta es una prueba de voz para tu CRM de WhatsApp.";

  async function ensureTtsPreviewTableExists() {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tts_previews (
        id SERIAL PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        audio_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function getCachedTtsPreview(cacheKey: string) {
    await ensureTtsPreviewTableExists();
    const result: any = await db.execute(sql`
      SELECT cache_key, mime_type, audio_data
      FROM tts_previews
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `);
    return result?.rows?.[0] ?? null;
  }

  async function upsertTtsPreviewCache(input: { cacheKey: string; provider: string; voiceId: string; mimeType: string; audioData: Buffer }) {
    await ensureTtsPreviewTableExists();
    await db.execute(sql`
      INSERT INTO tts_previews (cache_key, provider, voice_id, mime_type, audio_data)
      VALUES (${input.cacheKey}, ${input.provider}, ${input.voiceId}, ${input.mimeType}, ${input.audioData})
      ON CONFLICT (cache_key)
      DO UPDATE SET
        mime_type = EXCLUDED.mime_type,
        audio_data = EXCLUDED.audio_data,
        updated_at = NOW()
    `);
  }

  app.post("/api/tts/preview-status", requireAuth, async (req, res) => {
    try {
      const parsed = ttsPreviewSchema.parse(req.body);
      const previewText = parsed.text?.trim() || TTS_PREVIEW_DEFAULT_TEXT;
      const provider = parsed.provider;
      const voiceId = provider === "elevenlabs"
        ? parsed.elevenlabsVoiceId
        : parsed.voice || "nova";

      if (!voiceId) {
        return res.status(400).json({ message: "Missing voice identifier" });
      }

      const speed = parsed.speed ? parsed.speed / 100 : 1.0;
      const instructions = parsed.instructions ?? null;
      const isElevenlabsPreview = provider === "elevenlabs" && Boolean(parsed.previewUrl);
      const cacheKey = provider === "elevenlabs"
        ? `elevenlabs|${voiceId}|${isElevenlabsPreview ? "preview-free-v1" : "preview-paid-v1"}`
        : `openai|${voiceId}|${speed}|${instructions || ""}|${previewText}`;

      const cached = await getCachedTtsPreview(cacheKey);
      res.json({
        saved: Boolean(cached?.audio_data),
        free: isElevenlabsPreview,
        provider,
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid preview payload", errors: error.errors });
      }
      console.error("Error checking TTS preview status:", error?.message || error);
      res.status(500).json({ message: "Error checking TTS preview status" });
    }
  });

  app.post("/api/tts/preview", requireAuth, async (req, res) => {
    try {
      const parsed = ttsPreviewSchema.parse(req.body);
      const previewText = parsed.text?.trim() || TTS_PREVIEW_DEFAULT_TEXT;
      const provider = parsed.provider;
      const voiceId = provider === "elevenlabs"
        ? parsed.elevenlabsVoiceId
        : parsed.voice || "nova";

      if (!voiceId) {
        return res.status(400).json({ message: "Missing voice identifier" });
      }

      const speed = parsed.speed ? parsed.speed / 100 : 1.0;
      const instructions = parsed.instructions ?? null;
      const isElevenlabsPreview = provider === "elevenlabs" && Boolean(parsed.previewUrl);
      const cacheKey = provider === "elevenlabs"
        ? `elevenlabs|${voiceId}|${isElevenlabsPreview ? "preview-free-v1" : "preview-paid-v1"}`
        : `openai|${voiceId}|${speed}|${instructions || ""}|${previewText}`;

      const setPreviewHeaders = (cacheStatus: "hit" | "miss", isFree: boolean, source: string) => {
        res.setHeader("X-TTS-Cache", cacheStatus);
        res.setHeader("X-TTS-Preview-Free", isFree ? "1" : "0");
        res.setHeader("X-TTS-Preview-Source", source);
        res.setHeader("X-TTS-Preview-Provider", provider);
      };

      const cached = await getCachedTtsPreview(cacheKey);
      if (cached?.audio_data) {
        const cachedBuffer = Buffer.isBuffer(cached.audio_data)
          ? cached.audio_data
          : Buffer.from(cached.audio_data);
        setPreviewHeaders("hit", isElevenlabsPreview, "cache");
        res.setHeader("Content-Type", cached.mime_type || "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        return res.send(cachedBuffer);
      }

      let audioBuffer: Buffer;
      let contentType: string;

      if (provider === "elevenlabs" && parsed.previewUrl) {
        const previewRes = await axios.get(parsed.previewUrl, { responseType: "arraybuffer" });
        audioBuffer = Buffer.from(previewRes.data);
        contentType = previewRes.headers["content-type"] || "audio/mpeg";
      } else {
        const options: TtsOptions = {
          provider,
          elevenlabsVoiceId: provider === "elevenlabs" ? voiceId : parsed.elevenlabsVoiceId,
          speed,
          instructions,
        };
        const generated = await generateTtsAudioBuffer(previewText, voiceId, options, "preview");
        audioBuffer = generated.audioBuffer;
        contentType = generated.contentType;
      }

      await upsertTtsPreviewCache({
        cacheKey,
        provider,
        voiceId,
        mimeType: contentType,
        audioData: audioBuffer,
      });

      setPreviewHeaders("miss", isElevenlabsPreview, isElevenlabsPreview ? "elevenlabs-preview" : "generated");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.send(audioBuffer);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid preview payload", errors: error.errors });
      }
      const details = error?.message || getElevenLabsErrorMessage(error);
      console.error("Error generating TTS preview:", details);
      res.status(500).json({ message: "Error generating TTS preview", details });
    }
  });

  const pushSettingsUpdateSchema = z.object({
    notifyNewMessages: z.boolean().optional(),
    notifyPending: z.boolean().optional(),
    reminderLeadMinutes: z.array(z.number().int().min(1).max(1440)).max(8).optional(),
  });

  app.get("/api/push-settings", requireAuth, async (_req, res) => {
    try {
      const settings = await getPushNotificationPreferences();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching push settings:", error);
      res.status(500).json({ message: "Error fetching push settings" });
    }
  });

  app.patch("/api/push-settings", requireAuth, async (req, res) => {
    try {
      const parsed = pushSettingsUpdateSchema.parse(req.body);
      const current = await getPushNotificationPreferences();
      const next: PushNotificationPreferences = {
        notifyNewMessages: parsed.notifyNewMessages ?? current.notifyNewMessages,
        notifyPending: parsed.notifyPending ?? current.notifyPending,
        reminderLeadMinutes: parsed.reminderLeadMinutes ?? current.reminderLeadMinutes,
      };
      const updated = await updatePushNotificationPreferences(next);
      res.json(updated);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid push settings data", errors: error.errors });
      }
      console.error("Error updating push settings:", error);
      res.status(500).json({ message: "Error updating push settings" });
    }
  });

  // === LEARNED RULES ROUTES ===

  // Get all learned rules
  app.get("/api/ai/rules", requireAuth, async (req, res) => {
    try {
      const rules = await storage.getLearnedRules();
      res.json(rules);
    } catch (error) {
      console.error("Error fetching learned rules:", error);
      res.status(500).json({ message: "Error fetching learned rules" });
    }
  });

  // Create learned rule
  app.post("/api/ai/rules", requireAuth, async (req, res) => {
    try {
      const { rule, learnedFrom, conversationId, learnHistoryId } = req.body;
      if (!rule) {
        return res.status(400).json({ message: "La regla es requerida" });
      }
      const created = await storage.createLearnedRule({
        rule,
        learnedFrom: learnedFrom || null,
        conversationId: conversationId || null,
        isActive: true,
      });
      const parsedLearnHistoryId = Number(learnHistoryId);
      if (Number.isInteger(parsedLearnHistoryId) && parsedLearnHistoryId > 0) {
        await markAiLearnHistoryAsSaved(parsedLearnHistoryId, created.id);
      }
      res.json(created);
    } catch (error) {
      console.error("Error creating learned rule:", error);
      res.status(500).json({ message: "Error creating learned rule" });
    }
  });

  // Update learned rule
  app.patch("/api/ai/rules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { rule, isActive } = req.body;
      const updated = await storage.updateLearnedRule(id, { rule, isActive });
      res.json(updated);
    } catch (error) {
      console.error("Error updating learned rule:", error);
      res.status(500).json({ message: "Error updating learned rule" });
    }
  });

  // Delete learned rule
  app.delete("/api/ai/rules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLearnedRule(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting learned rule:", error);
      res.status(500).json({ message: "Error deleting learned rule" });
    }
  });

  // Learn history (question + suggestion) for auditing
  app.get("/api/ai/learn-history", requireAuth, async (req, res) => {
    try {
      const limitRaw = Number(req.query.limit);
      const safeLimit = Number.isInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 200)
        : 100;
      await ensureAiLearnHistoryTableExists();
      const result: any = await db.execute(sql`
        SELECT
          id,
          conversation_id AS "conversationId",
          focus,
          message_count AS "messageCount",
          suggested_rule AS "suggestedRule",
          tokens_used AS "tokensUsed",
          model,
          error,
          saved_to_rules AS "savedToRules",
          saved_rule_id AS "savedRuleId",
          created_at AS "createdAt"
        FROM ai_learn_history
        ORDER BY created_at DESC, id DESC
        LIMIT ${safeLimit}
      `);
      res.json(result?.rows ?? []);
    } catch (error) {
      console.error("Error fetching ai learn history:", error);
      res.status(500).json({ message: "Error al obtener historial de aprendizaje" });
    }
  });

  // Learn from conversation - AI analyzes and suggests a rule
  app.post("/api/ai/learn", requireAuth, async (req, res) => {
    try {
      const { conversationId, focus, messageCount } = req.body;
      const parsedConversationId = Number(conversationId);
      const parsedMessageCount = Math.min(50, Math.max(5, Number(messageCount) || 10));
      const normalizedFocus = typeof focus === "string" ? focus.trim() : "";
      
      if (!Number.isInteger(parsedConversationId) || parsedConversationId <= 0) {
        return res.status(400).json({ message: "conversationId es requerido" });
      }

      const conversation = await storage.getConversation(parsedConversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversacion no encontrada" });
      }

      const messages = await storage.getMessages(parsedConversationId);
      const recentMessages = messages.slice(-parsedMessageCount);

      if (recentMessages.length === 0) {
        return res.status(400).json({ message: "No hay mensajes para analizar" });
      }

      const conversationText = recentMessages.map(m => 
        `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${m.text || `[${m.type}]`}`
      ).join('\n');

      const focusPrompt = normalizedFocus
        ? `Enfocate especificamente en: ${normalizedFocus}`
        : 'Identifica la leccion o estrategia mas importante';

      const prompt = `Analiza esta conversacion de ventas por WhatsApp y extrae UNA regla o estrategia que se pueda aplicar en futuras conversaciones.

${focusPrompt}

CONVERSACION:
${conversationText}

Responde SOLO con la regla/estrategia en formato: "Cuando [situacion], entonces [accion/respuesta]"
Maximo 2 lineas. Se especifico y practico.`;

      const openai = new (await import('openai')).default({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.3,
      });

      const suggestedRule = completion.choices[0]?.message?.content?.trim() || "";
      const tokensUsed = completion.usage?.total_tokens || 0;
      const learnHistoryId = await createAiLearnHistoryEntry({
        conversationId: parsedConversationId,
        focus: normalizedFocus || null,
        messageCount: parsedMessageCount,
        suggestedRule,
        tokensUsed,
        model: "gpt-4o-mini",
      });

      res.json({
        suggestedRule,
        tokensUsed,
        conversationId: parsedConversationId,
        learnHistoryId,
      });
    } catch (error: any) {
      console.error("Error learning from conversation:", error);
      try {
        const rawConversationId = Number(req.body?.conversationId);
        const rawMessageCount = Math.min(50, Math.max(5, Number(req.body?.messageCount) || 10));
        const rawFocus = typeof req.body?.focus === "string" ? req.body.focus.trim() : "";
        if (Number.isInteger(rawConversationId) && rawConversationId > 0) {
          await createAiLearnHistoryEntry({
            conversationId: rawConversationId,
            focus: rawFocus || null,
            messageCount: rawMessageCount,
            suggestedRule: null,
            tokensUsed: null,
            model: "gpt-4o-mini",
            error: error?.message || "Error al analizar conversacion",
          });
        }
      } catch (historyError) {
        console.error("Error storing ai_learn_history failure:", historyError);
      }
      res.status(500).json({ message: error.message || "Error al analizar conversacion" });
    }
  });

  // === PRODUCTS ROUTES ===

  app.get("/uploads/products/:fileName", async (req, res) => {
    try {
      const requested = String(req.params.fileName || "");
      const safeFileName = path.basename(requested);
      if (!safeFileName || safeFileName !== requested) {
        return res.status(400).send("Nombre de archivo invalido");
      }

      const stored = await getStoredProductImageByFileName(safeFileName);
      if (stored) {
        res.setHeader("Content-Type", stored.mimeType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.send(stored.data);
      }

      // Backward compatibility: try old filesystem location if it still exists.
      const legacyPath = path.join(getProductUploadDirectory(), safeFileName);
      if (fs.existsSync(legacyPath)) {
        return res.sendFile(legacyPath);
      }

      return res.status(404).send("Imagen no encontrada");
    } catch (error) {
      console.error("Error serving product image:", error);
      return res.status(500).send("Error interno");
    }
  });

  app.post("/api/products/upload-image", requireAuth, uploadProductImage.single("image"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No se recibio imagen" });
      }
      if (!file.mimetype?.startsWith("image/")) {
        return res.status(400).json({ message: "El archivo debe ser una imagen" });
      }

      const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      const baseName = sanitizeFilePart(path.basename(file.originalname || "producto", extension)) || "producto";
      const fileName = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}-${baseName}${extension}`;
      await ensureProductImageStorageTableExists();
      await db.execute(sql`
        INSERT INTO product_uploaded_images (file_name, mime_type, data)
        VALUES (${fileName}, ${file.mimetype || "application/octet-stream"}, ${file.buffer})
        ON CONFLICT (file_name) DO UPDATE
        SET mime_type = EXCLUDED.mime_type,
            data = EXCLUDED.data
      `);

      res.json({
        url: `/uploads/products/${fileName}`,
        fileName,
        size: file.size,
        mimeType: file.mimetype,
      });
    } catch (error) {
      console.error("Error uploading product image:", error);
      res.status(500).json({ message: "Error subiendo imagen" });
    }
  });

  // Get all products
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      await ensureProductImageColumnsExist();
      const products = await storage.getProducts();
      res.json(products);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Error fetching products" });
    }
  });

  // Create product
  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      await ensureProductImageColumnsExist();
      const parsed = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(parsed);
      res.json(product);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid product data", errors: error.errors });
      }
      console.error("Error creating product:", error);
      res.status(500).json({ message: "Error creating product" });
    }
  });

  // Update product - require name if provided
  app.patch("/api/products/:id", requireAuth, async (req, res) => {
    try {
      await ensureProductImageColumnsExist();
      const id = parseInt(req.params.id);
      const updateSchema = insertProductSchema.partial().refine(
        (data) => data.name === undefined || (data.name && data.name.length > 0),
        { message: "El nombre no puede estar vacio" }
      );
      const parsed = updateSchema.parse(req.body);
      const product = await storage.updateProduct(id, parsed);
      res.json(product);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid product data", errors: error.errors });
      }
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Error updating product" });
    }
  });

  // Delete product
  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    try {
      await ensureProductImageColumnsExist();
      const id = parseInt(req.params.id);
      await storage.deleteProduct(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Error deleting product" });
    }
  });

  // === AGENT MANAGEMENT (Admin only) ===
  app.get("/api/ad-routing-rules", requireAdmin, async (_req, res) => {
    try {
      const rules = await getAdLeadRoutingRules();
      res.json(rules);
    } catch (error) {
      console.error("Error fetching ad routing rules:", error);
      res.status(500).json({ message: "Error fetching ad routing rules" });
    }
  });

  app.put("/api/ad-routing-rules", requireAdmin, async (req, res) => {
    try {
      const parsed = z.object({
        adId: z.string().min(1).max(120),
        agentIds: z.array(z.number().int().positive()).min(1).max(50),
        isActive: z.boolean().optional(),
        isExclusive: z.boolean().optional(),
        productRoute: z.enum(["diabetes", "diabetes_y_peso", "dolor_y_estres", "dolor_articular"]).nullable().optional(),
      }).parse(req.body);

      const activeAgents = await storage.getActiveAgents();
      const activeAgentIds = new Set(activeAgents.map((a) => a.id));
      const validAgentIds = parsed.agentIds.filter((id) => activeAgentIds.has(id));
      if (validAgentIds.length === 0) {
        return res.status(400).json({ message: "Debe seleccionar al menos un agente activo" });
      }

      const saved = await upsertAdLeadRoutingRule({
        adId: parsed.adId,
        agentIds: validAgentIds,
        isActive: parsed.isActive,
        isExclusive: parsed.isExclusive,
        productRoute: parsed.productRoute,
      });
      res.json(saved);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid ad routing rule data", errors: error.errors });
      }
      console.error("Error upserting ad routing rule:", error);
      res.status(500).json({ message: "Error saving ad routing rule" });
    }
  });

  app.patch("/api/ad-routing-rules/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid rule id" });
      }

      const parsed = z.object({
        adId: z.string().min(1).max(120),
        agentIds: z.array(z.number().int().positive()).min(1).max(50),
        isActive: z.boolean().optional(),
        isExclusive: z.boolean().optional(),
        productRoute: z.enum(["diabetes", "diabetes_y_peso", "dolor_y_estres", "dolor_articular"]).nullable().optional(),
      }).parse(req.body);

      const activeAgents = await storage.getActiveAgents();
      const activeAgentIds = new Set(activeAgents.map((a) => a.id));
      const validAgentIds = parsed.agentIds.filter((agentId) => activeAgentIds.has(agentId));
      if (validAgentIds.length === 0) {
        return res.status(400).json({ message: "Debe seleccionar al menos un agente activo" });
      }

      const saved = await updateAdLeadRoutingRule(id, {
        adId: parsed.adId,
        agentIds: validAgentIds,
        isActive: parsed.isActive,
        isExclusive: parsed.isExclusive,
        productRoute: parsed.productRoute,
      });

      if (!saved) {
        return res.status(404).json({ message: "Rule not found" });
      }
      res.json(saved);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid ad routing rule data", errors: error.errors });
      }
      if (String(error?.message || "").includes("duplicate key")) {
        return res.status(400).json({ message: "Ya existe una regla con ese ad_id" });
      }
      console.error("Error updating ad routing rule:", error);
      res.status(500).json({ message: "Error updating ad routing rule" });
    }
  });

  app.delete("/api/ad-routing-rules/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid rule id" });
      }
      await deleteAdLeadRoutingRule(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting ad routing rule:", error);
      res.status(500).json({ message: "Error deleting ad routing rule" });
    }
  });

  app.get("/api/analytics-view-permissions", requireAdmin, async (_req, res) => {
    try {
      const permissions = await getAnalyticsViewPermissions();
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching analytics view permissions:", error);
      res.status(500).json({ message: "Error fetching analytics view permissions" });
    }
  });

  app.put("/api/analytics-view-permissions/:viewerAgentId", requireAdmin, async (req, res) => {
    try {
      const viewerAgentId = Number(req.params.viewerAgentId);
      if (!Number.isInteger(viewerAgentId) || viewerAgentId <= 0) {
        return res.status(400).json({ message: "Invalid viewerAgentId" });
      }

      const parsed = z.object({
        visibleAgentIds: z.array(z.number().int().positive()).max(200).default([]),
      }).parse(req.body ?? {});

      const allAgents = await storage.getAgents();
      const allAgentIds = new Set(allAgents.map((a) => Number(a.id)));
      if (!allAgentIds.has(viewerAgentId)) {
        return res.status(404).json({ message: "Viewer agent not found" });
      }

      const validVisibleIds = parseAgentIds(parsed.visibleAgentIds)
        .filter((id) => allAgentIds.has(id) && id !== viewerAgentId);

      const saved = await upsertAnalyticsViewPermission({
        viewerAgentId,
        visibleAgentIds: validVisibleIds,
      });
      res.json(saved);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid analytics permissions data", errors: error.errors });
      }
      console.error("Error saving analytics view permissions:", error);
      res.status(500).json({ message: "Error saving analytics view permissions" });
    }
  });

  app.get("/api/agents/ai-column-status", requireAdmin, async (_req, res) => {
    try {
      await ensureAgentAiColumnExists();
      const result = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'agents'
            AND column_name = 'is_ai_auto_reply_enabled'
        ) AS exists
      `);
      const exists = Boolean((result.rows as any[])[0]?.exists);
      res.json({ exists });
    } catch (error) {
      console.error("Error checking agent AI column status:", error);
      res.status(500).json({ message: "Error checking agent AI column status" });
    }
  });

  app.get("/api/agents", requireAdmin, async (req, res) => {
    try {
      await ensureAgentAiColumnExists();
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (dateFrom && !dateRegex.test(dateFrom)) {
        return res.status(400).json({ message: "Invalid dateFrom format. Use YYYY-MM-DD" });
      }
      if (dateTo && !dateRegex.test(dateTo)) {
        return res.status(400).json({ message: "Invalid dateTo format. Use YYYY-MM-DD" });
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        return res.status(400).json({ message: "dateFrom must be before or equal to dateTo" });
      }

      const dateFilterSql = sql`
        ${dateFrom ? sql`AND DATE(m.created_at AT TIME ZONE 'America/La_Paz') >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND DATE(m.created_at AT TIME ZONE 'America/La_Paz') <= ${dateTo}` : sql``}
      `;
      const leadDateFilterSql = sql`
        ${dateFrom ? sql`AND DATE(fi.first_inbound_at AT TIME ZONE 'America/La_Paz') >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND DATE(fi.first_inbound_at AT TIME ZONE 'America/La_Paz') <= ${dateTo}` : sql``}
      `;
      const inboundChatDateFilterSql = sql`
        ${dateFrom
          ? sql`AND DATE(
              COALESCE(
                CASE
                  WHEN m_in.timestamp ~ '^[0-9]+$' THEN to_timestamp(m_in.timestamp::double precision)
                  ELSE NULL
                END,
                m_in.created_at
              ) AT TIME ZONE 'America/La_Paz'
            ) >= ${dateFrom}`
          : sql``}
        ${dateTo
          ? sql`AND DATE(
              COALESCE(
                CASE
                  WHEN m_in.timestamp ~ '^[0-9]+$' THEN to_timestamp(m_in.timestamp::double precision)
                  ELSE NULL
                END,
                m_in.created_at
              ) AT TIME ZONE 'America/La_Paz'
            ) <= ${dateTo}`
          : sql``}
      `;

      let statsResult;
      try {
        statsResult = await db.execute(sql`
        SELECT
          a.id,
          a.name,
          a.username,
          a.password,
          a.is_active AS "isActive",
          a.is_ai_auto_reply_enabled AS "isAiAutoReplyEnabled",
          a.is_push_enabled AS "isPushEnabled",
          a.weight,
          a.created_at AS "createdAt",
          COALESCE(c_stats.assigned_conversations, 0) AS "assignedConversations",
          COALESCE(m_stats.inbound_messages, 0) AS "inboundMessages",
          COALESCE(ic_stats.inbound_chats, 0) AS "inboundChats",
          COALESCE(c_stats.new_leads, 0) AS "newLeads",
          COALESCE(c_stats.should_call_count, 0) AS "shouldCallCount",
          m_stats.last_activity_at AS "lastActivityAt"
        FROM agents a
        LEFT JOIN (
          SELECT
            c.assigned_agent_id AS agent_id,
            COUNT(DISTINCT c.id) AS assigned_conversations,
            COUNT(DISTINCT c.id) FILTER (
              WHERE fi.first_inbound_at IS NOT NULL
              ${leadDateFilterSql}
            ) AS new_leads,
            COUNT(DISTINCT c.id) FILTER (WHERE c.should_call = true) AS should_call_count
          FROM conversations c
          LEFT JOIN LATERAL (
            SELECT MIN(m2.created_at) AS first_inbound_at
            FROM messages m2
            WHERE m2.conversation_id = c.id
              AND m2.direction = 'in'
          ) fi ON true
          WHERE c.assigned_agent_id IS NOT NULL
          GROUP BY c.assigned_agent_id
        ) c_stats ON c_stats.agent_id = a.id
        LEFT JOIN (
          SELECT
            c.assigned_agent_id AS agent_id,
            COUNT(m.id) FILTER (WHERE m.direction = 'in') AS inbound_messages,
            MAX(m.created_at) AS last_activity_at
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.assigned_agent_id IS NOT NULL
            ${dateFilterSql}
          GROUP BY c.assigned_agent_id
        ) m_stats ON m_stats.agent_id = a.id
        LEFT JOIN (
          SELECT
            c.assigned_agent_id AS agent_id,
            COUNT(DISTINCT c.id) AS inbound_chats
          FROM conversations c
          WHERE c.assigned_agent_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM messages m_in
              WHERE m_in.conversation_id = c.id
                AND m_in.direction = 'in'
                ${inboundChatDateFilterSql}
            )
          GROUP BY c.assigned_agent_id
        ) ic_stats ON ic_stats.agent_id = a.id
        ORDER BY a.name ASC
      `);
      } catch (error: any) {
        // Backward-compatible fallback if production DB still lacks is_ai_auto_reply_enabled
        if (String(error?.message || "").includes("is_ai_auto_reply_enabled")) {
          statsResult = await db.execute(sql`
            SELECT
              a.id,
              a.name,
              a.username,
              a.password,
              a.is_active AS "isActive",
              true AS "isAiAutoReplyEnabled",
              a.is_push_enabled AS "isPushEnabled",
              a.weight,
              a.created_at AS "createdAt",
              COALESCE(c_stats.assigned_conversations, 0) AS "assignedConversations",
              COALESCE(m_stats.inbound_messages, 0) AS "inboundMessages",
              COALESCE(ic_stats.inbound_chats, 0) AS "inboundChats",
              COALESCE(c_stats.new_leads, 0) AS "newLeads",
              COALESCE(c_stats.should_call_count, 0) AS "shouldCallCount",
              m_stats.last_activity_at AS "lastActivityAt"
            FROM agents a
            LEFT JOIN (
              SELECT
                c.assigned_agent_id AS agent_id,
                COUNT(DISTINCT c.id) AS assigned_conversations,
                COUNT(DISTINCT c.id) FILTER (
                  WHERE fi.first_inbound_at IS NOT NULL
                  ${leadDateFilterSql}
                ) AS new_leads,
                COUNT(DISTINCT c.id) FILTER (WHERE c.should_call = true) AS should_call_count
              FROM conversations c
              LEFT JOIN LATERAL (
                SELECT MIN(m2.created_at) AS first_inbound_at
                FROM messages m2
                WHERE m2.conversation_id = c.id
                  AND m2.direction = 'in'
              ) fi ON true
              WHERE c.assigned_agent_id IS NOT NULL
              GROUP BY c.assigned_agent_id
            ) c_stats ON c_stats.agent_id = a.id
            LEFT JOIN (
              SELECT
                c.assigned_agent_id AS agent_id,
                COUNT(m.id) FILTER (WHERE m.direction = 'in') AS inbound_messages,
                MAX(m.created_at) AS last_activity_at
              FROM messages m
              JOIN conversations c ON m.conversation_id = c.id
              WHERE c.assigned_agent_id IS NOT NULL
                ${dateFilterSql}
              GROUP BY c.assigned_agent_id
            ) m_stats ON m_stats.agent_id = a.id
            LEFT JOIN (
              SELECT
                c.assigned_agent_id AS agent_id,
                COUNT(DISTINCT c.id) AS inbound_chats
              FROM conversations c
              WHERE c.assigned_agent_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM messages m_in
                  WHERE m_in.conversation_id = c.id
                    AND m_in.direction = 'in'
                    ${inboundChatDateFilterSql}
                )
              GROUP BY c.assigned_agent_id
            ) ic_stats ON ic_stats.agent_id = a.id
            ORDER BY a.name ASC
          `);
        } else {
          throw error;
        }
      }

      const agentsList = statsResult.rows.map((row: any) => ({
        ...row,
        assignedConversations: Number(row.assignedConversations || 0),
        inboundMessages: Number(row.inboundMessages || 0),
        inboundChats: Number(row.inboundChats || 0),
        newLeads: Number(row.newLeads || 0),
        shouldCallCount: Number(row.shouldCallCount || 0),
      }));

      res.json(agentsList);
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ message: "Error fetching agents" });
    }
  });

  app.post("/api/agents", requireAdmin, async (req, res) => {
    try {
      const { name, username, password, weight, isAiAutoReplyEnabled, isPushEnabled } = req.body;
      if (!name || !username || !password) {
        return res.status(400).json({ message: "Name, username and password are required" });
      }
      const existing = await storage.getAgentByUsername(username);
      const existingSubadmin = await storage.getSubadminByUsername(username);
      if (existing || existingSubadmin) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const agent = await storage.createAgent({
        name,
        username,
        password,
        isActive: true,
        isAiAutoReplyEnabled: typeof isAiAutoReplyEnabled === "boolean" ? isAiAutoReplyEnabled : true,
        isPushEnabled: typeof isPushEnabled === "boolean" ? isPushEnabled : true,
        weight: weight || 1,
      });
      res.json(agent);
    } catch (error) {
      console.error("Error creating agent:", error);
      res.status(500).json({ message: "Error creating agent" });
    }
  });

  app.patch("/api/agents/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      if (updates.username) {
        const existing = await storage.getAgentByUsername(updates.username);
        const existingSubadmin = await storage.getSubadminByUsername(updates.username);
        if ((existing && existing.id !== id) || existingSubadmin) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }
      const agent = await storage.updateAgent(id, updates);
      res.json(agent);
    } catch (error) {
      console.error("Error updating agent:", error);
      res.status(500).json({ message: "Error updating agent" });
    }
  });

  app.delete("/api/agents/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAgent(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error deleting agent" });
    }
  });

  app.get("/api/subadmins", requirePrimaryAdmin, async (_req, res) => {
    try {
      const subadmins = await storage.getSubadmins();
      res.json(subadmins);
    } catch (error) {
      console.error("Error fetching subadmins:", error);
      res.status(500).json({ message: "Error fetching subadmins" });
    }
  });

  app.post("/api/subadmins", requirePrimaryAdmin, async (req, res) => {
    try {
      const parsed = upsertSubadminSchema.parse(req.body);
      const existing = await storage.getSubadminByUsername(parsed.username);
      const existingAgent = await storage.getAgentByUsername(parsed.username);
      if (existing || existingAgent) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const created = await storage.createSubadmin({
        name: parsed.name,
        username: parsed.username,
        password: parsed.password,
        isActive: parsed.isActive ?? true,
      });
      res.json(created);
    } catch (error) {
      console.error("Error creating subadmin:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Invalid subadmin payload" });
      }
      res.status(500).json({ message: "Error creating subadmin" });
    }
  });

  app.patch("/api/subadmins/:id", requirePrimaryAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid subadmin id" });
      }

      const parsed = updateSubadminSchema.parse(req.body);
      if (parsed.username) {
        const existing = await storage.getSubadminByUsername(parsed.username);
        const existingAgent = await storage.getAgentByUsername(parsed.username);
        if ((existing && existing.id !== id) || existingAgent) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }

      const updated = await storage.updateSubadmin(id, parsed);
      res.json(updated);
    } catch (error) {
      console.error("Error updating subadmin:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Invalid subadmin payload" });
      }
      res.status(500).json({ message: "Error updating subadmin" });
    }
  });

  app.delete("/api/subadmins/:id", requirePrimaryAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid subadmin id" });
      }
      await storage.deleteSubadmin(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting subadmin:", error);
      res.status(500).json({ message: "Error deleting subadmin" });
    }
  });

  // Data deletion requests - public endpoint (no auth required)
  const deletionRequests: Array<{ id: number; phone: string; reason: string; createdAt: string; status: string }> = [];
  let deletionIdCounter = 1;

  app.post("/api/data-deletion-request", async (req, res) => {
    try {
      const { phone, reason } = req.body;
      if (!phone) return res.status(400).json({ message: "Phone is required" });
      deletionRequests.unshift({
        id: deletionIdCounter++,
        phone,
        reason: reason || "",
        createdAt: new Date().toISOString(),
        status: "pending",
      });
      if (deletionRequests.length > 100) deletionRequests.pop();
      console.log(`[Data Deletion] New request from ${phone}: ${reason || "No reason provided"}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error processing request" });
    }
  });

  app.get("/api/data-deletion-requests", requireAuth, async (_req, res) => {
    res.json(deletionRequests);
  });

  initFollowUp(sendToWhatsApp, sendAiResponseToWhatsApp);
  setInterval(async () => {
    try {
      await checkAndSendReminderPushes();
    } catch (error) {
      console.error("[ReminderPush] Error:", error);
    }
  }, REMINDER_PUSH_CHECK_INTERVAL_MS);
  console.log("[ReminderPush] Scheduler started (every 1 min)");

  return httpServer;
}
