// The admin's own data, in MongoDB (e.g. MongoDB Atlas):
//   users        — the team: email (_id), name, role, password hash
//   login_links  — emailed sign-in links already used (keeps each link single-use across restarts)
//   rate_limits  — sign-in attempt counters
//   activity     — who saved, created or deleted what, and sign-ins
// Expired link/limit records and year-old activity are removed automatically (TTL indexes).
// Website content is NOT stored here — it stays as files in GitHub (see store.mjs).
//
// Without MONGODB_URI in local mode, an in-memory version is used (data is lost on restart).
import { MongoClient } from 'mongodb';
import { config } from './config.mjs';

const YEAR_SECONDS = 365 * 24 * 3600;

// ---------------------------------------------------------------- MongoDB

function mongoDb() {
  const client = new MongoClient(config.mongodb.uri, { appName: 'onegrid-admin', serverSelectionTimeoutMS: 10_000 });
  let db;
  const col = name => db.collection(name);

  return {
    kind: 'mongodb',
    async init() {
      await client.connect();
      db = client.db(config.mongodb.dbName);
      await Promise.all([
        col('login_links').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('activity').createIndex({ at: 1 }, { expireAfterSeconds: YEAR_SECONDS })
      ]);
    },
    async ping() { await db.command({ ping: 1 }); return true; },
    close: () => client.close(),

    users: {
      find: async email => {
        const user = await col('users').findOne({ _id: email });
        return user ? fromDoc(user) : null;
      },
      list: async () => (await col('users').find().sort({ _id: 1 }).toArray()).map(fromDoc),
      upsert: async (email, fields) => {
        const { email: _ignored, ...rest } = fields;
        const result = await col('users').findOneAndUpdate(
          { _id: email },
          { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { addedAt: new Date() } },
          { upsert: true, returnDocument: 'after' }
        );
        return fromDoc(result);
      },
      remove: email => col('users').deleteOne({ _id: email })
    },

    // true the first time a link id is used, false after that.
    async useLinkOnce(id, expiresAt) {
      try {
        await col('login_links').insertOne({ _id: id, usedAt: new Date(), expiresAt });
        return true;
      } catch (error) {
        if (error.code === 11000) return false;
        throw error;
      }
    },

    // Fixed-window counter: at most `limit` hits per `windowMs` for this key.
    async rateLimit(key, limit, windowMs) {
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + windowMs) } };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const doc = await col('rate_limits').findOneAndUpdate({ _id: `${key}@${windowStart}` }, update, { upsert: true, returnDocument: 'after' });
          return doc.count <= limit;
        } catch (error) {
          if (error.code !== 11000) throw error; // two first hits at once: retry as an update
        }
      }
      return false;
    },

    activity: {
      log: entry => col('activity').insertOne({ at: new Date(), ...entry }),
      recent: async (limit = 100) => (await col('activity').find().sort({ at: -1 }).limit(limit).toArray())
        .map(({ _id, ...entry }) => ({ id: String(_id), ...entry }))
    }
  };
}
const fromDoc = ({ _id, ...user }) => ({ email: _id, ...user });

// ---------------------------------------------------------------- in memory (local development)

function memoryDb() {
  const users = new Map(); const links = new Map(); const limits = new Map(); const activity = [];
  return {
    kind: 'memory',
    async init() { console.warn('No MONGODB_URI: using in-memory storage (local mode only — data is lost on restart).'); },
    async ping() { return true; },
    async close() {},
    users: {
      find: async email => (users.has(email) ? { ...users.get(email) } : null),
      list: async () => [...users.values()].sort((a, b) => a.email.localeCompare(b.email)).map(user => ({ ...user })),
      upsert: async (email, fields) => {
        const next = { addedAt: new Date(), ...users.get(email), ...fields, email, updatedAt: new Date() };
        users.set(email, next);
        return { ...next };
      },
      remove: async email => users.delete(email)
    },
    async useLinkOnce(id) {
      if (links.has(id)) return false;
      links.set(id, Date.now());
      return true;
    },
    async rateLimit(key, limit, windowMs) {
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      const id = `${key}@${windowStart}`;
      limits.set(id, (limits.get(id) || 0) + 1);
      return limits.get(id) <= limit;
    },
    activity: {
      log: async entry => { activity.unshift({ id: String(activity.length + 1), at: new Date(), ...entry }); activity.length = Math.min(activity.length, 1000); },
      recent: async (limit = 100) => activity.slice(0, limit)
    }
  };
}

export const db = config.mongodb.uri ? mongoDb() : memoryDb();
