import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, dryRun } from './config.js';
import { markProcessed,  } from './db.js';
import { enqueue, handleIncoming } from './flow.js';
import cors from 'cors';
import { connectDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Connect to MongoDB before listening
await connectDb();
// Keep the raw body: Meta signs it and we must verify the exact bytes.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);


app.use(cors());


// ---------------------------------------------------------------------------
// WhatsApp webhook
// ---------------------------------------------------------------------------

// 1) Verification handshake when you save the webhook URL in the Meta dashboard
app.get('/webhook', (req, res) => {
  console.log('checking')
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token && token === config.verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

function validSignature(req) {
  if (!config.appSecret) return true; // dev only; set WA_APP_SECRET in production
  const header = req.get('x-hub-signature-256') || '';
  const expected =
    'sha256=' + crypto.createHmac('sha256', config.appSecret).update(req.rawBody || '').digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalise(m) {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: m.text?.body || '' };
    case 'image':
      return { type: 'image', mediaId: m.image?.id, text: m.image?.caption || '' };
    case 'interactive':
      return { type: 'button', buttonId: m.interactive?.button_reply?.id || m.interactive?.list_reply?.id };
    case 'button':
      return { type: 'button', buttonId: m.button?.payload || m.button?.text };
    default:
      return { type: 'other' };
  }
}

// 2) Incoming messages
app.post('/webhook', (req, res) => {
  console.log("checking post")
  if (!validSignature(req)) return res.sendStatus(401);

  // Acknowledge immediately; WhatsApp retries if we are slow.
  res.sendStatus(200);

  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        if (!markProcessed(m.id)) continue; // duplicate delivery
        const phone = m.from;
        enqueue(phone, () => handleIncoming(phone, normalise(m)));
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Public API + website
// ---------------------------------------------------------------------------
const toPublic = (a) => ({
  id: a.id,
  title: a.title,
  price: a.price,
  currency: a.currency,
  description: a.description,
  images: JSON.parse(a.images).map((f) => `/uploads/${f}`),
  createdAt: a.created_at,
  contactUrl: `https://wa.me/${a.seller_phone}?text=${encodeURIComponent(
    `Hi, I'm interested in your ad "${a.title}" (#${a.id})`
  )}`,
});

app.get('/api/ads', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(listPublishedAds(limit, offset).map(toPublic));
});

app.get('/api/ads/:id', (req, res) => {
  const ad = getAd(Number(req.params.id));
  if (!ad || ad.status !== 'published') return res.sendStatus(404);
  res.json(toPublic(ad));
});

// ---------------------------------------------------------------------------
// Admin: approve / hide ads (needed when AUTO_PUBLISH=false, or to remove spam)
// ---------------------------------------------------------------------------
app.patch('/api/admin/ads/:id/status', (req, res) => {
  const token = req.get('x-admin-token') || '';
  const ok =
    config.adminToken &&
    token.length === config.adminToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken));
  if (!ok) return res.sendStatus(401);

  const status = req.body?.status;
  if (!['published', 'hidden', 'pending', 'sold'].includes(status)) {
    return res.status(400).json({ error: 'status must be published | hidden | pending | sold' });
  }
  res.json({ updated: setAdStatus(Number(req.params.id), status) });
});

app.use('/uploads', express.static(path.resolve(config.uploadDir), { maxAge: '7d', index: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`Server listening on :${config.port}${dryRun ? '  (DRY-RUN: no WhatsApp token set)' : ''}`);
});
