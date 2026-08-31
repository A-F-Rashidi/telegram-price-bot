import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrivatePriceMessage,
  buildTelegramMessage,
  createCurrentState,
  detectChangedItems,
  detectSignificantChangedItems,
  getCooldownRemainingMs,
  isPriceCommand,
  selectWatchedItems,
  stateToItems
} from "../src/index.js";

const sample = {
  data: {
    message: "Success",
    status: 200,
    gold: {
      GOLD18K: {
        current: "18041000",
        ch_24h_percent: -4.17,
        update: "1405-05-04 02:45:09"
      },
      SILVER999: {
        current: "386500",
        ch_24h_percent: 0.54,
        update: "1405-05-04 02:45:09"
      },
      SEKE_EMAMI: {
        current: "181600000",
        ch_24h_percent: -3.92,
        update: "1405-05-04 02:45:09"
      }
    },
    currency: {
      USD: {
        current: "189700",
        ch_24h_percent: -1.77,
        update: "1405-05-04 02:45:10"
      },
      EUR: {
        current: "216190",
        ch_24h_percent: -2.03,
        update: "1405-05-04 02:45:10"
      }
    },
    crypto: {
      USDT: {
        current: "186877",
        ch_24h_percent: -2.67,
        update: "1405-05-04 02:45:10"
      }
    }
  }
};

const watched = ["USD", "EUR", "USDT", "GOLD18K", "SILVER999", "SEKE_EMAMI"];

test("نمادهای Nerkh با ترتیب تنظیم‌شده انتخاب می‌شوند", () => {
  const result = selectWatchedItems(sample, ["USD", "USDT", "GOLD18K"]);
  assert.deepEqual(result.map((item) => item.symbol), ["USD", "USDT", "GOLD18K"]);
});

test("در اجرای اول همه نمادها تغییرکرده محسوب می‌شوند", () => {
  const items = selectWatchedItems(sample, ["USD", "GOLD18K"]);
  assert.equal(detectChangedItems(items, {}, true).length, 2);
});

test("فقط قیمت واقعاً تغییرکرده انتخاب می‌شود", () => {
  const items = selectWatchedItems(sample, ["USD", "GOLD18K"]);
  const previous = createCurrentState(items);
  items[0] = { ...items[0], price: "190000" };

  const changed = detectChangedItems(items, previous, true);
  assert.deepEqual(changed.map((item) => item.symbol), ["USD"]);
});

test("پیام کانال همه اطلاعات اصلی را دارد", () => {
  const items = selectWatchedItems(sample, ["USD"]);
  const message = buildTelegramMessage(items, {});

  assert.match(message, /آپدیت بازار ارز و طلا/);
  assert.match(message, /دلار/);
  assert.match(message, /🟢|🔴|⚪/);
  assert.match(message, /قیمت‌ها به تومان است/);
  assert.match(message, /۱۴۰۵\/۰۵\/۰۴ — ۰۲:۴۵/);
  assert.doesNotMatch(message, /زمان ارسال ربات/);
  assert.doesNotMatch(message, /منبع داده/);
});

test("با تغییر یک نماد، فهرست کامل نمادها نمایش داده می‌شود", () => {
  const items = selectWatchedItems(sample, watched);
  const previous = createCurrentState(items);
  const changedItems = items.map((item) =>
    item.symbol === "USDT"
      ? { ...item, price: String(Number(item.price) + 1) }
      : item
  );

  const message = buildTelegramMessage(
    changedItems,
    previous,
    new Set(["USDT"])
  );

  assert.match(message, /دلار/);
  assert.match(message, /یورو/);
  assert.match(message, /تتر/);
  assert.match(message, /طلای ۱۸ عیار/);
  assert.match(message, /نقره ۹۹۹/);
  assert.match(message, /سکه امامی/);
  assert.equal((message.match(/قیمت قبلی/g) ?? []).length, 0);
});

test("دستورهای شروع و قیمت تشخیص داده می‌شوند", () => {
  assert.equal(isPriceCommand("/start"), true);
  assert.equal(isPriceCommand("/start payload"), true);
  assert.equal(isPriceCommand("/price"), true);
  assert.equal(isPriceCommand("قیمت"), true);
  assert.equal(isPriceCommand("سلام"), false);
});

