import 'dotenv/config';

const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  waToken: process.env.WA_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  verifyToken: process.env.WA_VERIFY_TOKEN || '',
  appSecret: process.env.WA_APP_SECRET || '',
  graphVersion: process.env.WA_GRAPH_VERSION || 'v21.0',
  currency: process.env.DEFAULT_CURRENCY || 'INR',
  maxImages: Number(process.env.MAX_IMAGES || 5),
  autoPublish: bool(process.env.AUTO_PUBLISH, true),
  adminToken: process.env.ADMIN_TOKEN || '',
  dbPath: process.env.DB_PATH || './data/app.db',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  sessionTtlMs: 24 * 60 * 60 * 1000,
};

export const dryRun = !config.waToken;
