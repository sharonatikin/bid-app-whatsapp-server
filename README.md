# WhatsApp Classifieds Bot

A seller chats with your WhatsApp number, sends photos, a price and a description, and the bot
publishes an ad on your website.

```
Seller (WhatsApp) ──► Meta Cloud API ──► POST /webhook ──► conversation flow ──► SQLite + /uploads
                                                                                   │
Buyer (browser)  ◄── public/index.html ◄── GET /api/ads ◄─────────────────────────┘
                         └─ "Chat with seller" → wa.me link
```

## Conversation

```
User:  hi
Bot:   Hi! I can help you sell something. [Sell something]
User:  sell
Bot:   Send up to 5 photos, then type "done"
User:  [photo] [photo] done
Bot:   What is the item?
User:  iPhone 12 128GB, blue
Bot:   Expected price?         -> 28000 / 28k / ₹28,000
Bot:   Short description?
Bot:   Summary  [Publish] [Cancel]
Bot:   Your ad #1 is live!
```
Other commands: `my ads`, `sold 1`, `remove 1`, `cancel`.

## Run locally (no WhatsApp account needed)

```bash
npm install
cp .env.example .env        # leave WA_ACCESS_TOKEN empty = dry-run mode
npm start                   # http://localhost:3000
npm run simulate            # in another terminal: plays a full seller chat
```
In dry-run mode the bot's replies are printed in the server console.

## Connect real WhatsApp

1. Create an app at developers.facebook.com, add the **WhatsApp** product and get a phone number.
2. Fill `.env`: `WA_ACCESS_TOKEN` (use a permanent System User token), `WA_PHONE_NUMBER_ID`,
   `WA_VERIFY_TOKEN` (any string), `WA_APP_SECRET`, `PUBLIC_BASE_URL`.
3. Deploy somewhere with HTTPS (Render, Railway, Fly.io, a VPS + Caddy/nginx). For local testing use `ngrok http 3000`.
4. In Meta dashboard > WhatsApp > Configuration set the webhook URL to `https://YOUR_HOST/webhook`
   with your verify token, and subscribe to the **messages** field.

## Files

| Path | Purpose |
|---|---|
| `src/server.js` | Express app: webhook (verify + signature check + dedupe), public API, admin endpoint |
| `src/flow.js` | Conversation state machine, per-user message queue |
| `src/whatsapp.js` | Send text/buttons, download media from Meta |
| `src/db.js` | SQLite tables: sessions, ads, processed_messages |
| `public/index.html` | The ad listing page (search, photo thumbnails, WhatsApp contact button) |
| `scripts/simulate.js` | Fake webhook calls to test the whole flow |

## Moderation

- `AUTO_PUBLISH=false` makes new ads `pending` until approved:
  `curl -X PATCH $HOST/api/admin/ads/ID/status -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" -d '{"status":"published"}'`
- Use the same call with `"hidden"` to take an ad down.

## Before going to production

- **Privacy:** the seller's phone number is exposed through the `wa.me` link. The bot tells sellers
  this before publishing. If you prefer, route buyers to your own number instead.
- **WhatsApp 24-hour window:** free-form replies are only allowed within 24h of the user's last
  message. This flow is fully user-driven, so it fits, but proactive messages need approved templates.
- **Images:** stored on local disk. On hosts with ephemeral disks (Render, Heroku) switch to S3 / Cloudflare R2 / Cloudinary
  (replace the write in `downloadImage`).
- **Database:** SQLite is fine for one server. Move to Postgres if you scale out.
- Add rate limiting (e.g. `express-rate-limit`) on `/api/*` and basic content moderation.
- Put the site and API behind the same domain, or enable CORS if the website lives elsewhere.