test("قیمت‌های ذخیره‌شده دوباره به ترتیب اصلی تبدیل می‌شوند", () => {
  const items = selectWatchedItems(sample, watched);
  const state = createCurrentState(items);
  const restored = stateToItems(state, watched);

  assert.deepEqual(restored.map((item) => item.symbol), watched);
  assert.equal(restored[0].change_percent, -1.77);
});

test("پیام خصوصی استارت همه قیمت‌ها را نمایش می‌دهد", () => {
  const items = selectWatchedItems(sample, watched);
  const message = buildPrivatePriceMessage(items);

  assert.match(message, /آخرین قیمت‌های بازار/);
  assert.match(message, /دلار/);
  assert.match(message, /یورو/);
  assert.match(message, /تتر/);
  assert.match(message, /طلای ۱۸ عیار/);
  assert.match(message, /نقره ۹۹۹/);
  assert.match(message, /سکه امامی/);
  assert.match(message, /\/price/);
});


test("تغییر تتر کمتر از ۱۰۰ تومان باعث ارسال نمی‌شود", () => {
  const items = selectWatchedItems(sample, ["USDT"]);
  const previous = createCurrentState(items);
  const updated = [{ ...items[0], price: String(Number(items[0].price) + 99) }];

  const changed = detectSignificantChangedItems(
    updated,
    previous,
    { USDT: 100 },
    true
  );

  assert.equal(changed.length, 0);
});

test("تغییر تتر از ۱۰۰ تومان به بالا باعث ارسال می‌شود", () => {
  const items = selectWatchedItems(sample, ["USDT"]);
  const previous = createCurrentState(items);
  const updated = [{ ...items[0], price: String(Number(items[0].price) + 100) }];

  const changed = detectSignificantChangedItems(
    updated,
    previous,
    { USDT: 100 },
    true
  );

  assert.deepEqual(changed.map((item) => item.symbol), ["USDT"]);
});

test("برای دلار حتی تغییر یک تومان مهم محسوب می‌شود", () => {
  const items = selectWatchedItems(sample, ["USD"]);
  const previous = createCurrentState(items);
  const updated = [{ ...items[0], price: String(Number(items[0].price) + 1) }];

  const changed = detectSignificantChangedItems(
    updated,
    previous,
    { USD: 0 },
    true
  );

  assert.deepEqual(changed.map((item) => item.symbol), ["USD"]);
});

test("فاصله پنج دقیقه‌ای میان پیام‌های کانال رعایت می‌شود", () => {
  const now = 1_000_000;
  const cooldown = 5 * 60 * 1000;

  assert.equal(getCooldownRemainingMs(now - 2 * 60 * 1000, now, cooldown), 3 * 60 * 1000);
  assert.equal(getCooldownRemainingMs(now - 5 * 60 * 1000, now, cooldown), 0);
  assert.equal(getCooldownRemainingMs(0, now, cooldown), 0);
});

import {
  cleanSecretValue,
  decryptStoredSecret,
  encryptSecret,
  getAdminCommand,
  isTelegramAdmin,
  isWhoAmICommand,
  normalizeNavasanPayload,
  normalizeTgjuPayload,
  parseLocalizedNumber,
  fetchResilientMarketItems,
  fetchMarketData,
  fetchNerkhEndpoint,
  validateNerkhTokenCandidate,
  formatMarketTimestamp
} from "../src/index.js";


test("تاریخ میلادی منبع برای نمایش به شمسی تبدیل می‌شود", () => {
  assert.equal(
    formatMarketTimestamp("2026-08-29 16:06:20"),
    "۱۴۰۵/۰۶/۰۷ — ۱۶:۰۶"
  );
});

