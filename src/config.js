export const SETTINGS = Object.freeze({
  // ترتیب منابع: اول Nerkh، سپس TGJU و در پایان آینه رایگان Navasan روی GitHub.
  providers: Object.freeze({
    nerkh: Object.freeze({
      label: "Nerkh.io",
      authValidateUrl: "https://api.nerkh.io/v1/auth/validate",
      currencyUrl: "https://api.nerkh.io/v1/prices/json/currency",
      goldUrl: "https://api.nerkh.io/v1/prices/json/gold",
      cryptoUrl: "https://api.nerkh.io/v1/prices/json/crypto"
    }),
    tgju: Object.freeze({
      label: "TGJU",
      url: "https://call2.tgju.org/ajax.json"
    }),
    navasan: Object.freeze({
      label: "Navasan/GitHub",
      fiatUrl:
        "https://raw.githubusercontent.com/HosseinOdd/Navasan-API/refs/heads/main/data/fiat.json",
      goldUrl:
        "https://raw.githubusercontent.com/HosseinOdd/Navasan-API/refs/heads/main/data/gold.json"
    })
  }),

  // برای سازگاری با کد قبلی.
  apiUrl: "https://api.nerkh.io/v1/prices/json/currency",

  // ترتیب این آرایه، ترتیب نمایش قیمت‌ها در پیام تلگرام است.
  watchedSymbols: Object.freeze([
    "USD",
    "EUR",
    "USDT",
    "GOLD18K",
    "SILVER999",
    "SEKE_EMAMI"
  ]),

  timeZone: "Asia/Tehran",
  sourceLabel: "Nerkh.io → TGJU → Navasan/GitHub",
  sendOnFirstRun: true,

  // حداقل فاصله میان دو پیام کانال: ۵ دقیقه
  channelMessageCooldownMs: 5 * 60 * 1000,

  // حداقل تغییر لازم نسبت به آخرین قیمت ارسال‌شده در کانال.
  // مقدار صفر یعنی هر تغییر واقعی باعث آماده‌شدن پیام می‌شود.
  minimumChangeBySymbol: Object.freeze({
    USD: 0,
    EUR: 0,
    USDT: 100,
    GOLD18K: 0,
    SILVER999: 0,
    SEKE_EMAMI: 0
  }),

  requestTimeoutMs: 15000,

  // پلن فعلی کاربر سقف ماهانه محدودی دارد. هر دریافت کامل Nerkh سه درخواست
  // (ارز + طلا + کریپتو) مصرف می‌کند؛ هر ۶ ساعت ≈ ۳۶۰ درخواست در ۳۰ روز.
  nerkhRefreshIntervalMs: 6 * 60 * 60 * 1000,

  // روی 460/429 تا نوبت بعدی Nerkh صبر می‌کنیم و هر دقیقه Retry نمی‌زنیم.
  nerkhQuotaBackoffMs: 6 * 60 * 60 * 1000,

  nerkhTokenPromptTtlMs: 10 * 60 * 1000
});

export const TGJU_SYMBOLS = Object.freeze({
  USD: "price_dollar_rl",
  EUR: "price_eur",
  USDT: "crypto-tether-irr",
  GOLD18K: "geram18",
  SILVER999: "silver_999",
  SEKE_EMAMI: "sekee"
});

export const NAVASAN_SYMBOLS = Object.freeze({
  USD: Object.freeze({ group: "fiat", keys: Object.freeze(["usd"]) }),
  EUR: Object.freeze({ group: "fiat", keys: Object.freeze(["eur"]) }),
  // مخزن فعلی USDT ندارد؛ aliasها برای سازگاری با اضافه‌شدن احتمالی آینده هستند.
  USDT: Object.freeze({
    group: "fiat",
    keys: Object.freeze(["usdt", "tether", "usdt_irr"])
  }),
  GOLD18K: Object.freeze({ group: "gold", keys: Object.freeze(["18ayar"]) }),
  SEKE_EMAMI: Object.freeze({ group: "gold", keys: Object.freeze(["sekkeh"]) })
});

// مشخصات نمایشی نمادهای داخلی ربات.
export const SYMBOL_METADATA = Object.freeze({
  USD: Object.freeze({ name: "دلار", unit: "تومان", icon: "💵" }),
  EUR: Object.freeze({ name: "یورو", unit: "تومان", icon: "💶" }),
  AED: Object.freeze({ name: "درهم امارات", unit: "تومان", icon: "💴" }),
  GBP: Object.freeze({ name: "پوند انگلیس", unit: "تومان", icon: "💷" }),
  TRY: Object.freeze({ name: "لیر ترکیه", unit: "تومان", icon: "💸" }),
  USDT: Object.freeze({ name: "تتر", unit: "تومان", icon: "🪙" }),
  BTC: Object.freeze({ name: "بیت‌کوین", unit: "تومان", icon: "₿" }),
  ETH: Object.freeze({ name: "اتریوم", unit: "تومان", icon: "◆" }),
  GOLD18K: Object.freeze({ name: "طلای ۱۸ عیار", unit: "تومان", icon: "🥇" }),
  SILVER999: Object.freeze({ name: "نقره ۹۹۹", unit: "تومان", icon: "🥈" }),
  GOLD24K: Object.freeze({ name: "طلای ۲۴ عیار", unit: "تومان", icon: "✨" }),
  MAZANEH: Object.freeze({ name: "مظنه طلا", unit: "تومان", icon: "🔥" }),
  SEKE_EMAMI: Object.freeze({ name: "سکه امامی", unit: "تومان", icon: "🟡" }),
  SEKE_BAHAR: Object.freeze({ name: "سکه بهار آزادی", unit: "تومان", icon: "🟠" }),
  SEKE_NIM: Object.freeze({ name: "نیم سکه", unit: "تومان", icon: "🟨" }),
  SEKE_ROB: Object.freeze({ name: "ربع سکه", unit: "تومان", icon: "🟤" }),
  SEKE_1G: Object.freeze({ name: "سکه گرمی", unit: "تومان", icon: "🟫" })
});
