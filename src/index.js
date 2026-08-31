import {
  NAVASAN_SYMBOLS,
  SETTINGS,
  SYMBOL_METADATA,
  TGJU_SYMBOLS
} from "./config.js";

// آخرین قیمت دریافت‌شده برای پاسخ فوری به /start و /price.
const LATEST_STATE_KEY = "latest_prices_multisource_v1";

// قیمت‌هایی که آخرین بار در کانال منتشر شده‌اند؛ آستانه تغییر نسبت به این داده سنجیده می‌شود.
const CHANNEL_STATE_KEY = "last_channel_prices_nerkh_v3";

// زمان آخرین پیام موفق کانال برای رعایت فاصله پنج‌دقیقه‌ای.
const LAST_CHANNEL_SEND_KEY = "last_channel_send_at_nerkh_v1";

// برای سازگاری با نسخه‌های قبلی پروژه.
const LEGACY_LATEST_STATE_KEY = "latest_prices_nerkh_v3";
const LEGACY_STATE_KEY = "last_prices_nerkh_v2";

const NERKH_TOKEN_KEY = "nerkh_api_token_multisource_v1";
const NERKH_INVALID_FINGERPRINT_KEY = "nerkh_invalid_token_fingerprint_v2";
const NERKH_CACHE_KEY = "nerkh_price_cache_v1";
const NERKH_RUNTIME_KEY = "nerkh_runtime_v1";
const LAST_PROVIDER_STATUS_KEY = "last_provider_status_multisource_v1";
const NERKH_PENDING_PREFIX = "pending_nerkh_token_user_";
const WEBHOOK_PATH = "/telegram-webhook";
const WEBHOOK_SETUP_PATH = "/admin/setup-webhook";
const WEBHOOK_STATUS_PATH = "/admin/webhook-status";

const ADMIN_PANEL_CALLBACKS = Object.freeze({
  MENU: "admin:menu",
  PRICE: "admin:price",
  NERKH_STATUS: "admin:nerkhstatus",
  SET_NERKH: "admin:setnerkh",
  CLEAR_NERKH_CONFIRM: "admin:clearnerkh_confirm",
  CLEAR_NERKH: "admin:clearnerkh",
  WEBHOOK_STATUS: "admin:webhookstatus",
  WHOAMI: "admin:whoami"
});

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runPriceCheck(env).catch((error) => {
        console.error(`Cron price check failed: ${compactError(error)}`);
      })
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      return handleWebhookRequest(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === WEBHOOK_SETUP_PATH) {
      return handleWebhookSetupRequest(request, env);
    }

    if (request.method === "GET" && url.pathname === WEBHOOK_STATUS_PATH) {
      return handleWebhookStatusRequest(request, env);
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "telegram-market-price-bot",
        provider: SETTINGS.sourceLabel,
        providerOrder: ["Nerkh.io", "TGJU", "Navasan/GitHub"],
        schedule: "every minute",
        webhookPath: WEBHOOK_PATH,
        watchedSymbols: SETTINGS.watchedSymbols
      });
    }

    return new Response(
      [
        "Telegram Market Price Bot is running.",
        `Providers: ${SETTINGS.sourceLabel}`,
        "Health check: /health",
        `Telegram webhook: ${WEBHOOK_PATH}`,
        "Price checks are executed by Cloudflare Cron Trigger."
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=UTF-8" }
      }
    );
  }
};