test("خروجی TGJU از ریال به تومان و به نمادهای داخلی تبدیل می‌شود", () => {
  const payload = {
    current: {
      price_dollar_rl: { p: "1,895,000", dp: "0.5", ts: "2026-08-23 13:00:00" },
      price_eur: { p: "2,200,000", dp: -0.2, ts: "2026-08-23 13:00:00" },
      "crypto-tether-irr": { p: "1,890,000", dp: "۰٫۳", ts: "2026-08-23 13:00:00" },
      geram18: { p: "198,000,000", dp: 1.1, ts: "2026-08-23 13:00:00" },
      silver_999: { p: "4,665,000", dp: 0.54, ts: "2026-08-23 13:00:00" },
      sekee: { p: "1,950,000,000", dp: 0.9, ts: "2026-08-23 13:00:00" }
    }
  };

  const items = normalizeTgjuPayload(payload, watched);
  assert.deepEqual(items.map((item) => item.symbol), watched);
  assert.equal(items[0].price, "189500");
  assert.equal(items[2].price, "189000");
  assert.equal(items[3].price, "19800000");
  assert.equal(items[4].price, "466500");
  assert.equal(items[5].price, "195000000");
  assert.equal(items[0].source, "TGJU");
});

test("خروجی آینه Navasan برای ارز، طلا و سکه نرمال می‌شود", () => {
  const payload = {
    fiat: {
      usd: { value: 197400, change_pct: 0.3, date: 1787471354 },
      eur: { value: 230710, change_pct: -0.1, date: 1787471354 }
    },
    gold: {
      "18ayar": { value: 21630730, change_pct: 0.4, date: 1787471414 },
      sekkeh: { value: 216000000, change_pct: 0.2, date: 1787471414 }
    }
  };

  const items = normalizeNavasanPayload(payload, watched);
  assert.deepEqual(items.map((item) => item.symbol), [
    "USD",
    "EUR",
    "GOLD18K",
    "SEKE_EMAMI"
  ]);
  assert.equal(items[0].price, "197400");
  assert.equal(items[2].price, "21630730");
  assert.equal(items[0].source, "Navasan/GitHub");
});

test("تبدیل اعداد فارسی و جداکننده‌ها درست است", () => {
  assert.equal(parseLocalizedNumber("۱٬۸۹۵٬۰۰۰"), 1895000);
  assert.equal(parseLocalizedNumber("۰٫۳۵"), 0.35);
  assert.equal(parseLocalizedNumber("1,234.5"), 1234.5);
});

test("فرمان‌های مدیریت Nerkh تشخیص داده می‌شوند", () => {
  assert.deepEqual(getAdminCommand("/setnerkh abc123456"), {
    name: "setnerkh",
    argument: "abc123456"
  });
  assert.equal(getAdminCommand("/nerkhstatus").name, "nerkhstatus");
  assert.equal(getAdminCommand("/clearnerkh").name, "clearnerkh");
  assert.equal(getAdminCommand("/price"), null);
  assert.equal(isWhoAmICommand("/whoami"), true);
});

test("فقط Telegram User ID تنظیم‌شده ادمین است", () => {
  const env = { TELEGRAM_ADMIN_USER_ID: "12345" };
  assert.equal(isTelegramAdmin(12345, env), true);
  assert.equal(isTelegramAdmin(99999, env), false);
  assert.equal(isTelegramAdmin(12345, {}), false);
});

test("توکن قبل از ذخیره تمیز می‌شود", () => {
  assert.equal(cleanSecretValue('  "secret-token"  '), "secret-token");
});

test("توکن Nerkh برای D1 رمزگذاری و دوباره باز می‌شود", async () => {
  const encrypted = await encryptSecret("my-nerkh-token-123", "webhook-secret");
  assert.match(encrypted, /^enc:v1:/);
  assert.doesNotMatch(encrypted, /my-nerkh-token-123/);
  const decrypted = await decryptStoredSecret(encrypted, "webhook-secret");
  assert.equal(decrypted, "my-nerkh-token-123");
});


function makeEmptyDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() { return null; },
            async run() { return { success: true }; }
          };
        }
      };
    }
  };
}


