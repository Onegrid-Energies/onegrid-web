// Website analytics — collected by a few lines in the website's script.js and stored in MongoDB.
//
// Privacy by design: no cookies, no IP addresses and no browser fingerprints are stored. A visitor
// is counted with a one-way hash of (IP address + browser + today's random salt); the salt is
// replaced every day, so the same person can't be followed from one day to the next. Country comes
// from Cloudflare's country header when the admin is behind Cloudflare, otherwise from the
// visitor's time zone. People on the team can switch counting off for their own browser.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from './config.mjs';
import { db } from './db.mjs';

const TZ_COUNTRY = JSON.parse(readFileSync(new URL('./timezones.json', import.meta.url), 'utf8'));
const TZ = config.analytics.timezone;

// ---------------------------------------------------------------- where visits may come from

const siteOrigin = new URL(config.siteUrl).origin;
const twin = (() => {
  const url = new URL(config.siteUrl);
  url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
  return url.origin;
})();
const ORIGINS = new Set([siteOrigin, twin, ...config.analytics.extraOrigins.map(origin => new URL(origin).origin)]);
const SITE_HOSTS = new Set([...ORIGINS].map(origin => new URL(origin).hostname));
const isLocal = origin => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

export function allowedOrigin(origin) {
  if (!origin) return null;
  if (ORIGINS.has(origin)) return origin;
  if (config.backend === 'local' && isLocal(origin)) return origin; // local testing
  return null;
}

// ---------------------------------------------------------------- reading the request

const BOT = /bot|crawl|spider|slurp|scrape|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp\/|embedly|monitor|uptime|curl|wget|python|node-fetch|axios|java\/|go-http|httpclient|phantom|puppeteer|playwright|selenium/i;
export const isBot = userAgent => !userAgent || BOT.test(userAgent);

function browserOf(ua) {
  const rules = [
    [/FBAN|FBAV|FB_IAB/, 'Facebook app'], [/Instagram/, 'Instagram app'], [/LinkedInApp/, 'LinkedIn app'],
    [/Snapchat/, 'Snapchat app'], [/TikTok|musical_ly/, 'TikTok app'], [/\bGSA\//, 'Google app'],
    [/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera|OPT\//, 'Opera'], [/SamsungBrowser/, 'Samsung Internet'],
    [/UCBrowser/, 'UC Browser'], [/YaBrowser/, 'Yandex'], [/Firefox|FxiOS/, 'Firefox'],
    [/CriOS|Chrome|Chromium/, 'Chrome'], [/Safari/, 'Safari']
  ];
  return (rules.find(([pattern]) => pattern.test(ua)) || [, 'Other'])[1];
}
function osOf(ua) {
  const rules = [
    [/Windows/, 'Windows'], [/iPhone|iPad|iPod/, 'iOS'], [/Android/, 'Android'], [/CrOS/, 'ChromeOS'],
    [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux']
  ];
  return (rules.find(([pattern]) => pattern.test(ua)) || [, 'Other'])[1];
}
function deviceOf(ua, width, touch) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'Tablet';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/.test(ua)) return 'Mobile';
  if (/Macintosh/.test(ua) && touch) return 'Tablet'; // iPads ask for the desktop site
  if (width && width < 600) return 'Mobile';
  return 'Desktop';
}

function countryOf(req, timezone) {
  const header = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(header) && header !== 'XX' && header !== 'T1') return header;
  return TZ_COUNTRY[timezone] || '';
}

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave|qwant|startpage|ask|aol|naver|seznam)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|twitter|x|t|whatsapp|wa|youtube|youtu|tiktok|reddit|pinterest|telegram|t\.me|threads|snapchat|quora|medium|discord)\.(com|me|co|in|net|org|be|gg)$|^t\.co$|^lm\.facebook\.com$|^l\.instagram\.com$/;
const AI = /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|deepseek\.com|meta\.ai)$/;