export async function handleWebhookSetupRequest(request, env, fetchImpl = fetch) {
  const auth = validateWebhookSetupAuthorization(request, env);
  if (!auth.ok) return auth.response;

  if (!env?.TELEGRAM_BOT_TOKEN) {
    return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." }, { status: 503 });
  }

  if (!env?.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}${WEBHOOK_PATH}`;

  try {
    const result = await setTelegramWebhook({
      botToken: env.TELEGRAM_BOT_TOKEN,
      webhookUrl,
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
      fetchImpl
    });

    return Response.json({
      ok: true,
      description: result?.description ?? "Webhook was set",
      webhookUrl
    });
  } catch (error) {
    console.error(`Webhook setup failed: ${compactError(error)}`);
    return Response.json(
      { ok: false, error: compactError(error), webhookUrl },
      { status: 502 }
    );
  }
}

export async function handleWebhookStatusRequest(request, env, fetchImpl = fetch) {
  const auth = validateWebhookSetupAuthorization(request, env);
  if (!auth.ok) return auth.response;

  if (!env?.TELEGRAM_BOT_TOKEN) {
    return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." }, { status: 503 });
  }

  try {
    const result = await getTelegramWebhookInfo({
      botToken: env.TELEGRAM_BOT_TOKEN,
      fetchImpl
    });

    return Response.json({ ok: true, webhook: result?.result ?? null });
  } catch (error) {
    console.error(`Webhook status failed: ${compactError(error)}`);
    return Response.json(
      { ok: false, error: compactError(error) },
      { status: 502 }
    );
  }
}

export function validateWebhookSetupAuthorization(request, env) {
  const expected = cleanSecretValue(env?.WEBHOOK_SETUP_SECRET ?? "");
  if (!expected) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "WEBHOOK_SETUP_SECRET is not configured." },
        { status: 503 }
      )
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = cleanSecretValue(
    bearerMatch?.[1] ?? request.headers.get("x-webhook-setup-secret") ?? ""
  );

  if (!supplied || !constantTimeStringEqual(supplied, expected)) {
    return {
      ok: false,
      response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    };
  }

  return { ok: true };
}

function constantTimeStringEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  const maxLength = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function setTelegramWebhook({
  botToken,
  webhookUrl,
  secretToken,
  fetchImpl = fetch
}) {
  const token = cleanSecretValue(botToken);
  const secret = cleanSecretValue(secretToken);
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SETTINGS.requestTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        drop_pending_updates: true,
        allowed_updates: ["message", "callback_query"]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}

    if (!response.ok || !payload?.ok) {
      throw new Error(`Telegram setWebhook HTTP ${response.status}: ${payload?.description ?? text.slice(0, 500) ?? "unknown"}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Telegram setWebhook request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getTelegramWebhookInfo({ botToken, fetchImpl = fetch }) {
  const token = cleanSecretValue(botToken);
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SETTINGS.requestTimeoutMs);

  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}

    if (!response.ok || !payload?.ok) {
      throw new Error(`Telegram getWebhookInfo HTTP ${response.status}: ${payload?.description ?? text.slice(0, 500) ?? "unknown"}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Telegram getWebhookInfo request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleWebhookRequest(request, env, ctx) {
  if (!env?.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Webhook secret is not configured.", { status: 503 });
  }

  const receivedSecret = request.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  ctx.waitUntil(handleTelegramUpdate(update, env));
  return Response.json({ ok: true });
}

export async function handleTelegramUpdate(update, env) {
  if (update?.callback_query) {
    return handleAdminCallbackQuery(update.callback_query, env);
  }

  const message = update?.message;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const chatType = message?.chat?.type;
  const text = message?.text?.trim() ?? "";

  if (!chatId || !text) {
    return { handled: false };
  }

  if (!env?.TELEGRAM_BOT_TOKEN) {
    throw new Error("متغیر محرمانه TELEGRAM_BOT_TOKEN تنظیم نشده است.");
  }

  if (!env?.DB) {
    throw new Error("اتصال دیتابیس D1 با نام DB تنظیم نشده است.");
  }

  if (isAdminPanelText(text)) {
    if (chatType !== "private" || !isTelegramAdmin(userId, env)) {
      await sendTelegramMessage({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: "⛔ پنل مدیریت فقط برای ادمین و در چت خصوصی فعال است."
      });
      return { handled: true, admin: false };
    }

    await sendAdminPanel({ env, chatId, userId });
    return { handled: true, admin: true, command: "panel" };
  }

  // این فرمان عمداً برای همه باز است تا کاربر بتواند User ID خودش را پیدا کند.
  if (isWhoAmICommand(text)) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "🆔 <b>شناسه تلگرام شما</b>",
        `<code>${escapeHtml(String(userId ?? "نامشخص"))}</code>`,
        "",
        "این عدد را یک‌بار در Cloudflare با نام TELEGRAM_ADMIN_USER_ID تنظیم کنید."
      ].join("\n")
    });
    return { handled: true, command: "whoami" };
  }

  const adminCommand = getAdminCommand(text);
  const pendingToken = userId
    ? await isNerkhTokenPending(env.DB, userId)
    : false;

  if (adminCommand || pendingToken) {
    return handleAdminUpdate({
      message,
      chatId,
      chatType,
      userId,
      text,
      adminCommand,
      pendingToken,
      env
    });
  }

  if (!isPriceCommand(text)) {
    return { handled: false };
  }

  const state = await readLatestState(env.DB);
  const items = stateToItems(state, SETTINGS.watchedSymbols);

  if (items.length === 0) {
    const adminPrivate = chatType === "private" && isTelegramAdmin(userId, env);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "⏳ <b>قیمت‌ها هنوز دریافت نشده‌اند.</b>",
        "لطفاً حدود یک دقیقه دیگر دوباره قیمت‌ها را بررسی کنید."
      ].join("\n"),
      replyMarkup: adminPrivate ? buildAdminReplyKeyboard() : undefined
    });

    if (adminPrivate && /^\/start(?:@|\s|$)/i.test(text)) {
      await sendAdminPanel({ env, chatId, userId });
    }

    return { handled: true, sent: false };
  }

  await sendTelegramMessage({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId,
    text: buildPrivatePriceMessage(items),
    replyMarkup:
      chatType === "private" && isTelegramAdmin(userId, env)
        ? buildAdminReplyKeyboard()
        : undefined
  });

  if (chatType === "private" && isTelegramAdmin(userId, env) && /^\/start(?:@|\s|$)/i.test(text)) {
    await sendAdminPanel({ env, chatId, userId });
  }

  console.log(`قیمت‌های فعلی برای کاربر ${chatId} ارسال شد.`);
  return { handled: true, sent: true };
}

export function isAdminPanelText(text) {
  const normalized = String(text ?? "").trim();
  return /^(?:🛠\s*)?پنل مدیریت$/u.test(normalized) || /^\/admin(?:@[a-z0-9_]+)?(?:\s|$)/i.test(normalized);
}

export function buildAdminReplyKeyboard() {
  return {
    keyboard: [[{ text: "🛠 پنل مدیریت" }, { text: "💰 قیمت‌ها" }]],
    resize_keyboard: true,
    is_persistent: true
  };
}

export function buildAdminInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "💰 قیمت‌های فعلی", callback_data: ADMIN_PANEL_CALLBACKS.PRICE },
        { text: "🌐 وضعیت منابع", callback_data: ADMIN_PANEL_CALLBACKS.NERKH_STATUS }
      ],
      [
        { text: "🔑 ثبت / تغییر API Nerkh", callback_data: ADMIN_PANEL_CALLBACKS.SET_NERKH }
      ],
      [
        { text: "🗑 حذف API Nerkh", callback_data: ADMIN_PANEL_CALLBACKS.CLEAR_NERKH_CONFIRM },
        { text: "🔗 وضعیت Webhook", callback_data: ADMIN_PANEL_CALLBACKS.WEBHOOK_STATUS }
      ],
      [
        { text: "🆔 شناسه من", callback_data: ADMIN_PANEL_CALLBACKS.WHOAMI },
        { text: "🔄 تازه‌سازی پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }
      ]
    ]
  };
}

function formatNerkhEndpointSummary(endpoints = []) {
  const labels = {
    currency: "ارز",
    gold: "طلا/سکه",
    crypto: "کریپتو"
  };
  if (!Array.isArray(endpoints) || endpoints.length === 0) return "اطلاعاتی نیست";
  return endpoints
    .map((item) => {
      const label = labels[item?.category] ?? item?.category ?? "API";
      return item?.ok
        ? `${label} ✅ (${item.count ?? 0})`
        : `${label} ❌`;
    })
    .join(" | ");
}

async function inspectNerkhConnection(env, nowMs = Date.now()) {
  const tokenInfo = await resolveNerkhToken(env);
  const runtime = env?.DB ? await readJsonValueByKey(env.DB, NERKH_RUNTIME_KEY) : null;
  const cache = env?.DB ? await readJsonValueByKey(env.DB, NERKH_CACHE_KEY) : null;
  return { tokenInfo, runtime: runtime ?? {}, cache: cache ?? null, nowMs };
}

function formatRemainingTimeFa(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (ms <= 0) return "الان";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(minutes)} دقیقه`;
  if (hours > 0) return `${toPersianDigits(hours)} ساعت`;
  return `${toPersianDigits(minutes)} دقیقه`;
}

function buildNerkhLiveStatusLines(tokenInfo, runtime = {}, cache = null, nowMs = Date.now()) {
  if (!tokenInfo?.token) {
    return [
      "Nerkh Token: <b>⚪ تنظیم نشده</b>",
      "وضعیت Nerkh: <b>⚪ غیرفعال</b>"
    ];
  }

  const origin = tokenInfo.origin === "d1" ? "ذخیره‌شده در ربات" : "Cloudflare Secret";
  const lines = [`Nerkh Token: <b>🔐 موجود (${escapeHtml(origin)})</b>`];
  const state = String(runtime?.state ?? "never");

  if (state === "ok") {
    lines.push(`آخرین اتصال واقعی: <b>✅ موفق${runtime.count ? ` — ${runtime.count}/${SETTINGS.watchedSymbols.length} نماد` : ""}</b>`);
  } else if (state === "quota") {
    lines.push("آخرین اتصال واقعی: <b>⚠️ سهمیه Nerkh پر شده (HTTP 460)</b>");
  } else if (state === "rate-limit") {
    lines.push("آخرین اتصال واقعی: <b>⚠️ محدودیت درخواست Nerkh (HTTP 429)</b>");
  } else if (state === "auth") {
    lines.push("آخرین اتصال واقعی: <b>❌ توکن/دسترسی رد شده</b>");
  } else if (state === "error") {
    lines.push("آخرین اتصال واقعی: <b>❌ خطای موقت منبع</b>");
  } else {
    lines.push("آخرین اتصال واقعی: <b>⚪ هنوز انجام نشده</b>");
  }

  if (Array.isArray(runtime?.endpoints) && runtime.endpoints.length > 0) {
    lines.push(`Endpointها: <b>${escapeHtml(formatNerkhEndpointSummary(runtime.endpoints))}</b>`);
  }
  if (runtime?.error) {
    lines.push(`آخرین خطا: <code>${escapeHtml(runtime.error)}</code>`);
  }
  if (cache?.fetchedAt && Array.isArray(cache?.items)) {
    lines.push(`کش Nerkh: <b>✅ ${cache.items.length} نماد</b>`);
  }
  const nextAllowedAt = Number(runtime?.nextAllowedAt ?? 0);
  if (nextAllowedAt > nowMs) {
    lines.push(`درخواست بعدی Nerkh: <b>حدود ${formatRemainingTimeFa(nextAllowedAt - nowMs)} دیگر</b>`);
  } else {
    lines.push("درخواست بعدی Nerkh: <b>در نوبت Cron بعدی مجاز است</b>");
  }
  lines.push("ℹ️ دکمه وضعیت منابع فقط وضعیت ذخیره‌شده را می‌خواند و سهمیه API مصرف نمی‌کند.");
  return lines;
}

export async function sendAdminPanel({ env, chatId, userId }) {
  const tokenInfo = await resolveNerkhToken(env);
  const providerStatus = await readJsonValueByKey(env.DB, LAST_PROVIDER_STATUS_KEY);
  const tokenText = tokenInfo.token
    ? `🔐 موجود (${tokenInfo.origin === "d1" ? "ذخیره‌شده در ربات" : "Cloudflare Secret"})`
    : "⚪ تنظیم نشده";
  const sourceText = providerStatus?.sourceSummary || "هنوز بررسی نشده";
  const nerkhAttempt = providerStatus?.attempts?.find((item) => item?.provider === "Nerkh.io");
  const nerkhLastText = !nerkhAttempt
    ? "هنوز تست نشده"
    : nerkhAttempt.ok
      ? `✅ موفق (${nerkhAttempt.count ?? 0} نماد)`
      : nerkhAttempt.skipped === "no-token"
        ? "⚪ بدون توکن"
        : nerkhAttempt.skipped === "invalid-token"
          ? "❌ توکن قبلاً نامعتبر تشخیص داده شده"
          : nerkhAttempt.skipped === "quota-backoff"
            ? "⚠️ سهمیه پر است؛ تا نوبت بعدی متوقف"
            : nerkhAttempt.skipped === "rate-limit-backoff"
              ? "⚠️ محدودیت درخواست؛ تا نوبت بعدی متوقف"
              : nerkhAttempt.skipped === "interval"
                ? "⏸ طبق برنامه ۶ ساعته فعلاً Skip"
                : `❌ ${nerkhAttempt.error ?? "ناموفق"}`;

  await sendTelegramMessage({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId,
    text: [
      "🛠 <b>پنل مدیریت ربات</b>",
      "",
      `Nerkh Token: <b>${escapeHtml(tokenText)}</b>`,
      `آخرین تلاش Nerkh: <b>${escapeHtml(nerkhLastText)}</b>`,
      `منبع نهایی آخرین بررسی: <b>${escapeHtml(sourceText)}</b>`,
      `Admin ID: <code>${escapeHtml(String(userId ?? "نامشخص"))}</code>`,
      "",
      "یکی از گزینه‌های زیر را انتخاب کنید:"
    ].join("\n"),
    replyMarkup: buildAdminInlineKeyboard()
  });
}

export async function handleAdminCallbackQuery(callbackQuery, env) {
  const callbackId = callbackQuery?.id;
  const data = String(callbackQuery?.data ?? "");
  const message = callbackQuery?.message;
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = callbackQuery?.from?.id;

  if (!callbackId || !chatId) return { handled: false };

  if (!env?.TELEGRAM_BOT_TOKEN || !env?.DB) {
    throw new Error("تنظیمات Telegram یا D1 ناقص است.");
  }

  if (chatType !== "private" || !isTelegramAdmin(userId, env)) {
    await answerTelegramCallbackQuery({
      botToken: env.TELEGRAM_BOT_TOKEN,
      callbackQueryId: callbackId,
      text: "دسترسی مدیریت ندارید.",
      showAlert: true
    });
    return { handled: true, admin: false };
  }

  await answerTelegramCallbackQuery({
    botToken: env.TELEGRAM_BOT_TOKEN,
    callbackQueryId: callbackId
  });

  if (data !== ADMIN_PANEL_CALLBACKS.SET_NERKH) {
    await clearNerkhTokenPending(env.DB, userId);
  }

  if (data === ADMIN_PANEL_CALLBACKS.MENU) {
    await sendAdminPanel({ env, chatId, userId });
    return { handled: true, admin: true, action: "menu" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.PRICE) {
    const state = await readLatestState(env.DB);
    const items = stateToItems(state, SETTINGS.watchedSymbols);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: items.length ? buildPrivatePriceMessage(items) : "⏳ قیمت‌ها هنوز دریافت نشده‌اند.",
      replyMarkup: buildAdminReplyKeyboard()
    });
    return { handled: true, admin: true, action: "price" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.NERKH_STATUS) {
    const { tokenInfo, runtime, cache, nowMs } = await inspectNerkhConnection(env);
    const providerStatus = await readJsonValueByKey(env.DB, LAST_PROVIDER_STATUS_KEY);
    const sourceText = providerStatus?.sourceSummary || "هنوز بررسی نشده";
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "🌐 <b>وضعیت منابع قیمت</b>",
        "",
        ...buildNerkhLiveStatusLines(tokenInfo, runtime, cache, nowMs),
        `آخرین منبع نهایی ربات: <b>${escapeHtml(sourceText)}</b>`,
        "",
        "Fallback: Nerkh.io ← TGJU ← Navasan/GitHub"
      ].join("\n"),
      replyMarkup: { inline_keyboard: [[{ text: "⬅️ بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
    });
    return { handled: true, admin: true, action: "nerkhstatus" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.SET_NERKH) {
    await markNerkhTokenPending(env.DB, userId);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "🔑 <b>توکن جدید Nerkh را بفرستید.</b>",
        "پیام بعدی شما به‌عنوان API Token خوانده و در صورت امکان فوراً حذف می‌شود.",
        "",
        "برای لغو، دکمه زیر را بزنید."
      ].join("\n"),
      replyMarkup: { inline_keyboard: [[{ text: "❌ لغو و بازگشت", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
    });
    return { handled: true, admin: true, action: "setnerkh" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.CLEAR_NERKH_CONFIRM) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "⚠️ <b>API ذخیره‌شده Nerkh حذف شود؟</b>",
      replyMarkup: {
        inline_keyboard: [[
          { text: "✅ بله، حذف کن", callback_data: ADMIN_PANEL_CALLBACKS.CLEAR_NERKH },
          { text: "❌ خیر", callback_data: ADMIN_PANEL_CALLBACKS.MENU }
        ]]
      }
    });
    return { handled: true, admin: true, action: "clear-confirm" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.CLEAR_NERKH) {
    await deleteValueByKey(env.DB, NERKH_TOKEN_KEY);
    await deleteValueByKey(env.DB, NERKH_INVALID_FINGERPRINT_KEY);
    await deleteValueByKey(env.DB, NERKH_CACHE_KEY);
    await deleteValueByKey(env.DB, NERKH_RUNTIME_KEY);
    await clearNerkhTokenPending(env.DB, userId);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: env.NERKH_API_TOKEN
        ? "🗑 API ذخیره‌شده حذف شد؛ Cloudflare Secret موجود همچنان قابل استفاده است."
        : "🗑 API Nerkh حذف شد. ربات فعلاً از منابع رایگان استفاده می‌کند.",
      replyMarkup: { inline_keyboard: [[{ text: "⬅️ بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
    });
    return { handled: true, admin: true, action: "clearnerkh" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.WEBHOOK_STATUS) {
    try {
      const result = await getTelegramWebhookInfo({ botToken: env.TELEGRAM_BOT_TOKEN });
      const info = result?.result ?? {};
      const isConnected = Boolean(info.url);
      await sendTelegramMessage({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: [
          "🔗 <b>وضعیت Webhook</b>",
          "",
          `وضعیت: <b>${isConnected ? "✅ متصل" : "❌ تنظیم نشده"}</b>`,
          `Pending updates: <b>${Number(info.pending_update_count ?? 0)}</b>`,
          info.last_error_message ? `آخرین خطا: <code>${escapeHtml(info.last_error_message)}</code>` : "آخرین خطا: ندارد"
        ].join("\n"),
        replyMarkup: { inline_keyboard: [[{ text: "⬅️ بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
      });
    } catch (error) {
      await sendTelegramMessage({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: `❌ بررسی Webhook ناموفق بود: <code>${escapeHtml(compactError(error))}</code>`,
        replyMarkup: { inline_keyboard: [[{ text: "⬅️ بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
      });
    }
    return { handled: true, admin: true, action: "webhookstatus" };
  }

  if (data === ADMIN_PANEL_CALLBACKS.WHOAMI) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: `🆔 شناسه ادمین: <code>${escapeHtml(String(userId))}</code>`,
      replyMarkup: { inline_keyboard: [[{ text: "⬅️ بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
    });
    return { handled: true, admin: true, action: "whoami" };
  }

  return { handled: false, admin: true };
}

async function handleAdminUpdate({
  message,
  chatId,
  chatType,
  userId,
  text,
  adminCommand,
  pendingToken,
  env
}) {
  const isPrivate = chatType === "private";

  if (!isPrivate) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "🔐 فرمان‌های مدیریت API فقط در چت خصوصی با ربات قابل استفاده‌اند."
    });
    return { handled: true, admin: false, reason: "not-private" };
  }

  if (!isTelegramAdmin(userId, env)) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "⛔ <b>دسترسی مدیریت ندارید.</b>",
        "برای مشاهده User ID خود /whoami را بفرستید و سپس TELEGRAM_ADMIN_USER_ID را در Cloudflare تنظیم کنید."
      ].join("\n")
    });
    return { handled: true, admin: false, reason: "unauthorized" };
  }

  if (adminCommand?.name === "cancel") {
    await clearNerkhTokenPending(env.DB, userId);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "✅ عملیات ورود API لغو شد."
    });
    return { handled: true, admin: true, command: "cancel" };
  }

  if (adminCommand?.name === "nerkhstatus") {
    const { tokenInfo, runtime, cache, nowMs } = await inspectNerkhConnection(env);
    const providerStatus = await readJsonValueByKey(env.DB, LAST_PROVIDER_STATUS_KEY);
    const sourceText = providerStatus?.sourceSummary || "هنوز بررسی نشده";

    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "🛠 <b>وضعیت منابع قیمت</b>",
        "",
        ...buildNerkhLiveStatusLines(tokenInfo, runtime, cache, nowMs),
        `آخرین منبع نهایی ربات: <b>${escapeHtml(sourceText)}</b>`,
        "",
        "ترتیب Fallback: Nerkh.io ← TGJU ← Navasan/GitHub"
      ].join("\n")
    });
    return { handled: true, admin: true, command: "nerkhstatus" };
  }

  if (adminCommand?.name === "clearnerkh") {
    await deleteValueByKey(env.DB, NERKH_TOKEN_KEY);
    await deleteValueByKey(env.DB, NERKH_INVALID_FINGERPRINT_KEY);
    await deleteValueByKey(env.DB, NERKH_CACHE_KEY);
    await deleteValueByKey(env.DB, NERKH_RUNTIME_KEY);
    await clearNerkhTokenPending(env.DB, userId);

    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: [
        "🗑 API ذخیره‌شده Nerkh از داخل ربات حذف شد.",
        env.NERKH_API_TOKEN
          ? "اگر Cloudflare Secret قدیمی وجود داشته باشد، ربات دوباره از همان استفاده می‌کند."
          : "تا زمان ورود API جدید، ربات از TGJU و Navasan/GitHub استفاده می‌کند."
      ].join("\n")
    });
    return { handled: true, admin: true, command: "clearnerkh" };
  }

  let candidateToken = "";
  if (adminCommand?.name === "setnerkh") {
    candidateToken = cleanSecretValue(adminCommand.argument ?? "");

    if (!candidateToken) {
      await markNerkhTokenPending(env.DB, userId);
      await sendTelegramMessage({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        text: [
          "🔑 <b>توکن جدید Nerkh را بفرستید.</b>",
          "پیام بعدی شما به‌عنوان API Token خوانده می‌شود و ربات تلاش می‌کند همان پیام را فوراً حذف کند.",
          "",
          "برای لغو: /cancel"
        ].join("\n")
      });
      return { handled: true, admin: true, command: "setnerkh-prompt" };
    }
  } else if (pendingToken) {
    candidateToken = cleanSecretValue(text);
  }

  if (!candidateToken) {
    return { handled: true, admin: true };
  }

  // تا حد امکان پیام حاوی توکن را سریع از چت پاک می‌کنیم.
  if (message?.message_id) {
    try {
      await deleteTelegramMessage({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        messageId: message.message_id
      });
    } catch (error) {
      console.warn(`حذف پیام حاوی API ناموفق بود: ${error.message}`);
    }
  }

  if (candidateToken.length < 8) {
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "❌ توکن خیلی کوتاه است و ذخیره نشد. دوباره /setnerkh را بفرستید."
    });
    await clearNerkhTokenPending(env.DB, userId);
    return { handled: true, admin: true, command: "setnerkh-invalid" };
  }

  const validation = await validateNerkhTokenCandidate(candidateToken);
  if (validation.authRejected) {
    await clearNerkhTokenPending(env.DB, userId);
    await sendTelegramMessage({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      text: "❌ Nerkh این توکن را با خطای دسترسی رد کرد؛ توکن ذخیره نشد."
    });
    return { handled: true, admin: true, command: "setnerkh-rejected" };
  }

  const savedAt = Date.now();
  await saveStoredNerkhToken(env, candidateToken);
  await deleteValueByKey(env.DB, NERKH_INVALID_FINGERPRINT_KEY);
  await deleteValueByKey(env.DB, NERKH_CACHE_KEY);

  if (validation.ok && Array.isArray(validation.items) && validation.items.length > 0) {
    await writeJsonValueByKey(env.DB, NERKH_CACHE_KEY, {
      fetchedAt: savedAt,
      items: validation.items
    });
  }

  await writeJsonValueByKey(env.DB, NERKH_RUNTIME_KEY, {
    state: validation.ok
      ? "ok"
      : validation.quotaExceeded
        ? "quota"
        : validation.rateLimited
          ? "rate-limit"
          : "error",
    lastAttemptAt: savedAt,
    lastSuccessAt: validation.ok ? savedAt : 0,
    nextAllowedAt: savedAt + (validation.quotaExceeded || validation.rateLimited
      ? SETTINGS.nerkhQuotaBackoffMs
      : SETTINGS.nerkhRefreshIntervalMs),
    count: validation.count ?? 0,
    endpoints: validation.endpoints ?? [],
    error: validation.error ?? ""
  });
  await clearNerkhTokenPending(env.DB, userId);

  const confirmation = validation.ok
    ? "✅ توکن جدید تست و ذخیره شد. نتیجه تست در D1 کش شد و برای حفظ سهمیه، Nerkh تا نوبت بعدی دوباره فراخوانی نمی‌شود."
    : validation.quotaExceeded
      ? "⚠️ توکن ذخیره شد، اما سهمیه Nerkh فعلاً پر است (HTTP 460 / QUOTA_EXCEEDED). ربات تا نوبت بعدی Nerkh را صدا نمی‌زند و از Fallbackها استفاده می‌کند."
      : validation.rateLimited
        ? "⚠️ توکن ذخیره شد، اما Nerkh فعلاً محدودیت درخواست داده است (HTTP 429). Fallbackها فعال می‌مانند."
        : "✅ توکن ذخیره شد. تست لحظه‌ای به‌دلیل خطای موقت منبع کامل نشد؛ Fallbackهای رایگان همچنان فعال‌اند.";

  await sendTelegramMessage({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId,
    text: confirmation,
    replyMarkup: { inline_keyboard: [[{ text: "🛠 بازگشت به پنل", callback_data: ADMIN_PANEL_CALLBACKS.MENU }]] }
  });

  return { handled: true, admin: true, command: "setnerkh-saved" };
}