function makeMemoryDb(initial = {}) {
  const store = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    _store: store,
    prepare(sql) {
      const normalized = String(sql).trim().toUpperCase();
      return {
        bind(...args) {
          return {
            async first() {
              if (!normalized.startsWith("SELECT")) return null;
              const value = store.get(String(args[0]));
              return value === undefined ? null : { state_value: value };
            },
            async run() {
              if (normalized.startsWith("INSERT")) {
                store.set(String(args[0]), String(args[1]));
              } else if (normalized.startsWith("DELETE")) {
                store.delete(String(args[0]));
              }
              return { success: true };
            }
          };
        }
      };
    }
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test("وقتی Nerkh Token نداریم، TGJU به‌تنهایی هر شش نماد را پر می‌کند", async () => {
  const calls = [];
  const tgjuPayload = {
    current: {
      price_dollar_rl: { p: "1,900,000", dp: 0, ts: "2026-08-23 14:00:00" },
      price_eur: { p: "2,200,000", dp: 0, ts: "2026-08-23 14:00:00" },
      "crypto-tether-irr": { p: "1,895,000", dp: 0, ts: "2026-08-23 14:00:00" },
      geram18: { p: "200,000,000", dp: 0, ts: "2026-08-23 14:00:00" },
      silver_999: { p: "4,660,000", dp: 0, ts: "2026-08-23 14:00:00" },
      sekee: { p: "1,950,000,000", dp: 0, ts: "2026-08-23 14:00:00" }
    }
  };

  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(tgjuPayload);
  };

  const result = await fetchResilientMarketItems({ DB: makeEmptyDb() }, {}, fetchImpl);
  assert.equal(result.items.length, 6);
  assert.equal(result.sourceSummary, "TGJU");
  assert.equal(calls.length, 1);
});

test("اگر TGJU قطع باشد، Navasan و مقادیر D1 نمادهای بدون fallback را نگه می‌دارند", async () => {
  const previousState = {
    USDT: {
      price: "189000",
      name: "تتر",
      unit: "تومان",
      icon: "🪙",
      change_percent: 0,
      update: "2026-08-23 13:00:00",
      source: "TGJU"
    },
    SILVER999: {
      price: "466000",
      name: "نقره ۹۹۹",
      unit: "تومان",
      icon: "🥈",
      change_percent: 0,
      update: "2026-08-23 13:00:00",
      source: "TGJU"
    }
  };

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("call2.tgju.org")) {
      return jsonResponse({ error: true }, 503);
    }
    if (target.endsWith("fiat.json")) {
      return jsonResponse({
        usd: { value: 197400, change_pct: 0, date: 1787471354 },
        eur: { value: 230710, change_pct: 0, date: 1787471354 }
      });
    }
    if (target.endsWith("gold.json")) {
      return jsonResponse({
        "18ayar": { value: 21630730, change_pct: 0, date: 1787471414 },
        sekkeh: { value: 216000000, change_pct: 0, date: 1787471414 }
      });
    }
    throw new Error(`unexpected URL: ${target}`);
  };

  const result = await fetchResilientMarketItems(
    { DB: makeEmptyDb() },
    previousState,
    fetchImpl
  );

  assert.equal(result.items.length, 6);
  const usdt = result.items.find((item) => item.symbol === "USDT");
  const silver = result.items.find((item) => item.symbol === "SILVER999");
  assert.equal(usdt.price, "189000");
  assert.equal(usdt.stale, true);
  assert.match(usdt.source, /D1 cache/);
  assert.equal(silver.price, "466000");
  assert.equal(silver.stale, true);
  assert.match(silver.source, /D1 cache/);
  assert.match(result.sourceSummary, /Navasan\/GitHub/);
});

import {
  handleWebhookSetupRequest,
  handleWebhookStatusRequest,
  setTelegramWebhook
} from "../src/index.js";

test("مسیر setup webhook بدون secret مدیریتی رد می‌شود", async () => {
  const request = new Request("https://example.workers.dev/admin/setup-webhook", {
    method: "POST"
  });
  const response = await handleWebhookSetupRequest(request, {
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret"
  }, async () => { throw new Error("نباید fetch اجرا شود"); });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test("setup webhook از origin خود Worker آدرس webhook را می‌سازد", async () => {
  let capturedUrl = "";
  let capturedBody = null;
  const fakeFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, result: true, description: "Webhook was set" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const request = new Request("https://bot.example.workers.dev/admin/setup-webhook", {
    method: "POST",
    headers: { Authorization: "Bearer admin-secret" }
  });
  const response = await handleWebhookSetupRequest(request, {
    WEBHOOK_SETUP_SECRET: "admin-secret",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret"
  }, fakeFetch);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.webhookUrl, "https://bot.example.workers.dev/telegram-webhook");
  assert.match(capturedUrl, /\/bot123:abc\/setWebhook$/);
  assert.equal(capturedBody.url, "https://bot.example.workers.dev/telegram-webhook");
  assert.equal(capturedBody.secret_token, "telegram-secret");
  assert.equal(capturedBody.drop_pending_updates, true);
});

test("webhook status با secret درست از Telegram خوانده می‌شود", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    ok: true,
    result: { url: "https://bot.example.workers.dev/telegram-webhook", pending_update_count: 0 }
  }), { status: 200, headers: { "content-type": "application/json" } });

  const request = new Request("https://bot.example.workers.dev/admin/webhook-status", {
    headers: { "x-webhook-setup-secret": "admin-secret" }
  });
  const response = await handleWebhookStatusRequest(request, {
    WEBHOOK_SETUP_SECRET: "admin-secret",
    TELEGRAM_BOT_TOKEN: "123:abc"
  }, fakeFetch);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.webhook.pending_update_count, 0);
});


