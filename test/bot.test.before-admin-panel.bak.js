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

const watched = ["USD", "EUR", "USDT", "GOLD18K", "SEKE_EMAMI"];

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

  assert.match(message, /به‌روزرسانی قیمت بازار/);
  assert.match(message, /دلار/);
  assert.match(message, /تغییر ۲۴ ساعت/);
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
  assert.match(message, /سکه امامی/);
  assert.equal((message.match(/قیمت قبلی/g) ?? []).length, 1);
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
  fetchResilientMarketItems
} from "../src/index.js";

test("خروجی TGJU از ریال به تومان و به نمادهای داخلی تبدیل می‌شود", () => {
  const payload = {
    current: {
      price_dollar_rl: { p: "1,895,000", dp: "0.5", ts: "2026-08-23 13:00:00" },
      price_eur: { p: "2,200,000", dp: -0.2, ts: "2026-08-23 13:00:00" },
      "crypto-tether-irr": { p: "1,890,000", dp: "۰٫۳", ts: "2026-08-23 13:00:00" },
      geram18: { p: "198,000,000", dp: 1.1, ts: "2026-08-23 13:00:00" },
      sekee: { p: "1,950,000,000", dp: 0.9, ts: "2026-08-23 13:00:00" }
    }
  };

  const items = normalizeTgjuPayload(payload, watched);
  assert.deepEqual(items.map((item) => item.symbol), watched);
  assert.equal(items[0].price, "189500");
  assert.equal(items[2].price, "189000");
  assert.equal(items[3].price, "19800000");
  assert.equal(items[4].price, "195000000");
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

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test("وقتی Nerkh Token نداریم، TGJU به‌تنهایی هر پنج نماد را پر می‌کند", async () => {
  const calls = [];
  const tgjuPayload = {
    current: {
      price_dollar_rl: { p: "1,900,000", dp: 0, ts: "2026-08-23 14:00:00" },
      price_eur: { p: "2,200,000", dp: 0, ts: "2026-08-23 14:00:00" },
      "crypto-tether-irr": { p: "1,895,000", dp: 0, ts: "2026-08-23 14:00:00" },
      geram18: { p: "200,000,000", dp: 0, ts: "2026-08-23 14:00:00" },
      sekee: { p: "1,950,000,000", dp: 0, ts: "2026-08-23 14:00:00" }
    }
  };

  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(tgjuPayload);
  };

  const result = await fetchResilientMarketItems({ DB: makeEmptyDb() }, {}, fetchImpl);
  assert.equal(result.items.length, 5);
  assert.equal(result.sourceSummary, "TGJU");
  assert.equal(calls.length, 1);
});

test("اگر TGJU هم قطع باشد، Navasan چهار نماد و D1 تتر را نگه می‌دارد", async () => {
  const previousState = {
    USDT: {
      price: "189000",
      name: "تتر",
      unit: "تومان",
      icon: "🪙",
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

  assert.equal(result.items.length, 5);
  const usdt = result.items.find((item) => item.symbol === "USDT");
  assert.equal(usdt.price, "189000");
  assert.equal(usdt.stale, true);
  assert.match(usdt.source, /D1 cache/);
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