export function isPriceCommand(text) {
  const normalized = String(text ?? "").trim();

  if (/^\/(?:start|price|prices)(?:@[a-z0-9_]+)?(?:\s|$)/i.test(normalized)) {
    return true;
  }

  return /^(?:💰\s*)?(?:قیمت|قیمت‌ها|قیمت ها|قیمت‌های فعلی|نرخ)$/.test(normalized);
}

export function isWhoAmICommand(text) {
  return /^\/whoami(?:@[a-z0-9_]+)?(?:\s|$)/i.test(String(text ?? "").trim());
}

export function getAdminCommand(text) {
  const normalized = String(text ?? "").trim();
  const match = normalized.match(
    /^\/(setnerkh|nerkhstatus|clearnerkh|cancel)(?:@[a-z0-9_]+)?(?:\s+([\s\S]+))?$/i
  );
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: match[2] ?? "" };
}

export function isTelegramAdmin(userId, env) {
  const configured = cleanSecretValue(
    env?.TELEGRAM_ADMIN_USER_ID ?? env?.TELEGRAM_OWNER_ID ?? ""
  );
  if (!configured || userId === undefined || userId === null) return false;
  return String(userId) === configured;
}

export async function runPriceCheck(env, nowMs = Date.now()) {
  validateEnvironment(env);

  const latestState = await readLatestState(env.DB);
  const marketResult = await fetchResilientMarketItems(env, latestState, fetch, nowMs);
  const selectedItems = marketResult.items;

  if (selectedItems.length === 0) {
    throw new Error("هیچ قیمت قابل استفاده‌ای از منابع اصلی یا کش D1 پیدا نشد.");
  }

  const missingSymbols = SETTINGS.watchedSymbols.filter(
    (symbol) => !selectedItems.some((item) => item.symbol === symbol)
  );

  if (missingSymbols.length > 0) {
    console.warn(`نمادهای پیدا نشده: ${missingSymbols.join(", ")}`);
  }

  await writeJsonValueByKey(env.DB, LAST_PROVIDER_STATUS_KEY, {
    sourceSummary: marketResult.sourceSummary,
    attempts: marketResult.attempts,
    usedCache: marketResult.usedCache,
    checkedAt: new Date(nowMs).toISOString()
  });

  // آخرین داده دریافت‌شده همیشه ذخیره می‌شود تا /start و /price تازه بمانند.
  const currentState = createCurrentState(selectedItems);
  await writeStateByKey(env.DB, LATEST_STATE_KEY, currentState);

  const previousChannelState = await readChannelState(env.DB);
  const changedItems = detectSignificantChangedItems(
    selectedItems,
    previousChannelState,
    SETTINGS.minimumChangeBySymbol,
    SETTINGS.sendOnFirstRun
  );

  if (changedItems.length === 0) {
    console.log(
      `تغییر قیمت به حد ارسال پیام نرسیده است. منبع: ${marketResult.sourceSummary}`
    );
    return {
      sent: false,
      changedCount: 0,
      reason: "below-threshold",
      source: marketResult.sourceSummary
    };
  }

  const lastSentAt = await readTimestampByKey(env.DB, LAST_CHANNEL_SEND_KEY);
  const remainingMs = getCooldownRemainingMs(
    lastSentAt,
    nowMs,
    SETTINGS.channelMessageCooldownMs
  );

  if (remainingMs > 0) {
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    console.log(
      `${changedItems.length} تغییر مهم ثبت شد؛ به‌دلیل فاصله زمانی، حدود ${remainingMinutes} دقیقه دیگر بررسی می‌شود.`
    );
    return {
      sent: false,
      changedCount: changedItems.length,
      reason: "cooldown",
      remainingMs,
      source: marketResult.sourceSummary
    };
  }

  const changedSymbols = new Set(changedItems.map((item) => item.symbol));
  const message = buildTelegramMessage(
    selectedItems,
    previousChannelState,
    changedSymbols
  );

  await sendTelegramMessage({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    text: message
  });

  // فقط پس از ارسال موفق، مبنای مقایسه و زمان آخرین پیام تغییر می‌کنند.
  await writeStateByKey(env.DB, CHANNEL_STATE_KEY, currentState);
  await writeTimestampByKey(env.DB, LAST_CHANNEL_SEND_KEY, nowMs);

  console.log(
    `${changedItems.length} تغییر مهم ثبت شد؛ فهرست کامل ${selectedItems.length} نماد ارسال شد. منبع: ${marketResult.sourceSummary}`
  );

  return {
    sent: true,
    changedCount: changedItems.length,
    reason: "sent",
    source: marketResult.sourceSummary
  };
}

