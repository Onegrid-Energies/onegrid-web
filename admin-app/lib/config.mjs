// Settings come from environment variables (on Render: the Environment tab). For local use, an
// admin-app/.env file is loaded automatically if present — like dotenv.config(), but built into
// Node. Variables already set in the environment always win over the file.
// See .env.example for what each one does.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_DIR = path.dirname(APP_DIR);

const ENV_FILE = path.join(APP_DIR, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const env = process.env;
const list = value => String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

const localMode = (env.CONTENT_BACKEND || 'github') === 'local';
// JWT_SECRET signs every JWT (logins and emailed links).
// SESSION_SECRET is accepted as the older name for the same setting.
const jwtSecret = env.JWT_SECRET || env.SESSION_SECRET || '';
if (!localMode && !jwtSecret) {
  throw new Error('JWT_SECRET is required (a long random string, e.g. `openssl rand -hex 32`). See admin-app/README.md.');
}
if (!localMode && jwtSecret.length < 32) {
  // A new JWT_SECRET must be strong; an existing short SESSION_SECRET only warns.
  if (env.JWT_SECRET) throw new Error('JWT_SECRET is too short — use at least 32 random characters (e.g. `openssl rand -hex 32`).');
  console.warn('Warning: SESSION_SECRET is shorter than 32 characters. Set a longer JWT_SECRET (changing it just signs everyone out).');
}

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
  siteUrl: (env.SITE_URL || 'https://onegridenergies.com').replace(/\/+$/, ''),
  // Signs the JWTs. Keep it secret; changing it signs everyone out.
  jwtSecret: jwtSecret || randomBytes(32).toString('hex'),
  sessionDays: Number(env.SESSION_DAYS || 14),
  ownerEmails: list(env.OWNER_EMAILS),
  ownerInitialPassword: env.OWNER_INITIAL_PASSWORD || '',

  backend: localMode ? 'local' : 'github',
  // The admin's own data (team, login links, rate limits, activity). See lib/db.mjs.
  mongodb: {
    uri: env.MONGODB_URI || '',
    dbName: env.MONGODB_DB || 'onegrid_webadmin'
  },
  github: {
    token: env.GITHUB_TOKEN || '',
    repo: env.GITHUB_REPO || 'OneGrid-Energies/onegrid-web',
    branch: env.GITHUB_BRANCH || 'master'
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || ''
  },
  mail: {
    brevoApiKey: env.BREVO_API_KEY || '',
    from: env.MAIL_FROM || 'OneGrid Admin <admin@onegridenergies.com>'
  },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || 'dj2ciluyx',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
    folder: env.CLOUDINARY_FOLDER || 'onegrid'
  },

  // The content sections and fields editors see.
  schemaFile: path.join(APP_DIR, 'schema.yml')
};

export const features = {
  google: Boolean(config.google.clientId && config.google.clientSecret),
  // In local mode, emails are printed to the terminal instead of sent.
  emailLink: Boolean(config.mail.brevoApiKey) || localMode,
  password: true,
  uploads: Boolean(config.cloudinary.apiKey && config.cloudinary.apiSecret)
};

if (config.backend === 'github' && !config.github.token) {
  throw new Error('GITHUB_TOKEN is required to read and save content. See admin-app/README.md.');
}
if (config.backend === 'github' && !config.mongodb.uri) {
  throw new Error('MONGODB_URI is required (your MongoDB Atlas connection string). See admin-app/README.md.');
}