function channelOf(host, utm) {
  const medium = String(utm.medium || '').toLowerCase();
  if (/cpc|ppc|paid|ads?$|display|banner/.test(medium)) return 'Paid ads';
  if (/e-?mail|newsletter/.test(medium)) return 'Email';
  if (/social/.test(medium)) return 'Social';
  if (!host) return utm.source ? 'Campaigns' : 'Direct';
  if (AI.test(host)) return 'AI assistants';
  if (SEARCH.test(host) || host.includes('google.')) return 'Search';
  if (SOCIAL.test(host)) return 'Social';
  if (/mail\.|outlook\.|gmail/.test(host)) return 'Email';
  return 'Other websites';
}

function referrerOf(value) {
  const text = String(value || '').slice(0, 500);
  if (!text) return { host: '', url: '' };
  // Android apps: android-app://com.google.android.gm/
  const app = text.match(/^android-app:\/\/([^/]+)/);
  if (app) return { host: app[1], url: '' };
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (SITE_HOSTS.has(url.hostname) || SITE_HOSTS.has(host) || SITE_HOSTS.has(`www.${host}`)) return { host: '', url: '', internal: true };
    return { host, url: `${url.origin}${url.pathname}`.slice(0, 300) };
  } catch {
    return { host: '', url: '' };
  }
}

// /stories-of-hope/ → { page: 'stories-of-hope', item: '' }
const PAGES = ['about', 'oneplastic', 'stories-of-hope', 'recognitions', 'quote', 'contact'];
export function pageOf(path, notFound) {
  if (notFound) return { page: '404', item: '' };
  const parts = path.split('/').filter(Boolean);
  if (!parts.length || (parts[0] === 'home' && parts.length === 1)) return { page: 'home', item: '' };
  if (PAGES.includes(parts[0]) && parts.length === 1) return { page: parts[0], item: '' };
  return { page: 'other', item: '' };
}

function cleanPath(value) {
  let path = String(value || '/').split(/[?#]/)[0].slice(0, 200);
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/index\.html$/, '/').replace(/\/{2,}/g, '/');
  if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) path += '/';
  return path;
}
const text = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ID = /^[a-z0-9]{8,32}$/i;

// ---------------------------------------------------------------- dates (in the business's time zone)

const partsFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
function zoned(date) {
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, hour: Number(parts.hour) % 24, weekday: parts.weekday };
}
// The instant when a calendar day (YYYY-MM-DD) starts in TZ.
function startOfDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const shown = new Date(guess);
  const p = Object.fromEntries(partsFormat.formatToParts(shown).map(part => [part.type, part.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24) - guess;
  return new Date(guess - offset);
}
const addDays = (day, n) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- collecting

const salts = new Map();
async function visitorId(ip, ua) {
  const day = zoned(new Date()).day;
  if (!salts.has(day)) {
    salts.clear();
    salts.set(day, await db.analytics.salt(day, randomBytes(16).toString('hex')));
  }
  return createHash('sha256').update(`${salts.get(day)}|${ip}|${ua}|${siteOrigin}`).digest('hex').slice(0, 20);
}

// What the website reports (see the tracker in the site's script.*.js).
const EVENTS = new Set([
  'whatsapp', 'call', 'email', 'enquiry', 'outbound', 'contact_click', 'quote_click',
  'media_open', 'video_play', 'gallery_filter', 'plan_view', 'plan_click', 'programme_view'
]);

// One message from the website: a page view ("v"), time-on-page update ("p") or action ("e").
export async function collect(req, body, ip) {
  if (!body || typeof body !== 'object') return;
  const id = String(body.id || '');
  if (!ID.test(id)) return;

  // Updates and actions only ever apply to a page view already stored, so only views are screened.
  if (body.t === 'v') {
    const ua = String(req.headers['user-agent'] || '');
    if (isBot(ua)) return;
    const path = cleanPath(body.p);
    const { page, item } = pageOf(path, Boolean(body.nf));
    const utm = Object.fromEntries(['source', 'medium', 'campaign'].map(key => [key, text(body.u?.[key], 80).toLowerCase()]).filter(([, value]) => value));
    const ref = referrerOf(body.r);
    const timezone = text(body.z, 60);
    const now = new Date();
    await db.analytics.addView({
      id, at: now, lastSeen: now,
      path, page, item, title: text(body.ti, 140),
      session: ID.test(String(body.s)) ? String(body.s) : id,
      visitor: await visitorId(ip, ua),
      entry: Boolean(body.en), isNew: body.n === 1 ? true : body.n === 0 ? false : null,
      ref: ref.host, refUrl: ref.url, channel: body.en ? channelOf(ref.host, utm) : '', utm,
      country: countryOf(req, timezone), timezone,
      device: deviceOf(ua, Number(body.w) || 0, Boolean(body.tc)), browser: browserOf(ua), os: osOf(ua),
      lang: text(body.l, 12).split('-')[0].toLowerCase(),
      duration: 0, scroll: 0
    });
    return;
  }

  if (body.t === 'p') {
    const duration = Math.max(0, Math.round(Number(body.d) || 0));
    const scroll = Math.max(0, Math.min(100, Math.round(Number(body.sc) || 0)));
    await db.analytics.touchView(id, { duration, scroll });
    return;
  }

  if (body.t === 'e' && EVENTS.has(body.n)) {
    const view = await db.analytics.viewInfo(id);
    if (!view) return; // actions only count for page views we know about
    await db.analytics.addEvent({
      at: new Date(), name: body.n, label: text(body.l), target: text(body.x, 200),
      view: id, session: view.session, visitor: view.visitor, path: view.path, page: view.page, item: view.item,
      country: view.country, device: view.device
    });
  }
}

// ---------------------------------------------------------------- reports

const RANGES = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
const LEADS = ['whatsapp', 'call', 'email', 'enquiry'];
const countryName = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return code => { try { return code ? names.of(code) : 'Unknown'; } catch { return code; } };
})();
const languageName = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  return code => { try { return code ? names.of(code) : 'Unknown'; } catch { return code; } };
})();

