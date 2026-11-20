import { config } from './config.js';
import {
  getSession,
  saveSession,
  clearSession,
  findOrCreateSeller,
  createAdInMongo,
  Ad,
} from './db.js';
import { sendText, sendButtons, downloadImage } from './whatsapp.js';

/*
 * Conversation states
 *   IDLE     -> nothing in progress
 *   PHOTOS   -> collecting photos until the seller says "done"
 *   TITLE    -> waiting for a short product name
 *   PRICE    -> waiting for the price range (e.g. 500-600) or single price
 *   DESC     -> waiting for the description
 *   CONFIRM  -> waiting for yes / no
 */

// ---- per-user serialisation -------------------------------------------------
const queues = new Map();
export function enqueue(phone, task) {
  const prev = queues.get(phone) || Promise.resolve();
  const next = prev.then(task).catch((err) => console.error('flow error', err));
  queues.set(phone, next);
  next.finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
  return next;
}

// ---- helpers ----------------------------------------------------------------
export function parsePrice(text) {
  const clean = text.replace(/,/g, '').toLowerCase();
  const m = clean.match(/(\d+(?:\.\d+)?)\s*(k|lakh|lac|l)?\b/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1_000;
  else if (m[2]) n *= 100_000;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return Math.round(n);
}

export function parseRange(text) {
  const cleaned = text.replace(/₹|rs\.?|inr/gi, ' ').trim();
  const parts = cleaned.split(/\s*(?:-|–|\bto\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const nums = parts.map(parsePrice);
  if (nums.some((n) => n === null)) return null;
  const [a, b] = nums;
  return { minPrice: Math.min(a, b ?? a), maxPrice: Math.max(a, b ?? a) };
}

const fmtPrice = (n, cur = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);

const WELCOME =
  'Hi! 👋 I can help you sell something.\n\n' +
  'Type *sell* to post a new ad\n' +
  'Type *my ads* to see your ads\n' +
  'Type *cancel* any time to stop';

async function startSell(phone) {
  saveSession(phone, 'PHOTOS', { images: [] });
  await sendText(
    phone,
    `Great! Let's create your ad.\n\n📸 Send up to ${config.maxImages} photos of the item. ` +
      'When you have sent them all, type *done*.'
  );
}

async function showMyAds(phone, seller) {
  const ads = await Ad.find({ sellerId: seller._id, status: { $ne: 'removed' } })
    .sort({ createdAt: -1 })
    .lean();

  if (!ads.length) {
    return sendText(phone, "You don't have any ads yet. Type *sell* to create one.");
  }

  const lines = ads.map(
    (a) => `#${a.adId} ${a.title}\n   ${fmtPrice(a.minPrice)}–${fmtPrice(a.maxPrice)} [${a.status}]`
  );
  return sendText(
    phone,
    `Your ads:\n${lines.join('\n')}\n\nReply *sold <id>* when something is sold or *remove <id>* to take it down.`
  );
}

// ---- main entry -------------------------------------------------------------
/**
 * msg = { type: 'text' | 'image' | 'button' | 'other', text?, mediaId?, buttonId? }
 */
export async function handleIncoming(phone, msg, profileName = null) {
  // 1. Ensure seller profile exists in MongoDB
  const seller = await findOrCreateSeller(phone);
  console.log(seller)
  if (!seller.name && profileName) {
    seller.name = profileName.trim().slice(0, 40);
    await seller.save();
  }

  const raw = (msg.buttonId || msg.text || '').trim();
  const lower = raw.toLowerCase();
console.log(lower)
  // Global commands
  if (['cancel', 'stop', 'cancel_draft'].includes(lower)) {
    clearSession(phone);
    return sendText(phone, 'Okay, cancelled. Type *sell* whenever you want to start again.');
  }
  if (lower === 'my ads' || lower === 'myads') return showMyAds(phone, seller);

  const manage = lower.match(/^(sold|remove|delete)\s+#?(\d+)$/);
  if (manage) {
    const adId = Number(manage[2]);
    const status = manage[1] === 'sold' ? 'sold' : 'removed';
    const updated = await Ad.findOneAndUpdate(
      { adId, sellerId: seller._id, status: { $ne: 'removed' } },
      { $set: { status } }
    );
    return sendText(
      phone,
      updated
        ? status === 'sold'
          ? `Marked ad #${adId} as sold. 🎉`
          : `Ad #${adId} has been removed.`
        : "I couldn't find that ad among yours."
    );
  }

  const session = await getSession(phone) || { state: 'IDLE', draft: { images: [] } };
  const { draft } = session;
  console.log(session)
  switch (session.state) {
    case 'IDLE': {
      // Allow sending a photo right away to start an ad
      console.log(msg)
      if (msg.type === 'image') {
        try {
          const file = await downloadImage(msg.mediaId);
          saveSession(phone, 'PHOTOS', { images: [file] });
          return sendButtons(
            phone,
            `Got photo 1/${config.maxImages}. Send more, or tap Done.`,
            [
              { id: 'done', title: 'Done' },
              { id: 'cancel_draft', title: 'Cancel' },
            ]
          );
        } catch (err) {
          console.error('image error', err.message);
          return sendText(phone, "Sorry, I couldn't use that photo. Please send a JPG, PNG or WebP image.");
        }
      }
      console.log(lower)
      if (lower === 'sell' || lower.includes('sell') || lower === 'new' || lower === 'start_sell') {
        return startSell(phone);
      }
      return sendButtons(phone, WELCOME, [
        { id: 'start_sell', title: 'Sell something' },
      ]);
    }

    case 'PHOTOS': {
      if (msg.type === 'image') {
        if (draft.images.length >= config.maxImages) {
          return sendText(phone, `That's the maximum of ${config.maxImages} photos. Type *done* to continue.`);
        }
        try {
          const file = await downloadImage(msg.mediaId);
          draft.images.push(file);
          saveSession(phone, 'PHOTOS', draft);
          return sendButtons(
            phone,
            `Got photo ${draft.images.length}/${config.maxImages}. Send more, or tap Done.`,
            [
              { id: 'done', title: 'Done' },
              { id: 'cancel_draft', title: 'Cancel' },
            ]
          );
        } catch (err) {
          console.error('image error', err.message);
          return sendText(phone, "Sorry, I couldn't use that photo. Please send a JPG, PNG or WebP image.");
        }
      }
      if (lower === 'done') {
        if (!draft.images.length) return sendText(phone, 'Please send at least one photo first. 📸');
        saveSession(phone, 'TITLE', draft);
        return sendText(phone, 'Nice! What is the item? Send a short name (e.g. "iPhone 12 128GB, blue").');
      }
      return sendText(phone, 'Please send photos of the item, then type *done*.');
    }

    case 'TITLE': {
      if (msg.type !== 'text' || raw.length < 3) {
        return sendText(phone, 'Please send a short name for the item (at least 3 characters).');
      }
      draft.title = raw.slice(0, 80);
      saveSession(phone, 'PRICE', draft);
      return sendText(
        phone,
        'What price range would you accept? Send it like *500-600* or *15k-18k*.\n' +
          '(Buyers see the higher number; you only see bids at or above the lower number. Send one number for a fixed price.)'
      );
    }

    case 'PRICE': {
      const range = msg.type === 'text' ? parseRange(raw) : null;
      if (!range) {
        return sendText(phone, "I couldn't read that price. Please send a range like *500-600* or a number like *15000*.");
      }
      draft.minPrice = range.minPrice;
      draft.maxPrice = range.maxPrice;
      saveSession(phone, 'DESC', draft);
      return sendText(
        phone,
        `Buyers will see *${fmtPrice(draft.maxPrice)}* (your minimum is *${fmtPrice(draft.minPrice)}*).\n\n` +
          'Now add a short description: condition, age, any defects, what is included.'
      );
    }

    case 'DESC': {
      if (msg.type !== 'text' || raw.length < 5) {
        return sendText(phone, 'Please write a short description (at least 5 characters).');
      }
      draft.description = raw.slice(0, 1000);
      saveSession(phone, 'CONFIRM', draft);
      return sendButtons(
        phone,
        `Please check your ad:\n\n*${draft.title}*\n` +
          `Asking price: ${fmtPrice(draft.maxPrice)}\n` +
          `Your minimum: ${fmtPrice(draft.minPrice)} (private)\n` +
          `${draft.description}\n\n` +
          `📸 ${draft.images.length} photo(s)\n\n` +
          'Publish this ad?',
        [
          { id: 'confirm_yes', title: 'Publish' },
          { id: 'cancel_draft', title: 'Cancel' },
        ]
      );
    }

    case 'CONFIRM': {
      if (['confirm_yes', 'yes', 'y', 'publish'].includes(lower)) {
        // 2. Save the ad directly into MongoDB linked to the seller's profile
        const ad = await createAdInMongo({
          sellerId: seller._id,
          title: draft.title,
          description: draft.description,
          imagePaths: draft.images,
          minPrice: draft.minPrice,
          maxPrice: draft.maxPrice,
          localityId: seller.localityId || 'koramangala',
        });

        clearSession(phone);
        const frontendUrl = (process.env.FRONTEND_URL || config.publicBaseUrl).replace(/\/$/, '');
        return sendText(
          phone,
          `✅ Your ad #${ad.adId} is live! ${frontendUrl}/ads/${ad.adId}\n\nType *my ads* to manage it.`
        );
      }
      return sendButtons(phone, 'Tap *Publish* to post your ad, or Cancel to discard it.', [
        { id: 'confirm_yes', title: 'Publish' },
        { id: 'cancel_draft', title: 'Cancel' },
      ]);
    }

    default:
      clearSession(phone);
      return sendText(phone, WELCOME);
  }
}