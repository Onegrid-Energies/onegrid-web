// Sign-in: Google, email sign-in links, and email + password. Logins are JWTs (HS256, signed with
// JWT_SECRET) stored in an HttpOnly cookie, so the server keeps no session storage and survives
// restarts.
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config, features } from './config.mjs';
import { db } from './db.mjs';
import { sendEmail } from './mail.mjs';
import { findUser, normaliseEmail, verifyPassword } from './users.mjs';

const COOKIE = 'onegrid_admin';
const STATE_COOKIE = 'onegrid_admin_oauth';
const secure = config.publicUrl.startsWith('https://');

// ---------------------------------------------------------------- JWTs

// Each kind of token has its own audience, so a token made for one purpose (e.g. an emailed
// link) can never be used as another (e.g. a login cookie).
const ISSUER = 'onegrid-admin';
export const AUDIENCE = { session: 'onegrid-admin:session', link: 'onegrid-admin:sign-in-link', oauthState: 'onegrid-admin:google-state' };
const KEY = new TextEncoder().encode(config.jwtSecret);

export function signJwt(claims, { audience, subject, expiresInSeconds }) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds);
  if (subject) jwt.setSubject(subject);
  return jwt.sign(KEY);
}

// Returns the claims, or null if the token is missing, forged, expired or for another purpose.
export async function verifyJwt(token, audience) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const { payload } = await jwtVerify(token, KEY, { issuer: ISSUER, audience, algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- cookies

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
export async function sessionCookie(email) {
  const seconds = config.sessionDays * 86400;
  return cookie(COOKIE, await signJwt({}, { audience: AUDIENCE.session, subject: email, expiresInSeconds: seconds }), seconds);
}
export const clearSessionCookie = () => cookie(COOKIE, '', 0);

// The signed-in user for a request (re-checked against the team list, so removing someone
// signs them out within a minute).
export async function currentUser(req) {
  const session = await verifyJwt(parseCookies(req.headers.cookie)[COOKIE], AUDIENCE.session);
  if (!session?.sub) return null;
  const user = await findUser(session.sub);
  if (!user) return null;
  return { ...user, author: { name: user.name || user.email, email: user.email } };
}

// ---------------------------------------------------------------- rate limiting

// Stored in MongoDB, so limits hold across restarts. Returns false once `limit` is exceeded.
export const rateLimit = (key, limit, windowMs) => db.rateLimit(key, limit, windowMs);

// ---------------------------------------------------------------- email + password

export async function passwordLogin(email, password) {
  email = normaliseEmail(email);
  const user = await findUser(email);
  if (!user) return null;
  if (user.passwordHash && await verifyPassword(password, user.passwordHash)) return user;
  // First sign-in for an OWNER_EMAILS owner before they have set a password.
  if (!user.passwordHash && user.builtInOwner && config.ownerInitialPassword && password === config.ownerInitialPassword) return user;
  return null;
}

// ---------------------------------------------------------------- email sign-in links


export async function sendSignInLink(email, purpose = 'sign-in') {
  email = normaliseEmail(email);
  const user = await findUser(email);
  if (!user) return; // say nothing: don't reveal who is on the team
  const token = await signJwt({ purpose, jti: randomBytes(12).toString('base64url') }, { audience: AUDIENCE.link, subject: email, expiresInSeconds: 20 * 60 });
  const link = `${config.publicUrl}/auth/link?token=${encodeURIComponent(token)}`;
  const action = purpose === 'reset' ? 'reset your password' : 'sign in';
  await sendEmail({
    to: email,
    subject: purpose === 'reset' ? 'Reset your OneGrid WebAdmin password' : 'Your OneGrid WebAdmin sign-in link',
    text: `Hello${user.name ? ' ' + user.name : ''},\n\nUse this link to ${action} to OneGrid WebAdmin, the OneGrid Energies web content admin:\n\n${link}\n\nThe link works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email.\n`,
    html: `<p>Hello${user.name ? ' ' + escapeHtml(user.name) : ''},</p><p>Use this button to ${action} to OneGrid WebAdmin, the OneGrid Energies web content admin:</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#ffd400;color:#0a0a0a;text-decoration:none;font-weight:600">${purpose === 'reset' ? 'Reset password' : 'Sign in'}</a></p><p style="color:#64748b;font-size:13px">The link works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email.</p>`
  });
}

export async function useSignInLink(token) {
  const payload = await verifyJwt(token, AUDIENCE.link);
  if (!payload?.jti || !payload.sub) return null;
  // Recorded in MongoDB, so each link works once — even after a restart.
  if (!(await db.useLinkOnce(payload.jti, new Date(payload.exp * 1000)))) return null;
  const user = await findUser(payload.sub);
  return user ? { user, purpose: payload.purpose } : null;
}

// ---------------------------------------------------------------- Google

export async function googleStart() {
  if (!features.google) return null;
  const state = randomBytes(16).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.publicUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  const stateToken = await signJwt({ state }, { audience: AUDIENCE.oauthState, expiresInSeconds: 600 });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, stateCookie: cookie(STATE_COOKIE, stateToken, 600) };
}

export async function googleFinish(req, query) {
  const saved = await verifyJwt(parseCookies(req.headers.cookie)[STATE_COOKIE], AUDIENCE.oauthState);
  if (!saved || !query.state || saved.state !== query.state) throw Object.assign(new Error('Your sign-in expired. Please try again.'), { status: 400 });
  if (query.error || !query.code) throw Object.assign(new Error('Google sign-in was cancelled.'), { status: 400 });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: query.code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: `${config.publicUrl}/auth/google/callback`,
      grant_type: 'authorization_code'
    })
  });
  if (!response.ok) throw Object.assign(new Error('Google sign-in failed. Please try again.'), { status: 502 });
  const { id_token: idToken } = await response.json();
  // The ID token came straight from Google over HTTPS in exchange for our secret, so its
  // claims can be read directly; we still check the audience and that the email is verified.
  const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8'));
  if (claims.aud !== config.google.clientId || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) {
    throw Object.assign(new Error('Google sign-in could not be verified.'), { status: 400 });
  }
  if (!claims.email_verified) throw Object.assign(new Error('Your Google email address is not verified.'), { status: 403 });
  const user = await findUser(claims.email);
  return { user, email: normaliseEmail(claims.email), name: claims.name || '' };
}
export const clearStateCookie = () => cookie(STATE_COOKIE, '', 0);

export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