export function validateEnvironment(env) {
  const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];

  for (const name of required) {
    if (!env?.[name]) {
      throw new Error(`متغیر محرمانه ${name} تنظیم نشده است.`);
    }
  }

  if (!env.DB) {
    throw new Error("اتصال دیتابیس D1 با نام DB تنظیم نشده است.");
  }
}

export async function fetchResilientMarketItems(
  env,
  previousState = {},
  fetchImpl = fetch,
  nowMs = Date.now()
) {
  const itemsBySymbol = new Map();
  const attempts = [];

  const addMissingItems = (items) => {
    for (const item of items ?? []) {
      if (!item?.symbol) continue;
      if (!SETTINGS.watchedSymbols.includes(item.symbol)) continue;

      const existing = itemsBySymbol.get(item.symbol);
      if (!existing) {
        itemsBySymbol.set(item.symbol, item);
        continue;
      }

      // قیمت منبع اول را حفظ می‌کنیم، اما اگر درصد تغییر یا زمان به‌روزرسانی
      // ناقص بود، فقط همان فیلد را از fallback تکمیل می‌کنیم.
      const needsChange =
        existing.change_percent === undefined || existing.change_percent === null;
      const fallbackChange = parseLocalizedNumber(item.change_percent);
      const canFillChange = needsChange && Number.isFinite(fallbackChange);
      const needsUpdate = !String(existing.update ?? "").trim();
      const canFillUpdate = needsUpdate && String(item.update ?? "").trim();

      if (canFillChange || canFillUpdate) {
        itemsBySymbol.set(item.symbol, {
          ...existing,
          change_percent: canFillChange ? fallbackChange : existing.change_percent,
          date: canFillUpdate ? item.date : existing.date,
          time: canFillUpdate ? item.time : existing.time,
          update: canFillUpdate ? item.update : existing.update,
          source: canFillChange
            ? `${existing.source || "Nerkh.io"} + ${item.source || "fallback"} (%)`
            : existing.source
        });
      }
    }
  };

  // Nerkh به‌خاطر سقف ساعتی/ماهانه در هر Cron فراخوانی نمی‌شود.
  // وضعیت runtime در D1 تعیین می‌کند چه زمانی درخواست بعدی مجاز است.
  const tokenInfo = await resolveNerkhToken(env);
  const runtime = (await readJsonValueByKey(env.DB, NERKH_RUNTIME_KEY)) ?? {};
  const nextAllowedAt = Number(runtime?.nextAllowedAt ?? 0);

  if (tokenInfo.token) {
    const fingerprint = await fingerprintSecret(tokenInfo.token);
    const invalidFingerprint = await readRawValueByKey(
      env.DB,
      NERKH_INVALID_FINGERPRINT_KEY
    );

    if (invalidFingerprint && invalidFingerprint === fingerprint) {
      attempts.push({ provider: "Nerkh.io", ok: false, skipped: "invalid-token" });
    } else if (nextAllowedAt > nowMs) {
      const skipReason = runtime?.state === "quota"
        ? "quota-backoff"
        : runtime?.state === "rate-limit"
          ? "rate-limit-backoff"
          : "interval";
      attempts.push({
        provider: "Nerkh.io",
        ok: false,
        skipped: skipReason,
        nextAllowedAt
      });
    } else {
      // زمان تلاش را قبل از درخواست ثبت می‌کنیم تا اجرای هم‌زمان Cron باعث دوباره‌کاری نشود.
      await writeJsonValueByKey(env.DB, NERKH_RUNTIME_KEY, {
        ...runtime,
        state: runtime?.state ?? "waiting",
        lastAttemptAt: nowMs,
        nextAllowedAt: nowMs + SETTINGS.nerkhRefreshIntervalMs
      });

      try {
        const payload = await fetchMarketData(tokenInfo.token, fetchImpl);
        const nerkhItems = selectWatchedItems(payload, SETTINGS.watchedSymbols).map(
          (item) => ({ ...item, source: "Nerkh.io", stale: false })
        );
        addMissingItems(nerkhItems);
        attempts.push({ provider: "Nerkh.io", ok: true, count: nerkhItems.length });

        await writeJsonValueByKey(env.DB, NERKH_CACHE_KEY, {
          fetchedAt: nowMs,
          items: nerkhItems
        });
        await writeJsonValueByKey(env.DB, NERKH_RUNTIME_KEY, {
          state: "ok",
          lastAttemptAt: nowMs,
          lastSuccessAt: nowMs,
          nextAllowedAt: nowMs + SETTINGS.nerkhRefreshIntervalMs,
          count: nerkhItems.length,
          endpoints: payload?._nerkh?.endpoints ?? [],
          error: ""
        });
      } catch (error) {
        const isQuota = error?.providerCode === "quota";
        const isRateLimit = error?.providerCode === "rate-limit";
        const state = error?.providerCode === "auth"
          ? "auth"
          : isQuota
            ? "quota"
            : isRateLimit
              ? "rate-limit"
              : "error";
        const waitMs = isQuota || isRateLimit
          ? SETTINGS.nerkhQuotaBackoffMs
          : SETTINGS.nerkhRefreshIntervalMs;

        attempts.push({
          provider: "Nerkh.io",
          ok: false,
          error: compactError(error),
          code: error?.providerCode ?? "error",
          nextAllowedAt: nowMs + waitMs
        });
        console.warn(`Nerkh ناموفق بود؛ Fallback فعال شد: ${error.message}`);

        await writeJsonValueByKey(env.DB, NERKH_RUNTIME_KEY, {
          state,
          lastAttemptAt: nowMs,
          lastSuccessAt: Number(runtime?.lastSuccessAt ?? 0),
          nextAllowedAt: nowMs + waitMs,
          count: Number(runtime?.count ?? 0),
          endpoints: error?.endpoints ?? runtime?.endpoints ?? [],
          error: compactError(error)
        });

        if (error?.providerCode === "auth") {
          await writeRawValueByKey(env.DB, NERKH_INVALID_FINGERPRINT_KEY, fingerprint);
        }
      }
    }
  } else {
    attempts.push({ provider: "Nerkh.io", ok: false, skipped: "no-token" });
  }

  // TGJU منبع اصلی بین نوبت‌های محدود Nerkh است.
  if (itemsBySymbol.size < SETTINGS.watchedSymbols.length) {
    try {
      const tgjuItems = await fetchTgjuMarketItems(fetchImpl);
      addMissingItems(tgjuItems);
      attempts.push({ provider: "TGJU", ok: true, count: tgjuItems.length });
    } catch (error) {
      attempts.push({ provider: "TGJU", ok: false, error: compactError(error) });
      console.warn(`TGJU ناموفق بود؛ Fallback سوم فعال شد: ${error.message}`);
    }
  }

  // Navasan/GitHub لایه پشتیبان رایگان بعدی است.
  if (itemsBySymbol.size < SETTINGS.watchedSymbols.length) {
    try {
      const navasanItems = await fetchNavasanMirrorItems(fetchImpl);
      addMissingItems(navasanItems);
      attempts.push({
        provider: "Navasan/GitHub",
        ok: true,
        count: navasanItems.length
      });
    } catch (error) {
      attempts.push({
        provider: "Navasan/GitHub",
        ok: false,
        error: compactError(error)
      });
      console.warn(`Navasan/GitHub ناموفق بود: ${error.message}`);
    }
  }

  // کش اختصاصی Nerkh فقط برای نمادهای جاافتاده استفاده می‌شود؛
  // هرگز روی قیمت تازه TGJU/Navasan سوار نمی‌شود.
  if (itemsBySymbol.size < SETTINGS.watchedSymbols.length && tokenInfo.token) {
    const nerkhCache = await readJsonValueByKey(env.DB, NERKH_CACHE_KEY);
    if (Array.isArray(nerkhCache?.items)) {
      for (const item of nerkhCache.items) {
        if (!item?.symbol || itemsBySymbol.has(item.symbol)) continue;
        if (!SETTINGS.watchedSymbols.includes(item.symbol)) continue;
        itemsBySymbol.set(item.symbol, {
          ...item,
          stale: true,
          source: "Nerkh.io / D1 cache"
        });
      }
    }
  }

  // در نهایت آخرین state عمومی D1 را برای نمادهای باقی‌مانده نگه می‌داریم.
  if (itemsBySymbol.size < SETTINGS.watchedSymbols.length) {
    const cachedItems = stateToItems(previousState, SETTINGS.watchedSymbols);
    for (const item of cachedItems) {
      if (itemsBySymbol.has(item.symbol)) continue;
      itemsBySymbol.set(item.symbol, {
        ...item,
        source: item.source?.includes("D1 cache")
          ? item.source
          : item.source
            ? `${item.source} / D1 cache`
            : "D1 cache",
        stale: true
      });
    }
  }

  const items = SETTINGS.watchedSymbols
    .map((symbol) => itemsBySymbol.get(symbol))
    .filter(Boolean);

  if (items.length === 0) {
    const details = attempts
      .map((item) => `${item.provider}: ${item.ok ? "ok" : item.error || item.skipped}`)
      .join(" | ");
    throw new Error(`تمام منابع قیمت ناموفق بودند. ${details}`);
  }

  const sources = [...new Set(items.map((item) => item.source).filter(Boolean))];
  return {
    items,
    attempts,
    sourceSummary: sources.join(" + ") || "نامشخص",
    usedCache: items.some((item) => item.stale)
  };
}

