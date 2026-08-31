# پنل مدیریت تلگرامی v3.2.0

این Patch روی نسخه فعلی پروژه اعمال می‌شود و `wrangler.jsonc` را دست نمی‌زند؛ بنابراین `database_id` واقعی D1 شما حفظ می‌شود.

## امکانات پنل

پس از Deploy، ادمین در چت خصوصی ربات یک بار `/start` را می‌فرستد. سپس یک کیبورد دائمی پایین تلگرام ظاهر می‌شود:

- 🛠 پنل مدیریت
- 💰 قیمت‌ها

داخل پنل مدیریت دکمه‌های زیر وجود دارد:

- 💰 قیمت‌های فعلی
- 🌐 وضعیت منابع
- 🔑 ثبت / تغییر API Nerkh
- 🗑 حذف API Nerkh (با تایید)
- 🔗 وضعیت Webhook
- 🆔 شناسه من
- 🔄 تازه‌سازی پنل

همه عملیات مدیریت فقط برای `TELEGRAM_ADMIN_USER_ID` و فقط در چت خصوصی فعال‌اند.

## نصب Patch روی ویندوز

1. `APPLY-ADMIN-PANEL-WINDOWS.cmd` و پوشه `patch-files` را داخل پوشه فعلی پروژه کپی کنید.
2. `APPLY-ADMIN-PANEL-WINDOWS.cmd` را اجرا کنید.
3. بعد Deploy کنید:

```powershell
npx wrangler deploy
```

## مهم: Webhook را یک بار دوباره ثبت کنید

این نسخه برای دکمه‌ها به `callback_query` نیاز دارد. پس بعد از Deploy، با همان متغیرهای قبلی PowerShell:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$WORKER/admin/setup-webhook" `
  -Headers @{ Authorization = "Bearer $ADMIN" }
```

این کار `allowed_updates` را به `message` و `callback_query` به‌روزرسانی می‌کند.

## استفاده

بعد از موفقیت Webhook، داخل چت خصوصی ربات فقط یک بار بفرستید:

```text
/start
```

از آن به بعد با دکمه‌های پایین چت و پنل Inline کار می‌کنید و نیازی به حفظ کامندها نیست.