function period(range) {
  const days = RANGES[range] || 30;
  const today = zoned(new Date()).day;
  const firstDay = addDays(today, -(days - 1));
  const from = startOfDay(firstDay);
  const to = startOfDay(addDays(today, 1));
  const previousFrom = startOfDay(addDays(firstDay, -days));
  const unit = days === 1 ? 'hour' : days > 120 ? 'month' : 'day';
  const buckets = [];
  if (unit === 'hour') for (let hour = 0; hour < 24; hour++) buckets.push(String(hour));
  else if (unit === 'day') for (let i = 0; i < days; i++) buckets.push(addDays(firstDay, i));
  else for (let i = 0; i < days; i += 1) { const month = addDays(firstDay, i).slice(0, 7); if (buckets.at(-1) !== month) buckets.push(month); }
  return { range: RANGES[range] ? range : '30d', days, from, to, previousFrom, unit, buckets };
}

const uniq = (items, key) => new Set(items.map(item => item[key])).size;
const avg = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined || key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}
// [{ key, label, visitors, … }] sorted by visitors, limited.
function breakdown(views, keyOf, labelOf = key => key || 'Unknown', limit = 30) {
  return [...groupBy(views, keyOf)].map(([key, items]) => ({ key, label: labelOf(key), visitors: uniq(items, 'visitor'), views: items.length }))
    .sort((a, b) => b.visitors - a.visitors || b.views - a.views).slice(0, limit);
}
const shortTitle = title => String(title || '').split(/ — | \| /)[0].trim();

function summarise(views, events) {
  const sessions = groupBy(views, view => view.session);
  const engagedSessions = new Set(events.map(event => event.session));
  const sessionTimes = [...sessions.values()].map(items => items.reduce((sum, view) => sum + (view.duration || 0), 0));
  const bounces = [...sessions].filter(([id, items]) => items.length === 1 && !engagedSessions.has(id) && (items[0].duration || 0) < 30).length;
  const leadSessions = new Set(events.filter(event => LEADS.includes(event.name)).map(event => event.session));
  const timed = views.filter(view => view.duration > 0).map(view => view.duration);
  return {
    visitors: uniq(views, 'visitor'),
    visits: sessions.size,
    pageviews: views.length,
    viewsPerVisit: sessions.size ? views.length / sessions.size : 0,
    bounceRate: sessions.size ? bounces / sessions.size : 0,
    visitDuration: avg(sessionTimes),
    timeOnPage: avg(timed),
    leads: events.filter(event => LEADS.includes(event.name)).length,
    conversionRate: sessions.size ? leadSessions.size / sessions.size : 0
  };
}

