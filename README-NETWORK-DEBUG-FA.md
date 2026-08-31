# عیب‌یابی خطای Network connection lost

در نسخه 3.0.1 خطاهای Telegram داخل Cron دیگر به صورت Uncaught رها نمی‌شوند.
هنگام ارسال پیام، لاگ‌های زیر دیده می‌شوند:

- `Telegram sendMessage: attempt 1/2`
- `Telegram sendMessage: OK` در حالت موفق
- یا `Telegram sendMessage attempt ... failed: ...` در حالت شکست
- در نهایت `Cron price check failed: ...` اگر ارسال پس از دو تلاش ناموفق باشد.

اگر TGJU یا Navasan خراب شوند، همانند قبل خطا گرفته می‌شود و Fallback ادامه می‌یابد.

برای تست:
1. `RUN-WINDOWS.cmd` را باز نگه دارید.
2. `RUN-CRON-LOCAL.cmd` را اجرا کنید.
3. لاگ پنجره Worker را بررسی کنید.

اگر خطا مشخصاً Telegram بود، در PowerShell دسترسی مستقیم را با `getMe` تست کنید. توکن را در چت یا فایل عمومی منتشر نکنید.
