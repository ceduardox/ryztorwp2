import OpenAI from "openai";
import { storage } from "./storage";
import type { Message, Product } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const DEFAULT_PUBLIC_BASE_URL = "https://ryzapp.org";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

type AiProvider = "openai" | "gemini" | "groq";

// Order status type
export type OrderStatus = 'pending' | 'ready' | 'delivered' | null;

// Normalize text: lowercase and remove accents
function normalize(text: string): string {
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Search products by matching name or keywords against user message
function findMatchingProducts(userMessage: string, products: Product[]): Product[] {
  const normalizedMessage = normalize(userMessage);
  
  return products.filter(product => {
    // Check full product name (normalized)
    const normalizedName = normalize(product.name);
    if (normalizedMessage.includes(normalizedName)) {
      return true;
    }
    
    // Check individual words in product name (>2 chars)
    const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2);
    const nameMatch = nameWords.some(word => normalizedMessage.includes(word));
    
    // Check keywords (normalized)
    const keywordsMatch = product.keywords?.split(/[,\s]+/)
      .filter(k => k.length > 2)
      .some(keyword => normalizedMessage.includes(normalize(keyword)));
    
    return nameMatch || keywordsMatch;
  });
}

// Check if message is asking about products in general
function isProductQuery(userMessage: string): boolean {
  const generalKeywords = [
    "precio", "costo", "cuánto", "cuanto", "producto", "catálogo", "catalogo",
    "comprar", "pedir", "disponible", "tienen", "hay", "busco", "quiero",
    "necesito", "promoción", "promocion", "descuento", "oferta", "stock",
    "venden", "qué venden", "que venden", "lista", "opciones"
  ];
  const lowerMessage = userMessage.toLowerCase();
  return generalKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Only explicit catalog browsing should inject the full product list.
// Generic requests like "precio" should be handled by the system prompt,
// which may prefer a problem-based entry flow instead of direct product selection.
function isCatalogQuery(userMessage: string): boolean {
  const lowerMessage = userMessage.toLowerCase();
  const generalKeywords = [
    "producto",
    "productos",
    "catalogo",
    "catálogo",
    "tienen",
    "hay",
    "venden",
    "que venden",
    "qué venden",
    "lista",
    "opciones",
    "ver productos",
  ];

  return generalKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Search for product context in conversation history
function findProductInHistory(recentMessages: Message[], products: Product[]): Product | null {
  // Look through recent messages for product mentions
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    if (msg.text) {
      const matches = findMatchingProducts(msg.text, products);
      if (matches.length === 1) {
        return matches[0]; // Found a specific product in history
      }
    }
  }
  return null;
}

function resolvePublicImageUrl(imageUrl?: string | null): string {
  const value = (imageUrl || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith("/")) return value;
  const baseUrl = (process.env.APP_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return `${baseUrl}${value}`;
}

function normalizeAiProvider(value?: string | null): AiProvider {
  if (value === "gemini" || value === "groq") return value;
  return "openai";
}

function getDefaultModelForProvider(provider: AiProvider): string {
  if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
  if (provider === "groq") return DEFAULT_GROQ_MODEL;
  return DEFAULT_OPENAI_MODEL;
}

async function requestOpenAiCompletion(params: {
  model: string;
  messages: any[];
  maxTokens: number;
  temperature: number;
}) {
  const completion = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  });

  return {
    responseText: completion.choices[0]?.message?.content || "",
    tokensUsed: completion.usage?.total_tokens || 0,
    providerUsed: "openai" as const,
  };
}