export async function fetchMarketData(apiToken, fetchImpl = fetch) {
  const token = cleanSecretValue(apiToken);
  if (!token) {
    const error = new Error("Nerkh API Token خالی است.");
    error.providerCode = "auth";
    throw error;
  }

  const endpoints = [
    ["currency", SETTINGS.providers.nerkh.currencyUrl],
    ["gold", SETTINGS.providers.nerkh.goldUrl],
    ["crypto", SETTINGS.providers.nerkh.cryptoUrl]
  ];

  const merged = {
    data: {
      message: "Success",
      status: 200,
      currency: {},
      gold: {},
      crypto: {}
    },
    _nerkh: {
      endpoints: []
    }
  };

  const failures = [];
  let successfulEndpoints = 0;

  // عمداً ترتیبی اجرا می‌شود: اگر اولین endpoint سهمیه/احراز را رد کرد،
  // دو درخواست اضافه به endpointهای بعدی نمی‌زنیم.
  for (const [category, url] of endpoints) {
    try {
      const payload = await fetchNerkhEndpoint(url, token, fetchImpl, "GET");
      const prices = extractNerkhPrices(payload);
      merged.data[category] = normalizeNerkhPriceMap(prices);
      successfulEndpoints += 1;
      merged._nerkh.endpoints.push({
        category,
        ok: true,
        count: Object.keys(merged.data[category]).length
      });
    } catch (error) {
      failures.push(error);
      merged._nerkh.endpoints.push({
        category,
        ok: false,
        code: error?.providerCode ?? "error",
        error: compactError(error)
      });

      if (["auth", "quota", "rate-limit"].includes(error?.providerCode)) {
        error.endpoints = merged._nerkh.endpoints;
        throw error;
      }
    }
  }

  if (successfulEndpoints === 0) {
    const authError = failures.find((error) => error?.providerCode === "auth");
    const quotaError = failures.find((error) => error?.providerCode === "quota");
    const rateLimitError = failures.find((error) => error?.providerCode === "rate-limit");
    const chosen = authError ?? quotaError ?? rateLimitError ?? failures[0] ?? new Error("Nerkh API پاسخی نداد.");
    chosen.endpoints = merged._nerkh.endpoints;
    throw chosen;
  }

  return merged;
}

