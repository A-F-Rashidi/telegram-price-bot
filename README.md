# Telegram Currency, Gold & Coin Price Bot

A Telegram bot for displaying currency, gold, silver and coin prices using **Cloudflare Workers**, **Cloudflare D1**, and multiple price sources with automatic fallback support.

## Features

- USD, EUR and USDT prices
- 18K gold price
- 999 silver price
- Emami coin price
- Price change percentages
- Automatic Telegram channel updates
- `/price` command
- Telegram admin panel
- Telegram Webhook support
- 24/7 Cloudflare Workers deployment
- Cloudflare D1 state storage
- Price sources: Nerkh.io, TGJU and Navasan/GitHub
- Nerkh quota protection with caching and cooldown
- Automatic fallback when a source fails

## Example Output

```text
📊 Market Price Update
🕐 1405/06/08 — 14:00

💵 USD — 206,010  🟢 +2.7%
💶 EUR — 238,790  🟢 +2.18%
🪙 USDT — 205,091  🟢 +1.4%
🥇 18K Gold — 21,845,500  🟢 +0.87%
🥈 Silver 999 — 462,680  ⚪ 0%
🟡 Emami Coin — 217,000,000  ⚪ 0%

💰 Prices are shown in Iranian Toman.
```

## Requirements

- Node.js
- npm
- Cloudflare account
- Telegram bot created with BotFather
- Wrangler CLI
- Telegram channel or group

## Installation

```bash
git clone https://github.com/YOUR-USERNAME/telegram-price-bot.git
cd telegram-price-bot
npm install
```

## Environment Variables

Create `.dev.vars` in the project root:

```env
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
TELEGRAM_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
TELEGRAM_WEBHOOK_SECRET="YOUR_RANDOM_WEBHOOK_SECRET"
TELEGRAM_ADMIN_USER_ID="YOUR_TELEGRAM_NUMERIC_USER_ID"
NERKH_API_TOKEN=""
```

> Never commit `.dev.vars` to GitHub.

## Cloudflare Login

```bash
npx wrangler login --device
npx wrangler whoami
```

## Create D1 Database

```bash
npx wrangler d1 create telegram-price-bot-db
```

Add the returned database ID to `wrangler.jsonc`:

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "telegram-price-bot-db",
      "database_id": "YOUR_DATABASE_ID"
    }
  ]
}
```

Apply the schema:

```bash
npx wrangler d1 execute DB --remote --file=./schema.sql
```

## Configure Secrets

```bash
npx wrangler secret bulk .dev.vars
npx wrangler secret put WEBHOOK_SETUP_SECRET
```

## Deploy

```bash
npx wrangler deploy
```

Your Worker URL will look like:

```text
https://telegram-price-bot-multisource.YOUR-SUBDOMAIN.workers.dev
```

Health endpoint:

```text
https://YOUR-WORKER.workers.dev/health
```

## Configure Telegram Webhook

PowerShell:

```powershell
$WORKER="https://YOUR-WORKER.workers.dev"
$ADMIN="YOUR_WEBHOOK_SETUP_SECRET"

Invoke-RestMethod `
  -Method Post `
  -Uri "$WORKER/admin/setup-webhook" `
  -Headers @{ Authorization = "Bearer $ADMIN" }
```

Check webhook status:

```powershell
Invoke-RestMethod `
  -Uri "$WORKER/admin/webhook-status" `
  -Headers @{ Authorization = "Bearer $ADMIN" } |
  ConvertTo-Json -Depth 6
```

## Cron

Example:

```json
{
  "triggers": {
    "crons": ["* * * * *"]
  }
}
```

The Worker can run every minute, while Nerkh requests are rate-controlled with caching and cooldown.

## Price Sources

### Nerkh.io

Main endpoints:

```text
/v1/prices/json/currency
/v1/prices/json/gold
/v1/prices/json/crypto
```

When `QUOTA_EXCEEDED` is returned, the bot enters cooldown and uses fallback sources.

### TGJU

Used as a fallback or completion source.

### Navasan / GitHub

Additional fallback sources to keep the bot operational.

## Local Development on Windows

```bash
npx wrangler dev
```

Or use:

```text
RUN-WINDOWS.cmd
RUN-CRON-LOCAL.cmd
```

Local URL:

```text
http://127.0.0.1:8787
```

## Tests

```bash
npm test
```

## Security

Never commit:

```text
.dev.vars
.env
.env.*
.wrangler/
node_modules/
database-backup.sql
*.log
```

Recommended `.gitignore`:

```gitignore
node_modules/
.wrangler/
.dev.vars
.env
.env.*
*.log
database-backup.sql
```

If a token or secret is accidentally published, revoke or rotate it immediately.

## Recommended Structure

```text
telegram-price-bot/
├── src/
├── test/
├── README.md
├── README-FA.md
├── CHANGELOG.md
├── LICENSE
├── .gitignore
├── package.json
├── package-lock.json
├── schema.sql
├── wrangler.jsonc
├── SETUP-WINDOWS.cmd
├── RUN-WINDOWS.cmd
├── RUN-CRON-LOCAL.cmd
└── TEST-WINDOWS.cmd
```

## Migrating to Another Cloudflare Account

```bash
npx wrangler logout
npx wrangler login --device
npx wrangler d1 create telegram-price-bot-db
```

Update `database_id`, apply the schema, upload secrets and deploy again.

> Disable the old Worker's Cron Trigger to avoid duplicate Telegram messages.

## License

This project is distributed under the terms of the `LICENSE` file.

## Contributing

Pull requests, issues and improvement suggestions are welcome.