export async function report(range) {
  const p = period(range);
  const [allViews, allEvents, live, recent] = await Promise.all([
    db.analytics.views(p.previousFrom, p.to, true),
    db.analytics.events(p.previousFrom, p.to),
    db.analytics.activeSince(new Date(Date.now() - 5 * 60_000)),
    db.analytics.recent(30)
  ]);
  const current = item => item.at >= p.from;
  const viewsAll = allViews.filter(current);
  const views = viewsAll.filter(view => view.page !== '404');
  const events = allEvents.filter(current);
  const previousViews = allViews.filter(item => !current(item) && item.page !== '404');
  const previousEvents = allEvents.filter(item => !current(item));
  const bucketOf = date => { const z = zoned(date); return p.unit === 'hour' ? String(z.hour) : p.unit === 'day' ? z.day : z.month; };

  // Time series
  const byBucket = groupBy(views, view => bucketOf(view.at));
  const leadsByBucket = groupBy(events.filter(event => LEADS.includes(event.name)), event => bucketOf(event.at));
  const series = p.buckets.map(bucket => {
    const items = byBucket.get(bucket) || [];
    return { bucket, visitors: uniq(items, 'visitor'), pageviews: items.length, leads: (leadsByBucket.get(bucket) || []).length };
  });

  // Pages
  const titles = new Map();
  for (const view of [...viewsAll].sort((a, b) => a.at - b.at)) if (view.title) titles.set(view.path, view.title);
  const pageStats = items => ({
    views: items.length,
    visitors: uniq(items, 'visitor'),
    time: avg(items.filter(view => view.duration > 0).map(view => view.duration)),
    scroll: avg(items.filter(view => view.scroll > 0).map(view => view.scroll))
  });
  const pages = [...groupBy(views, view => view.path)].map(([path, items]) => ({ path, page: items[0].page, title: titles.get(path) || '', ...pageStats(items) }))
    .sort((a, b) => b.views - a.views);
  const sections = [...groupBy(views, view => view.page)].map(([page, items]) => ({ page, ...pageStats(items) })).sort((a, b) => b.views - a.views);

  const eventCount = (items, name) => items.filter(event => event.name === name).length;

  // Gallery photos opened and videos played (home gallery, programme videos, Stories of Hope)
  const media = breakdown(events.filter(event => event.name === 'media_open' || event.name === 'video_play'),
    event => { const label = event.label || 'Untitled'; return event.name === 'video_play' && !/video/i.test(label) ? `${label} (video)` : label; }, key => key, 20)
    .map(({ label, views: count, visitors }) => ({ label, count, people: visitors }));

  // Solar plans and home-page programmes: what people looked at and clicked
  const interest = (seenName, clickName) => {
    const seen = groupBy(events.filter(event => event.name === seenName), event => event.label);
    const clicked = clickName ? groupBy(events.filter(event => event.name === clickName), event => event.label) : new Map();
    return [...new Set([...seen.keys(), ...clicked.keys()])].map(label => ({
      label, seen: (seen.get(label) || []).length, people: uniq(seen.get(label) || [], 'visitor'), clicks: (clicked.get(label) || []).length
    })).sort((a, b) => b.seen - a.seen || b.clicks - a.clicks);
  };
  const plans = interest('plan_view', 'plan_click');
  const programmes = interest('programme_view', null);

  // Sources (first page of each visit)
  const entries = views.filter(view => view.entry);
  const visitsOf = items => new Set(items.map(item => item.session)).size;
  const sourceRows = (keyOf, labelOf = key => key) => [...groupBy(entries, keyOf)].map(([key, items]) => ({ label: labelOf(key), visits: visitsOf(items), visitors: uniq(items, 'visitor') }))
    .sort((a, b) => b.visits - a.visits).slice(0, 30);
  const channels = sourceRows(view => view.channel || 'Direct');
  const referrers = sourceRows(view => view.ref || undefined);
  const campaigns = sourceRows(view => (view.utm?.source || view.utm?.campaign) ? [view.utm.source, view.utm.medium, view.utm.campaign].filter(Boolean).join(' / ') : undefined);

  // Entry and exit pages
  const sessionViews = groupBy(views, view => view.session);
  const entryPages = breakdown([...sessionViews.values()].map(items => items.reduce((a, b) => (a.at <= b.at ? a : b))), view => view.path, key => key, 15);
  const exitPages = breakdown([...sessionViews.values()].map(items => items.reduce((a, b) => (a.at >= b.at ? a : b))), view => view.path, key => key, 15);

  // Audience
  const audience = {
    countries: breakdown(views, view => view.country, countryName),
    devices: breakdown(views, view => view.device),
    browsers: breakdown(views, view => view.browser),
    os: breakdown(views, view => view.os),
    languages: breakdown(views, view => view.lang, languageName, 15),
    newVsReturning: breakdown(entries.filter(view => view.isNew !== null), view => (view.isNew ? 'New' : 'Returning'))
  };

  // When people visit (business time zone)
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
  for (const view of views) { const z = zoned(view.at); hours[z.hour]++; weekdays[z.weekday]++; }

  // Actions
  const actionCounts = items => Object.fromEntries([...EVENTS].map(name => [name, eventCount(items, name)]));
  const labelled = (name, labelOf = event => event.label || 'Unlabelled') => breakdown(events.filter(event => event.name === name), labelOf, key => key, 15)
    .map(({ label, views: count, visitors }) => ({ label, count, people: visitors }));
  const pageLabel = event => titles.get(event.path) ? `${shortTitle(titles.get(event.path))} (${event.path})` : event.path;
  const actions = {
    current: actionCounts(events),
    previous: actionCounts(previousEvents),
    whatsappFrom: labelled('whatsapp', pageLabel),
    contactFrom: labelled('contact_click'),
    quoteFrom: labelled('quote_click'),
    enquiryTopics: labelled('enquiry'),
    outbound: labelled('outbound'),
    filters: labelled('gallery_filter')
  };

  // Broken links
  const notFound = [...groupBy(viewsAll.filter(view => view.page === '404'), view => view.path)]
    .map(([path, items]) => ({ path, views: items.length, from: [...new Set(items.map(view => view.ref).filter(Boolean))].slice(0, 3).join(', ') }))
    .sort((a, b) => b.views - a.views).slice(0, 20);

  const describe = view => ({
    at: view.at, path: view.path, page: view.page, item: view.item, country: view.country, countryName: countryName(view.country),
    device: view.device, browser: view.browser, os: view.os, source: view.entry ? (view.ref || view.channel || 'Direct') : '', duration: view.duration
  });
  const liveVisitors = groupBy(live, view => view.visitor);

  return {
    range: p.range, unit: p.unit, timezone: TZ, from: p.from, to: p.to,
    summary: summarise(views, events), previous: summarise(previousViews, previousEvents),
    series, sections, pages: pages.slice(0, 50), media, plans, programmes,
    sources: { channels, referrers, campaigns }, entryPages, exitPages,
    audience, hours, weekdays, actions, notFound,
    live: { visitors: liveVisitors.size, pages: breakdown(live, view => view.path, key => key, 10) },
    recent: recent.map(describe),
    total: await db.analytics.count()
  };
}

// All page views in a range as CSV (for spreadsheets).
export async function exportCsv(range) {
  const p = period(range);
  const views = await db.analytics.views(p.from, p.to, true);
  const columns = ['time', 'path', 'page', 'title', 'visit', 'visitor', 'first_page_of_visit', 'new_visitor', 'source', 'channel', 'utm_source', 'utm_medium', 'utm_campaign', 'country', 'device', 'browser', 'os', 'language', 'seconds_on_page', 'scroll_percent'];
  const cell = value => { const s = String(value ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
  const rows = views.sort((a, b) => a.at - b.at).map(view => [
    view.at.toISOString(), view.path, view.page, view.title, view.session, view.visitor, view.entry ? 'yes' : '', view.isNew === null ? '' : view.isNew ? 'yes' : 'no',
    view.ref, view.channel, view.utm?.source, view.utm?.medium, view.utm?.campaign, countryName(view.country), view.device, view.browser, view.os, view.lang, view.duration, view.scroll
  ].map(cell).join(','));
  return { filename: `onegrid-analytics-${p.range}-${zoned(new Date()).day}.csv`, csv: [columns.join(','), ...rows].join('\n') + '\n' };
}
