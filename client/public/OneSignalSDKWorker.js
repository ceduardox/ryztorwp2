/* eslint-disable no-restricted-globals */
function normalizeNotificationData(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function extractConversationId(data) {
  const candidates = [
    data.conversationId,
    data?.data?.conversationId,
    data?.onesignal?.data?.conversationId,
    data?.onesignal?.data?.custom?.conversationId,
    data?.custom?.conversationId,
    data?.custom?.a?.conversationId,
    data?.additionalData?.conversationId,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (/^\d+$/.test(value)) return value;
  }

  return null;
}

function extractNotificationUrl(data) {
  const candidates = [
    data.url,
    data?.onesignal?.url,
    data?.onesignal?.data?.url,
    data?.data?.url,
    data?.custom?.u,
    data?.custom?.url,
    data?.additionalData?.url,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }

  return null;
}

function buildTargetUrl(data) {
  const origin = self.location?.origin || "";
  const conversationId = extractConversationId(data);
  if (conversationId) {
    return `${origin}/?conversationId=${conversationId}`;
  }

  const rawUrl = extractNotificationUrl(data);
  if (rawUrl) {
    try {
      return new URL(rawUrl, origin || undefined).toString();
    } catch {
      return rawUrl;
    }
  }

  return origin ? `${origin}/` : "/";
}

self.addEventListener("notificationclick", (event) => {
  try {
    event.notification.close();
  } catch {
    // ignore
  }

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  const data = normalizeNotificationData(event.notification?.data);
  const targetUrl = buildTargetUrl(data);

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const origin = self.location?.origin || "";
    const appClient =
      windowClients.find((client) => typeof client.url === "string" && client.url.startsWith(origin)) ||
      windowClients[0];

    if (appClient) {
      // Traer la app al frente PRIMERO. Antes se hacia navigate() y luego focus();
      // cuando el navigate no resolvia (pestana en segundo plano) el focus nunca
      // corria, por eso el chat solo abria al sacar la app de segundo plano a mano.
      try {
        await appClient.focus();
      } catch {
        // ignore focus failures
      }
      try {
        await appClient.navigate(targetUrl);
      } catch {
        // ignore navigation failures
      }
      return;
    }

    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }
    return undefined;
  })());
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