import {
  buildAdminInlineKeyboard,
  buildAdminReplyKeyboard,
  isAdminPanelText
} from "../src/index.js";

test("متن دکمه پنل مدیریت بدون حفظ کامند تشخیص داده می‌شود", () => {
  assert.equal(isAdminPanelText("🛠 پنل مدیریت"), true);
  assert.equal(isAdminPanelText("پنل مدیریت"), true);
  assert.equal(isAdminPanelText("/admin"), true);
  assert.equal(isAdminPanelText("سلام"), false);
});

test("کیبورد دائمی ادمین دکمه پنل و قیمت‌ها را دارد", () => {
  const keyboard = buildAdminReplyKeyboard();
  assert.equal(keyboard.is_persistent, true);
  assert.equal(keyboard.keyboard[0][0].text, "🛠 پنل مدیریت");
  assert.equal(keyboard.keyboard[0][1].text, "💰 قیمت‌ها");
});

test("پنل Inline عملیات اصلی مدیریت را بدون کامند ارائه می‌کند", () => {
  const keyboard = buildAdminInlineKeyboard();
  const buttons = keyboard.inline_keyboard.flat();
  const labels = buttons.map((button) => button.text).join(" | ");
  const callbacks = buttons.map((button) => button.callback_data);
  assert.match(labels, /قیمت‌های فعلی/);
  assert.match(labels, /وضعیت منابع/);
  assert.match(labels, /ثبت \/ تغییر API Nerkh/);
  assert.match(labels, /حذف API Nerkh/);
  assert.match(labels, /وضعیت Webhook/);
  assert.ok(callbacks.includes("admin:setnerkh"));
  assert.ok(callbacks.includes("admin:webhookstatus"));
});

test("دکمه قیمت‌ها مثل دستور قیمت شناخته می‌شود", () => {
  assert.equal(isPriceCommand("💰 قیمت‌ها"), true);
});


test("Nerkh v1 از سه endpoint رسمی ارز، طلا و کریپتو خوانده و ادغام می‌شود", async () => {
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? "GET", auth: options.headers?.authorization });

    let payload;
    if (String(url).endsWith("/currency")) {
      payload = {
        data: {
          status: 200,
          prices: {
            USD: { current: "206010", ch_24h_percent: 2.7, update: "1405-06-08 14:00:00" },
            EUR: { current: "238790", ch_24h_percent: 2.18, update: "1405-06-08 14:00:00" }
          }
        }
      };
    } else if (String(url).endsWith("/gold")) {
      payload = {
        data: {
          status: 200,
          prices: {
            GOLD18K: { current: "21839600", ch_24h_percent: 0.87, update: "1405-06-08 14:00:00" },
            SEKE_EMAMI: { current: "218010000", ch_24h_percent: 0, update: "1405-06-08 14:00:00" }
          }
        }
      };
    } else if (String(url).endsWith("/crypto")) {
      payload = {
        data: {
          status: 200,
          prices: {
            USDT: { current: "205045", ch_24h_percent: 0.13, update: "1405-06-08 14:00:00" }
          }
        }
      };
    } else {
      throw new Error(`unexpected URL ${url}`);
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload)
    };
  };

  const payload = await fetchMarketData("test-token-123", mockFetch);
  const items = selectWatchedItems(payload, watched);

  assert.deepEqual(items.map((item) => item.symbol), [
    "USD",
    "EUR",
    "USDT",
    "GOLD18K",
    "SEKE_EMAMI"
  ]);
  assert.equal(payload.data.currency.USD.current, "206010");
  assert.equal(payload.data.gold.GOLD18K.current, "21839600");
  assert.equal(payload.data.crypto.USDT.current, "205045");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.auth === "Bearer test-token-123"));
  assert.ok(calls.some((call) => call.url.endsWith("/v1/prices/json/currency")));
  assert.ok(calls.some((call) => call.url.endsWith("/v1/prices/json/gold")));
  assert.ok(calls.some((call) => call.url.endsWith("/v1/prices/json/crypto")));
});

