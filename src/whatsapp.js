import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, dryRun } from './config.js';

const base = `https://graph.facebook.com/${config.graphVersion}`;
const authHeader = { Authorization: `Bearer ${config.waToken}` };

fs.mkdirSync(config.uploadDir, { recursive: true });

async function post(body) {
  if (dryRun) {
    console.log(`[DRY RUN -> ${body.to}]`, JSON.stringify(body.text?.body ?? body.interactive, null, 2));
    return;
  }
  const res = await fetch(`${base}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('WhatsApp send failed', res.status, await res.text());
  }
}

export const sendText = (to, text) =>
  post({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } });

/** Reply buttons: max 3 buttons, titles max 20 chars. */
export const sendButtons = (to, text, buttons) =>
  post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// 1x1 PNG used only in dry-run mode so the whole flow can be tested offline
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Downloads a WhatsApp media item and stores it in UPLOAD_DIR.
 * Returns the stored file name, or throws if the file type is not allowed.
 */
export async function downloadImage(mediaId) {
  let buffer;
  let mime = 'image/png';

  if (dryRun) {
    buffer = PLACEHOLDER_PNG;
  } else {
    const metaRes = await fetch(`${base}/${mediaId}`, { headers: authHeader });
    if (!metaRes.ok) throw new Error(`media lookup failed: ${metaRes.status}`);
    const meta = await metaRes.json();
    mime = meta.mime_type;
    if (!EXT[mime]) throw new Error(`unsupported type ${mime}`);
    if (meta.file_size && meta.file_size > 8 * 1024 * 1024) throw new Error('image too large');

    const fileRes = await fetch(meta.url, { headers: authHeader });
    if (!fileRes.ok) throw new Error(`media download failed: ${fileRes.status}`);
    buffer = Buffer.from(await fileRes.arrayBuffer());
  }

  const name = `${crypto.randomUUID()}.${EXT[mime]}`;
  await fs.promises.writeFile(path.join(config.uploadDir, name), buffer);
  return name;
}