export async function validateNerkhAuthToken(apiToken, fetchImpl = fetch) {
  const token = cleanSecretValue(apiToken);
  if (!token) {
    return { ok: false, authRejected: true, error: "توکن خالی است." };
  }

  try {
    await fetchNerkhEndpoint(
      SETTINGS.providers.nerkh.authValidateUrl,
      token,
      fetchImpl,
      "POST",
      { allowEmptyJson: true }
    );
    return { ok: true, authRejected: false };
  } catch (error) {
    return {
      ok: false,
      authRejected: error?.providerCode === "auth",
      quotaExceeded: error?.providerCode === "quota",
      rateLimited: error?.providerCode === "rate-limit",
      providerCode: error?.providerCode ?? "error",
      error: compactError(error)
    };
  }
}

export async function fetchNerkhEndpoint(
  url,
  apiToken,
  fetchImpl = fetch,
  method = "GET",
  options = {}
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SETTINGS.requestTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${cleanSecretValue(apiToken)}`,
        "user-agent": "telegram-market-price-bot/3.1.2"
      },
      signal: controller.signal
    });

    const bodyText = await response.text();

    if (!response.ok) {
      const error = new Error(
        response.status === 460
          ? `سهمیه Nerkh تمام شده است (HTTP 460 / QUOTA_EXCEEDED): ${bodyText.slice(0, 300)}`
          : response.status === 429
            ? `Nerkh API محدودیت تعداد درخواست داد (HTTP 429): ${bodyText.slice(0, 300)}`
            : `Nerkh API خطای HTTP ${response.status} داد: ${bodyText.slice(0, 300)}`
      );
      if ([401, 402, 403].includes(response.status)) {
        error.providerCode = "auth";
      } else if (response.status === 460) {
        error.providerCode = "quota";
      } else if (response.status === 429) {
        error.providerCode = "rate-limit";
      } else {
        error.providerCode = "http";
      }
      throw error;
    }

    if (!bodyText.trim()) {
      if (options.allowEmptyJson) return {};
      throw new Error("Nerkh API پاسخ خالی برگرداند.");
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      if (options.allowEmptyJson) return { raw: bodyText };
      throw new Error("پاسخ Nerkh API یک JSON معتبر نیست.");
    }

    const apiStatus = Number(payload?.data?.status ?? payload?.status);
    if (Number.isFinite(apiStatus) && apiStatus >= 400) {
      const error = new Error(
        `Nerkh API وضعیت ${apiStatus} برگرداند: ${payload?.data?.message ?? payload?.message ?? "خطای نامشخص"}`
      );
      if ([401, 402, 403].includes(apiStatus)) error.providerCode = "auth";
      else if (apiStatus === 460) error.providerCode = "quota";
      else if (apiStatus === 429) error.providerCode = "rate-limit";
      else error.providerCode = "api";
      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("زمان انتظار برای دریافت پاسخ از Nerkh API تمام شد.");
      timeoutError.providerCode = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractNerkhPrices(payload) {
  const candidates = [
    payload?.data?.prices,
    payload?.prices,
    payload?.data?.data?.prices
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  const data = payload?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inferred = Object.fromEntries(
      Object.entries(data).filter(([, value]) =>
        value && typeof value === "object" && !Array.isArray(value) && value.current !== undefined
      )
    );
    if (Object.keys(inferred).length > 0) return inferred;
  }

  throw new Error("ساختار پاسخ Nerkh API معتبر نیست؛ data.prices پیدا نشد.");
}

export function normalizeNerkhPriceMap(prices) {
  const normalized = {};
  for (const [rawSymbol, rawItem] of Object.entries(prices ?? {})) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const symbol = String(rawSymbol).trim().toUpperCase();
    if (!symbol) continue;

    const current = rawItem.current ?? rawItem.price ?? rawItem.value;
    if (current === undefined || current === null || current === "") continue;

    normalized[symbol] = {
      ...rawItem,
      current: String(current),
      ch_24h_percent:
        rawItem.ch_24h_percent ??
        rawItem.change_24h_percent ??
        rawItem.change_percent ??
        rawItem.change_pct ??
        rawItem.percent ??
        null,
      update:
        rawItem.update ??
        rawItem.updated_at ??
        rawItem.updatedAt ??
        rawItem.timestamp ??
        rawItem.date ??
        ""
    };
  }
  return normalized;
}

export async function fetchTgjuMarketItems(fetchImpl = fetch) {
  const payload = await fetchJsonWithTimeout(
    SETTINGS.providers.tgju.url,
    {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "telegram-market-price-bot/3.0"
      }
    },
    fetchImpl,
    "TGJU"
  );

  return normalizeTgjuPayload(payload, SETTINGS.watchedSymbols);
}

export function normalizeTgjuPayload(payload, watchedSymbols = SETTINGS.watchedSymbols) {
  const current = payload?.current;
  if (!current || typeof current !== "object") {
    throw new Error("ساختار پاسخ TGJU معتبر نیست؛ فیلد current پیدا نشد.");
  }

  return watchedSymbols
    .map((symbol) => {
      const key = TGJU_SYMBOLS[symbol];
      const raw = key ? current[key] : null;
      if (!raw || raw.p === undefined || raw.p === null) return null;

      const rialPrice = parseLocalizedNumber(raw.p);
      if (!Number.isFinite(rialPrice) || rialPrice <= 0) return null;

      const metadata = SYMBOL_METADATA[symbol] ?? {};
      const sourceTime = String(raw.ts ?? raw.t ?? "").trim();
      const [date = "", time = ""] = sourceTime.split(/\s+/, 2);

      return {
        symbol,
        name: metadata.name ?? symbol,
        price: String(rialPrice / 10), // TGJU برای بازار ایران قیمت را به ریال می‌دهد.
        unit: metadata.unit ?? "تومان",
        icon: metadata.icon ?? "▫️",
        change_percent: parseLocalizedNumber(raw.dp),
        date,
        time,
        update: sourceTime,
        source: "TGJU",
        stale: false
      };
    })
    .filter(Boolean);
}

export async function fetchNavasanMirrorItems(fetchImpl = fetch) {
  const [fiatResult, goldResult] = await Promise.allSettled([
    fetchJsonWithTimeout(
      SETTINGS.providers.navasan.fiatUrl,
      { headers: { accept: "application/json", "user-agent": "telegram-market-price-bot/3.0" } },
      fetchImpl,
      "Navasan fiat"
    ),
    fetchJsonWithTimeout(
      SETTINGS.providers.navasan.goldUrl,
      { headers: { accept: "application/json", "user-agent": "telegram-market-price-bot/3.0" } },
      fetchImpl,
      "Navasan gold"
    )
  ]);

  const fiat = fiatResult.status === "fulfilled" ? fiatResult.value : {};
  const gold = goldResult.status === "fulfilled" ? goldResult.value : {};

  if (
    fiatResult.status === "rejected" &&
    goldResult.status === "rejected"
  ) {
    throw new Error(
      `هر دو فایل Navasan/GitHub ناموفق بودند: ${compactError(fiatResult.reason)} | ${compactError(goldResult.reason)}`
    );
  }

  return normalizeNavasanPayload({ fiat, gold }, SETTINGS.watchedSymbols);
}

export function normalizeNavasanPayload(
  payload,
  watchedSymbols = SETTINGS.watchedSymbols
) {
  const groups = { fiat: payload?.fiat ?? {}, gold: payload?.gold ?? {} };

  return watchedSymbols
    .map((symbol) => {
      const mapping = NAVASAN_SYMBOLS[symbol];
      if (!mapping) return null;

      const group = groups[mapping.group] ?? {};
      let raw = null;
      for (const key of mapping.keys) {
        if (group?.[key]?.value !== undefined) {
          raw = group[key];
          break;
        }
      }
      if (!raw) return null;

      const price = parseLocalizedNumber(raw.value);
      if (!Number.isFinite(price) || price <= 0) return null;

      const metadata = SYMBOL_METADATA[symbol] ?? {};
      const update = formatEpochForTehran(raw.date);
      const [date = "", time = ""] = update.split(/\s+/, 2);

      return {
        symbol,
        name: metadata.name ?? symbol,
        price: String(price), // این آینه نرخ‌های بازار ایران را به تومان ذخیره می‌کند.
        unit: metadata.unit ?? "تومان",
        icon: metadata.icon ?? "▫️",
        change_percent: parseLocalizedNumber(raw.change_pct),
        date,
        time,
        update,
        source: "Navasan/GitHub",
        stale: false
      };
    })
    .filter(Boolean);
}

export async function fetchJsonWithTimeout(
  url,
  options = {},
  fetchImpl = fetch,
  providerName = "API"
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SETTINGS.requestTimeoutMs);

  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${providerName} خطای HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${providerName} JSON معتبر برنگرداند.`);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`زمان انتظار برای ${providerName} تمام شد.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function selectWatchedItems(payload, watchedSymbols) {
  const data = payload?.data ?? {};
  const categories = [data.currency, data.gold, data.crypto];
  const itemsBySymbol = new Map();

  for (const category of categories) {
    if (!category || typeof category !== "object") continue;

    for (const [symbol, rawItem] of Object.entries(category)) {
      if (!rawItem || rawItem.current === undefined) continue;

      const metadata = SYMBOL_METADATA[symbol] ?? {};
      const [date = "", time = ""] = String(rawItem.update ?? "").split(/\s+/, 2);

      itemsBySymbol.set(symbol, {
        symbol,
        name: metadata.name ?? symbol,
        price: String(rawItem.current),
        unit: metadata.unit ?? "تومان",
        icon: metadata.icon ?? "▫️",
        change_percent: rawItem.ch_24h_percent,
        date,
        time,
        update: rawItem.update ?? "",
        source: "Nerkh.io",
        stale: false
      });
    }
  }

  return watchedSymbols
    .map((symbol) => itemsBySymbol.get(symbol))
    .filter(Boolean);
}

export function createCurrentState(items) {
  return Object.fromEntries(
    items.map((item) => [
      item.symbol,
      {
        price: String(item.price),
        name: item.name ?? item.symbol,
        unit: item.unit ?? "",
        icon: item.icon ?? "▫️",
        change_percent: item.change_percent,
        date: item.date ?? "",
        time: item.time ?? "",
        update: item.update ?? "",
        source: item.source ?? "",
        stale: Boolean(item.stale)
      }
    ])
  );
}

export function stateToItems(state, watchedSymbols) {
  return watchedSymbols
    .map((symbol) => {
      const saved = state?.[symbol];
      if (!saved?.price) return null;

      const metadata = SYMBOL_METADATA[symbol] ?? {};
      return {
        symbol,
        name: saved.name ?? metadata.name ?? symbol,
        price: String(saved.price),
        unit: saved.unit ?? metadata.unit ?? "تومان",
        icon: saved.icon ?? metadata.icon ?? "▫️",
        change_percent: saved.change_percent,
        date: saved.date ?? "",
        time: saved.time ?? "",
        update: saved.update ?? "",
        source: saved.source ?? "",
        stale: Boolean(saved.stale)
      };
    })
    .filter(Boolean);
}

export function detectChangedItems(items, previousState, sendOnFirstRun = true) {
  return detectSignificantChangedItems(
    items,
    previousState,
    {},
    sendOnFirstRun
  );
}

export function detectSignificantChangedItems(
  items,
  previousState,
  minimumChangeBySymbol = {},
  sendOnFirstRun = true
) {
  const hasPreviousState =
    previousState && Object.keys(previousState).length > 0;

  if (!hasPreviousState) {
    return sendOnFirstRun ? items : [];
  }

  return items.filter((item) => {
    // قیمت کش‌شده قدیمی به‌تنهایی نباید باعث اعلان تازه شود.
    if (item.stale) return false;

    const previous = previousState[item.symbol];
    if (!previous?.price) return true;

    const oldPrice = Number(previous.price);
    const newPrice = Number(item.price);
    const threshold = Number(minimumChangeBySymbol[item.symbol] ?? 0);

    if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) {
      return String(previous.price) !== String(item.price);
    }

    const difference = Math.abs(newPrice - oldPrice);
    return threshold > 0
      ? difference >= threshold
      : difference > 0;
  });
}

export function getCooldownRemainingMs(
  lastSentAt,
  nowMs = Date.now(),
  cooldownMs = SETTINGS.channelMessageCooldownMs
) {
  const timestamp = Number(lastSentAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;

  return Math.max(0, timestamp + cooldownMs - nowMs);
}

export function buildTelegramMessage(
  items,
  previousState = {},
  changedSymbols = null
) {
  const rows = items.map((item) => buildCompactPriceRow(item));
  const updateText = formatMarketTimestamp(findLatestUpdate(items));

  return [
    "📊 <b>آپدیت بازار ارز و طلا</b>",
    updateText ? `🕐 ${escapeHtml(updateText)}` : null,
    "",
    rows.join("\n"),
    "",
    "💰 قیمت‌ها به تومان است.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildPrivatePriceMessage(items) {
  const rows = items.map((item) => buildCompactPriceRow(item));
  const updateText = formatMarketTimestamp(findLatestUpdate(items));

  return [
    "📊 <b>آخرین قیمت‌های بازار ارز و طلا</b>",
    updateText ? `🕐 ${escapeHtml(updateText)}` : null,
    "",
    rows.join("\n"),
    "",
    "💰 قیمت‌ها به تومان است.",
    "",
    "برای دریافت دوباره قیمت‌ها، /price را بفرست."
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildCompactPriceRow(item) {
  const name = escapeHtml(item.name ?? item.symbol);
  const price = escapeHtml(formatNumber(item.price));
  const change =
    item.change_percent === undefined || item.change_percent === null
      ? "⚪ نامشخص"
      : escapeHtml(formatPercent(item.change_percent));
  const stale = item.stale ? "  ⚠️" : "";

  return `${item.icon ?? "▫️"} <b>${name}</b> — <b>${price}</b>  ${change}${stale}`;
}

export function formatMarketTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const normalized = raw
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const match = normalized.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );

  if (!match) {
    return toPersianDigits(raw.replaceAll("-", "/"));
  }

  const [, yearText, monthText, dayText, hourText = "00", minuteText = "00"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  let displayYear = year;
  let displayMonth = month;
  let displayDay = day;

  // Nerkh معمولاً تاریخ شمسی می‌دهد، اما TGJU/Navasan تاریخ میلادی دارند.
  // تاریخ‌های میلادی را برای یکدست‌شدن پیام به شمسی تبدیل می‌کنیم.
  if (year >= 1700) {
    const safeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      timeZone: SETTINGS.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(safeDate);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    displayYear = get("year") || year;
    displayMonth = get("month") || month;
    displayDay = get("day") || day;
  }

  const dateText = `${String(displayYear).padStart(4, "0")}/${String(displayMonth).padStart(2, "0")}/${String(displayDay).padStart(2, "0")}`;
  const timeText = `${String(Number(hourText)).padStart(2, "0")}:${String(Number(minuteText)).padStart(2, "0")}`;
  return `${toPersianDigits(dateText)} — ${toPersianDigits(timeText)}`;
}

export function findLatestUpdate(items) {
  const updates = items
    .filter((item) => !item.stale)
    .map((item) => item.update || [item.date, item.time].filter(Boolean).join(" "))
    .filter(Boolean)
    .sort();

  return updates.at(-1) ?? "";
}

export function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(value);
  }

  const maximumFractionDigits = Number.isInteger(number) ? 0 : 8;
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits
  }).format(number);
}

export function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "نامشخص";
  }

  const formatted = new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(Math.abs(number));

  if (number > 0) return `🟢 +${formatted}٪`;
  if (number < 0) return `🔴 -${formatted}٪`;
  return `⚪ ${formatted}٪`;
}

export function toPersianDigits(value) {
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function parseLocalizedNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;

  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const normalized = String(value)
    .trim()
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/٪/g, "");
  return Number(normalized);
}

export function formatEpochForTehran(epochValue) {
  const epoch = Number(epochValue);
  if (!Number.isFinite(epoch) || epoch <= 0) return "";

  const date = new Date(epoch * 1000);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SETTINGS.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export async function readStateByKey(db, stateKey) {
  const raw = await readRawValueByKey(db, stateKey);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`وضعیت ذخیره‌شده برای ${stateKey} خراب بود و نادیده گرفته شد.`);
    return {};
  }
}

export async function readLatestState(db) {
  const latest = await readStateByKey(db, LATEST_STATE_KEY);
  if (Object.keys(latest).length > 0) return latest;

  const oldLatest = await readStateByKey(db, LEGACY_LATEST_STATE_KEY);
  if (Object.keys(oldLatest).length > 0) return oldLatest;

  const channel = await readStateByKey(db, CHANNEL_STATE_KEY);
  if (Object.keys(channel).length > 0) return channel;

  return readStateByKey(db, LEGACY_STATE_KEY);
}

export async function readChannelState(db) {
  const channel = await readStateByKey(db, CHANNEL_STATE_KEY);
  if (Object.keys(channel).length > 0) return channel;

  return readStateByKey(db, LEGACY_STATE_KEY);
}

export async function writeStateByKey(db, stateKey, state) {
  return writeRawValueByKey(db, stateKey, JSON.stringify(state));
}

// این دو تابع برای سازگاری با تست‌ها یا کدهای قبلی نگه داشته شده‌اند.
export async function readState(db) {
  return readLatestState(db);
}

export async function writeState(db, state) {
  return writeStateByKey(db, LATEST_STATE_KEY, state);
}

export async function readTimestampByKey(db, stateKey) {
  const value = await readRawValueByKey(db, stateKey);
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function writeTimestampByKey(db, stateKey, timestamp) {
  return writeRawValueByKey(db, stateKey, String(timestamp));
}

export async function readRawValueByKey(db, stateKey) {
  const row = await db
    .prepare("SELECT state_value FROM bot_state WHERE state_key = ?")
    .bind(stateKey)
    .first();
  return row?.state_value ? String(row.state_value) : "";
}

export async function writeRawValueByKey(db, stateKey, value) {
  await db
    .prepare(`
      INSERT INTO bot_state (state_key, state_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(stateKey, String(value))
    .run();
}