test("اعتبارسنجی Nerkh ابتدا POST /v1/auth/validate را استفاده می‌کند", async () => {
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, method: options.method ?? "GET" });

    if (value.endsWith("/v1/auth/validate")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { status: 200, message: "valid" } })
      };
    }

    const group = value.endsWith("/currency")
      ? { USD: { current: "206010", update: "1405-06-08 14:00:00" } }
      : value.endsWith("/gold")
        ? { GOLD18K: { current: "21839600", update: "1405-06-08 14:00:00" } }
        : { USDT: { current: "205045", update: "1405-06-08 14:00:00" } };

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { status: 200, prices: group } })
    };
  };

  const result = await validateNerkhTokenCandidate("valid-token", mockFetch);
  assert.equal(result.ok, true);
  assert.equal(result.authOk, true);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/v1/auth/validate"));
});

test("توکن ردشده Nerkh به‌عنوان authRejected گزارش می‌شود", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: "Unauthorized" })
  });

  const result = await validateNerkhTokenCandidate("bad-token", mockFetch);
  assert.equal(result.ok, false);
  assert.equal(result.authRejected, true);
  assert.match(result.error, /401/);
});


test("HTTP 460 در Nerkh به‌عنوان اتمام سهمیه شناخته می‌شود، نه توکن نامعتبر", async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 460,
      text: async () => JSON.stringify({
        code: "QUOTA_EXCEEDED",
        message: "Your request quota has been exhausted."
      })
    };
  };

  await assert.rejects(
    () => fetchNerkhEndpoint("https://api.nerkh.io/v1/prices/json/currency", "token", mockFetch),
    (error) => {
      assert.equal(error.providerCode, "quota");
      assert.match(error.message, /460|QUOTA_EXCEEDED/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("اگر validate با 460 جواب دهد، تست توکن درخواست اضافه به قیمت‌ها نمی‌زند", async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(String(url));
    return {
      ok: false,
      status: 460,
      text: async () => JSON.stringify({ code: "QUOTA_EXCEEDED" })
    };
  };

  const result = await validateNerkhTokenCandidate("quota-token", mockFetch);
  assert.equal(result.ok, false);
  assert.equal(result.authRejected, false);
  assert.equal(result.quotaExceeded, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/v1/auth/validate"));
});

test("fetchMarketData بعد از اولین 460 دو endpoint بعدی را صدا نمی‌زند", async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(String(url));
    return {
      ok: false,
      status: 460,
      text: async () => JSON.stringify({ code: "QUOTA_EXCEEDED" })
    };
  };

  await assert.rejects(
    () => fetchMarketData("quota-token", mockFetch),
    (error) => error?.providerCode === "quota"
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/currency"));
});

test("Nerkh حداکثر هر ۶ ساعت یک بار خوانده می‌شود و بین آن TGJU کار می‌کند", async () => {
  const db = makeMemoryDb();
  const env = { DB: db, NERKH_API_TOKEN: "valid-token" };
  const calls = [];
  const tgjuPayload = {
    current: {
      price_dollar_rl: { p: "2,060,100", dp: 0, ts: "2026-08-30 14:00:00" },
      price_eur: { p: "2,387,900", dp: 0, ts: "2026-08-30 14:00:00" },
      "crypto-tether-irr": { p: "2,050,450", dp: 0, ts: "2026-08-30 14:00:00" },
      geram18: { p: "218,396,000", dp: 0, ts: "2026-08-30 14:00:00" },
      silver_999: { p: "4,626,800", dp: 0, ts: "2026-08-30 14:00:00" },
      sekee: { p: "2,180,100,000", dp: 0, ts: "2026-08-30 14:00:00" }
    }
  };

  const mockFetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("call2.tgju.org")) return jsonResponse(tgjuPayload);
    if (target.endsWith("/currency")) {
      return jsonResponse({ data: { status: 200, prices: {
        USD: { current: "206010", update: "1405-06-08 14:00:00" },
        EUR: { current: "238790", update: "1405-06-08 14:00:00" }
      } } });
    }
    if (target.endsWith("/gold")) {
      return jsonResponse({ data: { status: 200, prices: {
        GOLD18K: { current: "21839600", update: "1405-06-08 14:00:00" },
        SILVER999: { current: "462680", update: "1405-06-08 14:00:00" },
        SEKE_EMAMI: { current: "218010000", update: "1405-06-08 14:00:00" }
      } } });
    }
    if (target.endsWith("/crypto")) {
      return jsonResponse({ data: { status: 200, prices: {
        USDT: { current: "205045", update: "1405-06-08 14:00:00" }
      } } });
    }
    throw new Error(`unexpected URL: ${target}`);
  };

  const t0 = 1_000_000;
  const first = await fetchResilientMarketItems(env, {}, mockFetch, t0);
  assert.equal(first.items.length, 6);
  assert.equal(calls.filter((url) => url.includes("api.nerkh.io")).length, 3);
  assert.equal(calls.filter((url) => url.includes("call2.tgju.org")).length, 0);

  calls.length = 0;
  const second = await fetchResilientMarketItems(env, {}, mockFetch, t0 + 60 * 60 * 1000);
  assert.equal(second.items.length, 6);
  assert.equal(calls.filter((url) => url.includes("api.nerkh.io")).length, 0);
  assert.equal(calls.filter((url) => url.includes("call2.tgju.org")).length, 1);
  assert.equal(second.attempts[0].skipped, "interval");

  calls.length = 0;
  const third = await fetchResilientMarketItems(env, {}, mockFetch, t0 + 6 * 60 * 60 * 1000 + 1);
  assert.equal(third.items.length, 6);
  assert.equal(calls.filter((url) => url.includes("api.nerkh.io")).length, 3);
});

