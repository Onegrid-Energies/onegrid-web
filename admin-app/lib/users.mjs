// The team: who may sign in, their role, and (optionally) a password hash — stored in MongoDB
// (the `users` collection). Emails in OWNER_EMAILS are always owners, so the app can't lock its
// owner out, even with an empty database.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.mjs';
import { db } from './db.mjs';

const scrypt = promisify(scryptCb);

// ---------------------------------------------------------------- passwords

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

// ---------------------------------------------------------------- team

export const normaliseEmail = email => String(email || '').trim().toLowerCase();
const isOwnerEmail = email => config.ownerEmails.includes(email);

// A person who may sign in: from the team, or an owner listed in OWNER_EMAILS.
export async function findUser(email) {
  email = normaliseEmail(email);
  if (!email) return null;
  const user = await db.users.find(email);
  if (isOwnerEmail(email)) return { name: '', ...user, email, role: 'owner', builtInOwner: true };
  return user;
}

export async function listUsers() {
  const byEmail = new Map((await db.users.list()).map(user => [user.email, user]));
  for (const email of config.ownerEmails) byEmail.set(email, { name: '', ...byEmail.get(email), email, role: 'owner', builtInOwner: true });
  return [...byEmail.values()]
    .map(({ passwordHash, ...user }) => ({ ...user, hasPassword: Boolean(passwordHash) }))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'owner' ? -1 : 1));
}

export async function upsertUser(email, changes) {
  email = normaliseEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  const fields = { ...changes };
  if ('role' in fields && !['owner', 'editor'].includes(fields.role)) fields.role = 'editor';
  const existing = await db.users.find(email);
  if (!existing && !('role' in fields)) fields.role = 'editor';
  return db.users.upsert(email, fields);
}

export async function removeUser(email) {
  email = normaliseEmail(email);
  if (isOwnerEmail(email)) throw Object.assign(new Error('This owner is set in OWNER_EMAILS on the server and can only be removed there.'), { status: 400 });
  await db.users.remove(email);
}

export async function setPassword(email, password) {
  const problem = validatePassword(password);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  await upsertUser(email, { passwordHash: await hashPassword(password), passwordSetAt: new Date() });
}