async function requestGroqCompletion(params: {
  model: string;
  messages: any[];
  maxTokens: number;
  temperature: number;
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const groq = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const completion = await groq.chat.completions.create({
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  });

  return {
    responseText: completion.choices[0]?.message?.content || "",
    tokensUsed: completion.usage?.total_tokens || 0,
    providerUsed: "groq" as const,
  };
}

async function requestGeminiCompletion(params: {
  model: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const contents = [
    ...params.conversationHistory.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    {
      role: "user",
      parts: [{ text: params.userMessage }],
    },
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      payload?.error?.message ||
      payload?.message ||
      `Gemini request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const parts = payload?.candidates?.[0]?.content?.parts;
  const responseText = Array.isArray(parts)
    ? parts.map((part: any) => String(part?.text || "")).join("").trim()
    : "";
  const tokensUsed = Number(payload?.usageMetadata?.totalTokenCount || 0);

  return {
    responseText,
    tokensUsed,
    providerUsed: "gemini" as const,
  };
}

function getProductImageContext(product: Product) {
  const imageLines: string[] = [];
  const mainImage = resolvePublicImageUrl(product.imageUrl);
  const bottleImage = resolvePublicImageUrl(product.imageBottleUrl);
  const doseImage = resolvePublicImageUrl(product.imageDoseUrl);
  const ingredientsImage = resolvePublicImageUrl(product.imageIngredientsUrl);
  if (mainImage) imageLines.push(`Imagen principal: ${mainImage}`);
  if (bottleImage) imageLines.push(`Imagen frasco: ${bottleImage}`);
  if (doseImage) imageLines.push(`Imagen dosis: ${doseImage}`);
  if (ingredientsImage) imageLines.push(`Imagen ingredientes: ${ingredientsImage}`);
  return imageLines.join("\n");
}

export async function generateAiResponse(
  conversationId: number,
  userMessage: string,
  recentMessages: Message[],
  imageBase64?: string, // Optional: base64 encoded image for vision analysis
  advisorName?: string,
): Promise<{ response: string; imageUrl?: string; tokensUsed: number; orderReady?: boolean; needsHuman?: boolean; shouldCall?: boolean } | null> {
  try {
    const [settings, allProducts, learnedRules] = await Promise.all([
      storage.getAiSettings(),
      storage.getProducts(),
      storage.getActiveLearnedRules(),
    ]);
    
    if (!settings?.enabled) {
      return null;
    }
    
    // Find products matching user's current message
    const matchingProducts = findMatchingProducts(userMessage, allProducts);
    
    // Get catalog from settings (fallback for products not in database)
    const catalog = settings.catalog || "";
    
    // SMART PRODUCT SEARCH LOGIC:
    // 1. First, AI uses instructions/system prompt
    // 2. If user mentions a product name, load that product info
    // 3. If asking specific question (like dosage) and no product in current message,
    //    look in conversation history for which product they're asking about
    
    let productContext = "";
    let productInContext: Product | null = null;
    
    if (matchingProducts.length > 0) {
      // User mentioned specific product(s) - include only those
      productContext = matchingProducts.map(p => 
        `${p.name} - ${p.price || "Consultar precio"}${p.comboQty ? `\nCOMBO: ${p.comboQty} por ${p.comboPrice || "Consultar"}` : ""}\n${p.description || ""}\n${getProductImageContext(p)}`
      ).join("\n\n");
      productInContext = matchingProducts[0];
    } else {
      // Check if it's a follow-up question about a product mentioned earlier
      const historyProduct = findProductInHistory(recentMessages, allProducts);
      if (historyProduct) {
        productContext = `${historyProduct.name} - ${historyProduct.price || "Consultar precio"}${historyProduct.comboQty ? `\nCOMBO: ${historyProduct.comboQty} por ${historyProduct.comboPrice || "Consultar"}` : ""}\n${historyProduct.description || ""}\n${getProductImageContext(historyProduct)}`;
        productInContext = historyProduct;
      } else if (isCatalogQuery(userMessage)) {
        // General product query without specific product - show list
        if (allProducts.length > 0) {
          productContext = "PRODUCTOS DISPONIBLES:\n" + allProducts.map(p => 
            `• ${p.name} - ${p.price || "Consultar"}`
          ).join("\n");
        } else if (catalog) {
          productContext = catalog.substring(0, 1500);
        }
      }
    }

    // Get previous messages for context (configurable, default 3)
    const historyCount = settings.conversationHistory || 3;
    const conversationHistory = recentMessages
      .slice(-(historyCount + 1), -1)
      .map((m) => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.text || `[${m.type}]`,
      })) as Array<{ role: "user" | "assistant"; content: string }>;

    const resolvedAdvisorName = (advisorName || "").trim() || "Isabella";
    const promptTemplate = settings.systemPrompt || "Eres un asistente de ventas amigable.";
    let instructions = promptTemplate
      .replace(/\{\{\s*AGENT_NAME\s*\}\}/gi, resolvedAdvisorName)
      .replace(/\{\{\s*NOMBRE_AGENTE\s*\}\}/gi, resolvedAdvisorName);
    // Backward-compatible safety: if old prompt hardcodes "Isabella", map it to the active advisor.
    if (resolvedAdvisorName.toLowerCase() !== "isabella") {
      instructions = instructions
        .replace(/\bsoy\s+isabella\b/gi, `soy ${resolvedAdvisorName}`)
        .replace(/\bme\s+llamo\s+isabella\b/gi, `me llamo ${resolvedAdvisorName}`)
        .replace(/\bisabella\b/gi, resolvedAdvisorName);
    }
    
    const learnedRulesContext = learnedRules.length > 0 
      ? "\n=== REGLAS APRENDIDAS ===\n" + learnedRules.map(r => `- ${r.rule}`).join("\n")
      : "";
    
    // Build system prompt
    const systemPrompt = `NOMBRE DE ASESORA PARA ESTA CONVERSACION: ${resolvedAdvisorName}
REGLA INMUTABLE: Si te presentas o mencionas nombre de asesora, usa SIEMPRE "${resolvedAdvisorName}".
Solo usa "Isabella" cuando el nombre asignado sea exactamente Isabella.
REGLA LOGISTICA INMUTABLE:
- Nunca niegues envio por ciudad o provincia.
- Si la ciudad NO esta habilitada para pago al recibir, SI confirmas envio por transportadora/flota/trufi.
- "No habilitada para pago al recibir" NO significa "sin envio".

${instructions}

=== REGLAS ===
- Responde en 2-5 líneas máximo
- Máximo 2 preguntas por respuesta
- Tono humano y cálido
- Para enviar imagen usa: [IMAGEN: url]
- Para enviar botones interactivos (máximo 3 opciones, 20 caracteres cada una) usa: [BOTONES: opción1, opción2, opción3]. Ejemplo: Te paso nuestros productos [BOTONES: Berberina, Citrato Magnesio, Ver más]
- Para enviar una lista interactiva (hasta 10 opciones) usa: [LISTA: título del botón | opción1, opción2, opción3]. Ejemplo: Mira nuestro catálogo [LISTA: Ver productos | Berberina, Citrato Magnesio, Bitter Melon]
- IMPORTANTE: Cuando las instrucciones mencionen "botones" o el cliente deba elegir entre opciones, SIEMPRE usa el formato [BOTONES:] o [LISTA:]. NUNCA escribas las opciones como texto plano con asteriscos o viñetas.
- IMPORTANTE: Cuando el cliente confirme el pedido con TODOS los datos requeridos según la modalidad de envío, escribe [PEDIDO_LISTO] al final de tu respuesta para marcar que hay un pedido listo para entregar.
- Para ciudades con delivery, un pedido está listo cuando tienes: producto, cantidad, nombre y dirección de entrega o ubicación GPS.
- Para ciudades, pueblos o departamentos sin delivery que se atienden por encomienda/transportadora, un pedido está listo cuando tienes: producto, cantidad, nombre y ciudad, pueblo o departamento de destino. En estos casos NO exijas dirección ni ubicación GPS.
- Si NO puedes responder la pregunta con la información disponible, escribe exactamente [NECESITO_HUMANO] y no respondas nada más.
- Si el cliente pide que lo llamen, menciona llamada telefónica, o detectas que una llamada cerraría la venta (NEUROVENTA), escribe [LLAMAR] al final. Recuerda: ya tienes su número de WhatsApp, NO le pidas número.
${learnedRulesContext}
${productContext ? `\n=== PRODUCTOS ===\n${productContext}` : ""}`;

    // Build user message content - with or without image
    let userContent: any = userMessage;
    if (imageBase64) {
      // Vision format: array with text and image
      userContent = [
        { type: "text", text: userMessage || "El cliente envió esta imagen. Analízala y responde." },
        { 
          type: "image_url", 
          image_url: { 
            url: `data:image/jpeg;base64,${imageBase64}`,
            detail: "low" // Use low detail to save tokens
          } 
        }
      ];
    }

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userContent },
    ];

    const configuredProvider = normalizeAiProvider(settings.aiProvider);
    const modelToUse = settings.model || getDefaultModelForProvider(configuredProvider);
    const maxTokensToUse = settings.maxTokens || 120;
    const temperatureToUse = (settings.temperature || 70) / 100; // Convert 0-100 to 0-1
    const shouldUseGemini = configuredProvider === "gemini" && !imageBase64;
    const shouldUseGroq = configuredProvider === "groq" && !imageBase64;

    let responseText = "";
    let tokensUsed = 0;
    let providerUsed: AiProvider = "openai";

    if ((configuredProvider === "gemini" || configuredProvider === "groq") && imageBase64) {
      console.log(`[AI] ${configuredProvider} selected but image input detected. Falling back to OpenAI for vision.`);
    }

    if (shouldUseGroq) {
      try {
        const groqResult = await requestGroqCompletion({
          model: modelToUse,
          messages,
          maxTokens: maxTokensToUse,
          temperature: temperatureToUse,
        });
        responseText = groqResult.responseText;
        tokensUsed = groqResult.tokensUsed;
        providerUsed = groqResult.providerUsed;
      } catch (groqError) {
        console.error("[AI] Groq failed. Falling back to OpenAI:", groqError);
        const openAiResult = await requestOpenAiCompletion({
          model: getDefaultModelForProvider("openai"),
          messages,
          maxTokens: maxTokensToUse,
          temperature: temperatureToUse,
        });
        responseText = openAiResult.responseText;
        tokensUsed = openAiResult.tokensUsed;
        providerUsed = openAiResult.providerUsed;
      }
    } else if (shouldUseGemini) {
      try {
        const geminiResult = await requestGeminiCompletion({
          model: modelToUse,
          systemPrompt,
          conversationHistory,
          userMessage,
          maxTokens: maxTokensToUse,
          temperature: temperatureToUse,
        });
        responseText = geminiResult.responseText;
        tokensUsed = geminiResult.tokensUsed;
        providerUsed = geminiResult.providerUsed;
      } catch (geminiError) {
        console.error("[AI] Gemini failed. Falling back to OpenAI:", geminiError);
        const openAiResult = await requestOpenAiCompletion({
          model: getDefaultModelForProvider("openai"),
          messages,
          maxTokens: maxTokensToUse,
          temperature: temperatureToUse,
        });
        responseText = openAiResult.responseText;
        tokensUsed = openAiResult.tokensUsed;
        providerUsed = openAiResult.providerUsed;
      }
    } else {
      const openAiResult = await requestOpenAiCompletion({
        model: configuredProvider === "openai" ? modelToUse : getDefaultModelForProvider("openai"),
        messages,
        maxTokens: maxTokensToUse,
        temperature: temperatureToUse,
      });
      responseText = openAiResult.responseText;
      tokensUsed = openAiResult.tokensUsed;
      providerUsed = openAiResult.providerUsed;
    }

    // Extract image URL if present
    const imageMatch = responseText.match(/\[IMAGEN:\s*([^\]]+)\]/i);
    let imageUrl: string | undefined;
    let cleanResponse = responseText;
    
    if (imageMatch) {
      imageUrl = resolvePublicImageUrl(imageMatch[1]);
      cleanResponse = cleanResponse.replace(imageMatch[0], "").trim();
    }

    // Check if order is ready (AI detected complete order with all data)
    const orderReady = cleanResponse.includes("[PEDIDO_LISTO]");
    if (orderReady) {
      cleanResponse = cleanResponse.replace(/\[PEDIDO_LISTO\]/gi, "").trim();
      console.log("=== ORDER READY DETECTED ===", { conversationId });
    }

    // Check if AI needs human help
    const needsHuman = cleanResponse.includes("[NECESITO_HUMANO]");
    if (needsHuman) {
      cleanResponse = cleanResponse.replace(/\[NECESITO_HUMANO\]/gi, "").trim();
      console.log("=== NEEDS HUMAN ATTENTION ===", { conversationId });
    }

    // Check if should call (NEUROVENTA or explicit request)
    const shouldCall = cleanResponse.includes("[LLAMAR]");
    if (shouldCall) {
      cleanResponse = cleanResponse.replace(/\[LLAMAR\]/gi, "").trim();
      console.log("=== SHOULD CALL DETECTED ===", { conversationId });
    }

    storage.createAiLog({
      conversationId,
      userMessage,
      aiResponse: `[${providerUsed}] ${responseText}`,
      tokensUsed,
      success: true,
    }).catch(err => console.error("AI log error:", err));

    return { response: needsHuman ? "" : cleanResponse, imageUrl: needsHuman ? undefined : imageUrl, tokensUsed, orderReady, needsHuman, shouldCall };
  } catch (error: any) {
    console.error("AI Error:", error);
    
    await storage.createAiLog({
      conversationId,
      userMessage,
      aiResponse: null,
      tokensUsed: 0,
      success: false,
      error: error.message,
    });

    return null;
  }
}