test("بعد از 460، Cronهای بعدی Nerkh را دوباره نمی‌زنند و مستقیم fallback می‌روند", async () => {
  const db = makeMemoryDb();
  const env = { DB: db, NERKH_API_TOKEN: "quota-token" };
  const calls = [];
  const tgjuPayload = {
    current: {
      price_dollar_rl: { p: "2,060,100", dp: 0, ts: "2026-08-30 14:00:00" },
      price_eur: { p: "2,387,900", dp: 0, ts: "2026-08-30 14:00:00" },
      "crypto-tether-irr": { p: "2,050,450", dp: 0, ts: "2026-08-30 14:00:00" },
      geram18: { p: "218,396,000", dp: 0, ts: "2026-08-30 14:00:00" },
      silver_999: { p: "4,626,800", dp: 0, ts: "2026-08-30 14:00:00" },
      sekee: { p: "2,180,100,000", dp: 0, ts: "2026-08-30 14:00:00" }
    }
  };
  const mockFetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("api.nerkh.io")) {
      return {
        ok: false,
        status: 460,
        text: async () => JSON.stringify({ code: "QUOTA_EXCEEDED" })
      };
    }
    if (target.includes("call2.tgju.org")) return jsonResponse(tgjuPayload);
    throw new Error(`unexpected URL: ${target}`);
  };

  const t0 = 2_000_000;
  const first = await fetchResilientMarketItems(env, {}, mockFetch, t0);
  assert.equal(first.items.length, 6);
  assert.equal(calls.filter((url) => url.includes("api.nerkh.io")).length, 1);
  assert.equal(calls.filter((url) => url.includes("call2.tgju.org")).length, 1);
  assert.equal(first.attempts[0].code, "quota");

  calls.length = 0;
  const second = await fetchResilientMarketItems(env, {}, mockFetch, t0 + 60 * 1000);
  assert.equal(second.items.length, 6);
  assert.equal(calls.filter((url) => url.includes("api.nerkh.io")).length, 0);
  assert.equal(calls.filter((url) => url.includes("call2.tgju.org")).length, 1);
  assert.equal(second.attempts[0].skipped, "quota-backoff");
});
