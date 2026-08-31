# اجرای ربات روی Windows

این نسخه برای اجرای محلی Cloudflare Worker روی Windows آماده شده است.

## پیش‌نیاز

- Windows 11 برای Wrangler رسمی Cloudflare توصیه/پشتیبانی می‌شود.
- Node.js LTS نصب باشد.

## سریع‌ترین روش

1. ZIP را Extract کنید.
2. روی `SETUP-WINDOWS.cmd` دوبار کلیک کنید.
3. بعد از پایان Setup، فایل `.dev.vars` را با Notepad باز کنید و مقادیر واقعی خودتان را وارد کنید:

```text
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_CHAT_ID="..."
TELEGRAM_WEBHOOK_SECRET="..."
TELEGRAM_ADMIN_USER_ID="..."
NERKH_API_TOKEN=""
```

`NERKH_API_TOKEN` اختیاری است. بدون آن هم TGJU و Navasan/GitHub فعال‌اند. بعداً Token جدید Nerkh را می‌توانید از چت خصوصی ربات با `/setnerkh` وارد کنید.

4. `RUN-WINDOWS.cmd` را اجرا کنید.
5. مرورگر را باز کنید:

```text
http://localhost:8787/health
```

## اجرای دستی Cron در حالت Local

در حالی که `RUN-WINDOWS.cmd` باز است، روی `RUN-CRON-LOCAL.cmd` دوبار کلیک کنید.

این کار handler زمان‌بندی‌شده را فوراً اجرا می‌کند و در صورت وجود تغییر لازم، ربات می‌تواند به تلگرام پیام بفرستد.

## تست‌ها

روی `TEST-WINDOWS.cmd` دوبار کلیک کنید یا در PowerShell اجرا کنید:

```powershell
npm test
```

## نکته مهم درباره Telegram Webhook در Local

آدرس `localhost` از اینترنت و سرورهای Telegram قابل دسترسی نیست. بنابراین Webhook واقعی Telegram در اجرای محلی مستقیماً به کامپیوتر شما نمی‌رسد. برای تست قیمت/ارسال زمان‌بندی‌شده، `RUN-CRON-LOCAL.cmd` کافی است. فرمان‌های `/setnerkh` و `/whoami` را پس از Deploy عمومی Worker استفاده کنید، یا برای تست Local یک tunnel عمومی جداگانه بسازید.

## Deploy روی Cloudflare

فایل `wrangler.jsonc` عمداً برای D1 محلی یک UUID placeholder دارد. **قبل از Deploy واقعی** باید D1 واقعی Cloudflare خودتان را متصل کنید.

اگر دیتابیس موجود دارید، از Dashboard یا `wrangler d1 list` شناسه آن را بگیرید و مقدار `database_id` را در `wrangler.jsonc` جایگزین کنید.

اگر دیتابیس ندارید:

```powershell
npx wrangler login
npx wrangler d1 create telegram-price-bot-db
```

Cloudflare یک `database_id` واقعی می‌دهد. آن را داخل `wrangler.jsonc` قرار دهید، سپس schema را روی دیتابیس Remote اجرا کنید:

```powershell
npx wrangler d1 execute telegram-price-bot-db --remote --file=./schema.sql
```

Secretها را برای نسخه Production تنظیم کنید:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_USER_ID
```

Nerkh اختیاری است:

```powershell
npx wrangler secret put NERKH_API_TOKEN
```

سپس:

```powershell
npm run deploy
```

Cron در `wrangler.jsonc` روی هر یک دقیقه تنظیم شده است.

## فایل‌های مهم

- `src/index.js` منطق Worker و Telegram
- `src/config.js` منابع و تنظیمات قیمت
- `schema.sql` جدول D1
- `.dev.vars` Secretهای Local (نباید برای کسی ارسال شود)
- `wrangler.jsonc` تنظیمات Worker
- `SETUP-WINDOWS.cmd` نصب و آماده‌سازی Local
- `RUN-WINDOWS.cmd` اجرای Local
- `RUN-CRON-LOCAL.cmd` اجرای دستی Cron Local
- `TEST-WINDOWS.cmd` اجرای تست‌ها
