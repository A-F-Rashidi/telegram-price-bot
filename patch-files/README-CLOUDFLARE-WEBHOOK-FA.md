# تنظیم Webhook از داخل Cloudflare (بدون نیاز به دسترسی ویندوز به api.telegram.org)

این نسخه دو endpoint مدیریتی امن دارد:

- `POST /admin/setup-webhook` برای اجرای `setWebhook` از شبکه Cloudflare
- `GET /admin/webhook-status` برای اجرای `getWebhookInfo` از شبکه Cloudflare

## Secret لازم

یک Secret جدید و جداگانه تعریف کنید:

```powershell
npx wrangler secret put WEBHOOK_SETUP_SECRET
```

یک رشته بلند و تصادفی وارد کنید. این مقدار را در URL قرار ندهید و برای کسی ارسال نکنید.

همچنین `TELEGRAM_BOT_TOKEN` و `TELEGRAM_WEBHOOK_SECRET` باید روی Worker واقعی تنظیم شده باشند.

## Deploy

```powershell
npx wrangler deploy
```

## تنظیم Webhook از طریق Worker

```powershell
$WORKER="https://telegram-price-bot-multisource.amirvpnshop2026.workers.dev"
$ADMIN="مقدار WEBHOOK_SETUP_SECRET خودتان"

Invoke-RestMethod `
  -Method Post `
  -Uri "$WORKER/admin/setup-webhook" `
  -Headers @{ Authorization = "Bearer $ADMIN" }
```

خروجی موفق نمونه:

```json
{
  "ok": true,
  "description": "Webhook was set",
  "webhookUrl": "https://...workers.dev/telegram-webhook"
}
```

## بررسی وضعیت Webhook

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$WORKER/admin/webhook-status" `
  -Headers @{ Authorization = "Bearer $ADMIN" }
```

این درخواست از ویندوز فقط به Worker کلادفلر وصل می‌شود؛ ارتباط با `api.telegram.org` را خود Cloudflare انجام می‌دهد.
