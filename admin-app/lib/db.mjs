// The admin's own data, in MongoDB (e.g. MongoDB Atlas):
//   users        — the team: email (_id), name, role, password hash
//   login_links  — emailed sign-in links already used (keeps each link single-use across restarts)
//   rate_limits  — sign-in attempt counters
//   activity     — who saved, created or deleted what, and sign-ins
//   analytics_views  — website page views (one per page opened; anonymous, see lib/analytics.mjs)
//   analytics_events — website actions: WhatsApp/phone/email taps, enquiries, gallery opens, …
//   analytics_salts  — the daily random value used to count unique visitors without cookies
// Expired link/limit records, year-old activity and analytics older than ANALYTICS_RETENTION_DAYS
// are removed automatically (TTL indexes).
// Website content is NOT stored here — it stays as files in GitHub (see store.mjs).
//
// Without MONGODB_URI in local mode, an in-memory version is used (data is lost on restart).
import { MongoClient } from 'mongodb';
import { config } from './config.mjs';

const YEAR_SECONDS = 365 * 24 * 3600;
const ANALYTICS_SECONDS = config.analytics.retentionDays * 24 * 3600;
const VIEW_FIELDS = { title: 0 };
const MAX_DURATION = 3600;

// A TTL index whose lifetime may change later (ANALYTICS_RETENTION_DAYS): update it in place.
async function ttlIndex(collection, field, seconds) {
  try {
    await collection.createIndex({ [field]: 1 }, { expireAfterSeconds: seconds });
  } catch (error) {
    if (error.code !== 85 && error.codeName !== 'IndexOptionsConflict') throw error;
    await collection.db.command({ collMod: collection.collectionName, index: { keyPattern: { [field]: 1 }, expireAfterSeconds: seconds } });
  }
}

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
        col('activity').createIndex({ at: 1 }, { expireAfterSeconds: YEAR_SECONDS }),
        ttlIndex(col('analytics_views'), 'at', ANALYTICS_SECONDS),
        ttlIndex(col('analytics_events'), 'at', ANALYTICS_SECONDS),
        col('analytics_views').createIndex({ lastSeen: -1 }),
        col('analytics_salts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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
    },

    analytics: {
      // One random value per day: visitor ids made with it can't be linked across days.
      async salt(day, fresh) {
        const doc = await col('analytics_salts').findOneAndUpdate(
          { _id: day },
          { $setOnInsert: { salt: fresh, expiresAt: new Date(Date.now() + 3 * 24 * 3600_000) } },
          { upsert: true, returnDocument: 'after' }
        ).catch(error => (error.code === 11000 ? col('analytics_salts').findOne({ _id: day }) : Promise.reject(error)));
        return doc.salt;
      },
      async addView({ id, ...view }) {
        try { await col('analytics_views').insertOne({ _id: id, ...view }); }
        catch (error) { if (error.code !== 11000) throw error; } // the same page view sent twice
      },
      // Time on page and scroll depth only ever go up.
      async touchView(id, { duration, scroll }) {
        await col('analytics_views').updateOne({ _id: id }, { $max: { duration: Math.min(duration, MAX_DURATION), scroll }, $set: { lastSeen: new Date() } });
      },
      async viewInfo(id) { return col('analytics_views').findOne({ _id: id }, { projection: { path: 1, page: 1, item: 1, session: 1, visitor: 1, country: 1, device: 1 } }); },
      addEvent: event => col('analytics_events').insertOne(event),
      views: (from, to, withTitles = false) => col('analytics_views').find({ at: { $gte: from, $lt: to } }, { projection: withTitles ? {} : VIEW_FIELDS }).toArray(),
      events: (from, to) => col('analytics_events').find({ at: { $gte: from, $lt: to } }).toArray(),
      activeSince: since => col('analytics_views').find({ lastSeen: { $gte: since } }, { projection: VIEW_FIELDS }).toArray(),
      recent: (limit = 30) => col('analytics_views').find({}, { projection: VIEW_FIELDS }).sort({ at: -1 }).limit(limit).toArray(),
      count: () => col('analytics_views').estimatedDocumentCount()
    }
  };
}
const fromDoc = ({ _id, ...user }) => ({ email: _id, ...user });

// ---------------------------------------------------------------- in memory (local development)

function memoryDb() {
  const users = new Map(); const links = new Map(); const limits = new Map(); const activity = [];
  const salts = new Map(); const views = new Map(); const events = [];
  const inRange = (from, to) => item => item.at >= from && item.at < to;
  const withoutTitle = ({ title, ...view }) => view;
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
    },
    analytics: {
      async salt(day, fresh) { if (!salts.has(day)) salts.set(day, fresh); return salts.get(day); },
      async addView({ id, ...view }) { if (!views.has(id)) views.set(id, { _id: id, ...view }); },
      async touchView(id, { duration, scroll }) {
        const view = views.get(id);
        if (!view) return;
        view.duration = Math.max(view.duration || 0, Math.min(duration, MAX_DURATION));
        view.scroll = Math.max(view.scroll || 0, scroll);
        view.lastSeen = new Date();
      },
      async viewInfo(id) { return views.get(id) || null; },
      async addEvent(event) { events.push(event); },
      views: async (from, to, withTitles = false) => [...views.values()].filter(inRange(from, to)).map(view => (withTitles ? { ...view } : withoutTitle(view))),
      events: async (from, to) => events.filter(inRange(from, to)),
      activeSince: async since => [...views.values()].filter(view => view.lastSeen >= since).map(withoutTitle),
      recent: async (limit = 30) => [...views.values()].sort((a, b) => b.at - a.at).slice(0, limit).map(withoutTitle),
      count: async () => views.size
    }
  };
}

export const db = config.mongodb.uri ? mongoDb() : memoryDb();