export async function deleteValueByKey(db, stateKey) {
  await db.prepare("DELETE FROM bot_state WHERE state_key = ?").bind(stateKey).run();
}

export async function writeJsonValueByKey(db, stateKey, value) {
  return writeRawValueByKey(db, stateKey, JSON.stringify(value));
}

export async function readJsonValueByKey(db, stateKey) {
  const raw = await readRawValueByKey(db, stateKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function markNerkhTokenPending(db, userId, nowMs = Date.now()) {
  return writeRawValueByKey(db, `${NERKH_PENDING_PREFIX}${userId}`, String(nowMs));
}

export async function clearNerkhTokenPending(db, userId) {
  return deleteValueByKey(db, `${NERKH_PENDING_PREFIX}${userId}`);
}

export async function isNerkhTokenPending(db, userId, nowMs = Date.now()) {
  const startedAt = Number(
    await readRawValueByKey(db, `${NERKH_PENDING_PREFIX}${userId}`)
  );
  if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
  if (nowMs - startedAt > SETTINGS.nerkhTokenPromptTtlMs) {
    await clearNerkhTokenPending(db, userId);
    return false;
  }
  return true;
}

export async function resolveNerkhToken(env) {
  if (env?.DB) {
    try {
      const stored = await readRawValueByKey(env.DB, NERKH_TOKEN_KEY);
      if (stored) {
        const token = await decryptStoredSecret(
          stored,
          env.TELEGRAM_WEBHOOK_SECRET ?? ""
        );
        if (token) return { token, origin: "d1" };
      }
    } catch (error) {
      console.warn(`خواندن Nerkh Token ذخیره‌شده ناموفق بود: ${error.message}`);
    }
  }

  const envToken = cleanSecretValue(env?.NERKH_API_TOKEN ?? "");
  return { token: envToken, origin: envToken ? "env" : "none" };
}

export async function saveStoredNerkhToken(env, token) {
  if (!env?.DB) throw new Error("D1 برای ذخیره API تنظیم نشده است.");
  if (!env?.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET برای رمزگذاری API لازم است.");
  }
  const encrypted = await encryptSecret(
    cleanSecretValue(token),
    env.TELEGRAM_WEBHOOK_SECRET
  );
  await writeRawValueByKey(env.DB, NERKH_TOKEN_KEY, encrypted);
}

export async function validateNerkhTokenCandidate(token, fetchImpl = fetch) {
  const auth = await validateNerkhAuthToken(token, fetchImpl);
  if (auth.authRejected) {
    return {
      ok: false,
      authRejected: true,
      authOk: false,
      quotaExceeded: false,
      rateLimited: false,
      error: auth.error || "Nerkh توکن را رد کرد."
    };
  }

  // اگر خود endpoint اعتبارسنجی گفته سهمیه/Rate limit پر است، درخواست دیگری نمی‌زنیم.
  if (auth.quotaExceeded || auth.rateLimited) {
    return {
      ok: false,
      authRejected: false,
      authOk: false,
      quotaExceeded: Boolean(auth.quotaExceeded),
      rateLimited: Boolean(auth.rateLimited),
      error: auth.error || "سهمیه Nerkh فعلاً اجازه تست قیمت نمی‌دهد."
    };
  }

  try {
    const payload = await fetchMarketData(token, fetchImpl);
    const items = selectWatchedItems(payload, SETTINGS.watchedSymbols).map(
      (item) => ({ ...item, source: "Nerkh.io", stale: false })
    );
    const endpointStatus = payload?._nerkh?.endpoints ?? [];
    return {
      ok: items.length > 0,
      authRejected: false,
      authOk: auth.ok,
      authWarning: auth.ok ? "" : auth.error ?? "",
      quotaExceeded: false,
      rateLimited: false,
      count: items.length,
      symbols: items.map((item) => item.symbol),
      endpoints: endpointStatus,
      items,
      error: items.length > 0 ? "" : "Nerkh پاسخ معتبر داد اما هیچ‌کدام از نمادهای موردنیاز ربات پیدا نشد."
    };
  } catch (error) {
    return {
      ok: false,
      authRejected: error?.providerCode === "auth",
      authOk: auth.ok,
      authWarning: auth.ok ? "" : auth.error ?? "",
      quotaExceeded: error?.providerCode === "quota",
      rateLimited: error?.providerCode === "rate-limit",
      endpoints: error?.endpoints ?? [],
      error: compactError(error)
    };
  }
}

export async function fingerprintSecret(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

export async function encryptSecret(value, keyMaterial) {
  const key = await deriveAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(String(value))
  );
  return `enc:v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptStoredSecret(storedValue, keyMaterial) {
  const raw = String(storedValue ?? "");
  if (!raw) return "";

  // سازگاری احتمالی با نسخه‌ای که توکن را plain ذخیره کرده باشد.
  if (!raw.startsWith("enc:v1:")) return cleanSecretValue(raw);
  if (!keyMaterial) return "";

  const [, , ivB64, cipherB64] = raw.split(":");
  if (!ivB64 || !cipherB64) return "";

  try {
    const key = await deriveAesKey(keyMaterial);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivB64) },
      key,
      base64ToBytes(cipherB64)
    );
    return cleanSecretValue(new TextDecoder().decode(clear));
  } catch {
    return "";
  }
}

async function deriveAesKey(keyMaterial) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(keyMaterial))
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cleanSecretValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function compactError(error) {
  return String(error?.message ?? error ?? "unknown error").slice(0, 300);
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  replyMarkup,
  fetchImpl = fetch
}) {
  const cleanBotToken = cleanSecretValue(botToken);
  const cleanChatId = cleanSecretValue(chatId);
  const url = `https://api.telegram.org/bot${cleanBotToken}/sendMessage`;
  const payload = {
    chat_id: cleanChatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true }
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const body = JSON.stringify(payload);

  let lastError = null;

  // خطاهای شبکه‌ای موقت در اجرای محلی Wrangler یا اینترنت کاربر ممکن است رخ دهند.
  // دو بار تلاش می‌کنیم و در صورت شکست، خطای مشخص Telegram ثبت می‌شود.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SETTINGS.requestTimeoutMs
    );

    try {
      console.log(`Telegram sendMessage: attempt ${attempt}/2`);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body,
        signal: controller.signal
      });

      const responseText = await response.text();
      let result;

      try {
        result = JSON.parse(responseText);
      } catch {
        result = null;
      }

      if (!response.ok || !result?.ok) {
        const description =
          result?.description || responseText.slice(0, 500) || "پاسخ خالی";
        throw new Error(
          `Telegram sendMessage HTTP ${response.status}: ${description}`
        );
      }

      console.log("Telegram sendMessage: OK");
      return result;
    } catch (error) {
      lastError = error;
      const message =
        error?.name === "AbortError"
          ? "Telegram API request timed out"
          : compactError(error);
      console.warn(`Telegram sendMessage attempt ${attempt}/2 failed: ${message}`);

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(
    `Telegram API network/send failure after 2 attempts: ${compactError(lastError)}`
  );
}

export async function answerTelegramCallbackQuery({
  botToken,
  callbackQueryId,
  text = "",
  showAlert = false,
  fetchImpl = fetch
}) {
  const token = cleanSecretValue(botToken);
  const response = await fetchImpl(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        callback_query_id: String(callbackQueryId),
        ...(text ? { text } : {}),
        show_alert: Boolean(showAlert)
      })
    }
  );
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram answerCallbackQuery failed: ${result?.description ?? response.status}`);
  }
  return result;
}

export async function deleteTelegramMessage({
  botToken,
  chatId,
  messageId,
  fetchImpl = fetch
}) {
  const cleanBotToken = cleanSecretValue(botToken);
  const response = await fetchImpl(
    `https://api.telegram.org/bot${cleanBotToken}/deleteMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`deleteMessage HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}
