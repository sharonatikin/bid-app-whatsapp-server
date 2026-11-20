// src/db.js
import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';

if (process.env.MONGO_DNS_OVERRIDE === 'true') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  console.log('Connected to MongoDB');
}

// ---------- Schemas & Models ----------

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: null },
  localityId: { type: String, default: null },
  consentAt: { type: Date, default: null },
  lastInboundAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

const adSchema = new mongoose.Schema({
  adId: { type: Number, required: true, unique: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  title: { type: String, required: true, maxlength: 80 },
  description: { type: String, required: true, maxlength: 1000 },
  images: { type: [String], default: [] },
  minPrice: { type: Number, required: true, min: 1 },
  maxPrice: { type: Number, required: true, min: 1 },
  localityId: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'active', 'reserved', 'sold', 'removed', 'hidden'],
    default: 'active',
  },
  createdAt: { type: Date, default: Date.now },
});

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

// Stores active WhatsApp chat states & drafts per phone number
const botSessionSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  state: { type: String, required: true },
  draft: { type: mongoose.Schema.Types.Mixed, default: { images: [] } },
  updatedAt: { type: Date, default: Date.now },
});

// Deduplicates retried WhatsApp webhook deliveries
const processedMessageSchema = new mongoose.Schema({
  _id: String,
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Ad = mongoose.models.Ad || mongoose.model('Ad', adSchema);
export const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
export const BotSession = mongoose.models.BotSession || mongoose.model('BotSession', botSessionSchema);
export const ProcessedMessage =
  mongoose.models.ProcessedMessage || mongoose.model('ProcessedMessage', processedMessageSchema);

// ---------- Bot Sessions (MongoDB-backed) ----------

export async function getSession(phone) {
  const row = await BotSession.findOne({ phone }).lean();
  if (!row) return null;

  const ttl = config.sessionTtlMs || 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(row.updatedAt).getTime() > ttl) {
    await clearSession(phone);
    return null;
  }
  return { state: row.state, draft: row.draft || { images: [] } };
}

export async function saveSession(phone, state, draft) {
  await BotSession.findOneAndUpdate(
    { phone },
    { $set: { state, draft, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function clearSession(phone) {
  await BotSession.deleteOne({ phone });
}

// ---------- Webhook Deduplication ----------

export async function markProcessed(id) {
  try {
    await ProcessedMessage.create({ _id: id });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // duplicate message ID
    throw err;
  }
}

// ---------- Sellers & Ads ----------

/** Finds existing seller by WhatsApp phone or creates a new profile automatically */
export async function findOrCreateSeller(phone) {
  return User.findOneAndUpdate(
    { phone },
    {
      $set: { lastInboundAt: new Date() },
      $setOnInsert: {
        phone,
        name: null,
        localityId: 'koramangala',
        consentAt: new Date(),
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

/** Creates the ad in MongoDB with an auto-incrementing adId matching the Next.js app */
export async function createAdInMongo({ sellerId, title, description, imagePaths, minPrice, maxPrice, localityId }) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'ad' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );



  return Ad.create({
    adId: counter.seq,
    sellerId,
    title: title.trim().slice(0, 80),
    description: description.trim().slice(0, 1000),
    images,
    minPrice,
    maxPrice,
    localityId: localityId || 'koramangala',
    status: 'active',
  });
}