# OneGrid WebAdmin (content admin app)

A small Node.js web app for editing the website content. Content is saved as `content/*.json`
files in the website's GitHub repository; every save triggers the "Build site" GitHub Action, so
the live site updates within a few minutes. The admin's own data is stored in **MongoDB Atlas**.

- **Sign-in:** Google, emailed sign-in links (via Brevo), or email + password.
- **Team:** owners add and remove people under **Team** (stored in MongoDB).
- **Activity:** owners see who saved, created or deleted what, and recent sign-ins (kept a year).
- **Uploads:** photos and videos go straight to Cloudinary using **signed** uploads (the Cloudinary
  secret stays on the server).
- **No silent overwrites:** if an item was saved by someone else since you opened it, your save is
  refused with a "reload" message instead of overwriting their change.
- Every save is a GitHub commit authored by the person who made it.
- **Logins are JWTs** (HS256, via the `jose` library) in an HttpOnly cookie. Each token type —
  login, emailed link, Google sign-in check — has its own audience, so one can't be used as another.
- The sections and fields editors see are defined in [`schema.yml`](schema.yml), which is generated
  from the annotations in `src/index.html` (`npm run cms:schema` in the repository root). Redeploy
  the app after regenerating it.

### What's stored where

| Data | Where |
| --- | --- |
| Website content (page text, photos, lists, contact details) | GitHub repository, `content/*.json` |
| Team (emails, names, roles, password hashes) | MongoDB `users` |
| Used emailed sign-in links (each works once) | MongoDB `login_links` (auto-deleted after expiry) |
| Sign-in attempt limits | MongoDB `rate_limits` (auto-deleted) |
| Activity log | MongoDB `activity` (auto-deleted after a year) |
| Website analytics (anonymous visits and actions) | MongoDB `analytics_views`, `analytics_events`, `analytics_salts` (auto-deleted after `ANALYTICS_RETENTION_DAYS`, default 2 years) |
| Settings changed in the app (which websites may send visits) | MongoDB `settings` |

## MongoDB Atlas

1. In [MongoDB Atlas](https://cloud.mongodb.com), create a cluster (the free **M0** tier is plenty)
   in a region near Render's (e.g. *Frankfurt* if Render runs in Frankfurt).
2. **Database Access → Add New Database User:** password authentication, a strong generated
   password, role **Read and write to any database** (or restrict it to the `onegrid_webadmin` database).
3. **Network Access → Add IP Address:** Render's outgoing addresses change, so allow
   `0.0.0.0/0` (access is still protected by the database user's password), or add your Render
   service's outbound IP addresses if your plan has fixed ones.
4. **Connect → Drivers → Node.js:** copy the connection string, replace `<password>` with the
   user's password, and put it in `MONGODB_URI`. The database (default name `onegrid_webadmin`) and its
   collections are created automatically on first start.

## Deploy on Render

1. **New → Web Service**, connect the `OneGrid-Energies/onegrid-web` repository.
2. Settings:
   | Setting         | Value               |
   | --------------- | ------------------- |
   | Root Directory  | `admin-app`         |
   | Runtime         | Node                |
   | Build Command   | `npm install`       |
   | Start Command   | `node server.js`    |
   | Health Check    | `/health`           |
3. Add the environment variables below, deploy, then (optionally) add a custom domain such as
   `admin.onegridenergies.com` and set `PUBLIC_URL` to it.

Render's free plan sleeps after ~15 minutes without visits, so the first visit afterwards takes
up to a minute. A paid instance stays awake.

### Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `JWT_SECRET` | yes | At least 32 random characters (e.g. `openssl rand -hex 32`). Signs the login JWTs and emailed links. Changing it signs everyone out. The older name `SESSION_SECRET` also works. |
| `MONGODB_URI` | yes | Your MongoDB Atlas connection string (see above). |
| `MONGODB_DB` | optional | Database name, default `onegrid_webadmin`. |
| `PUBLIC_URL` | yes | The app's address, e.g. `https://admin.onegridenergies.com` (no trailing slash). |
| `GITHUB_TOKEN` | yes | GitHub *fine-grained* token for `OneGrid-Energies/onegrid-web` with **Contents: Read and write**. |
| `OWNER_EMAILS` | yes | Comma-separated emails that are always owners (e.g. yours). |
| `OWNER_INITIAL_PASSWORD` | optional | Lets an owner sign in with a password the first time (they're asked to set their own). Remove it afterwards. |
| `GITHUB_REPO` / `GITHUB_BRANCH` | optional | Default `OneGrid-Energies/onegrid-web` / `master`. |
| `SITE_URL` | optional | Default `https://onegridenergies.com` (for "View on website" links). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | See below. |
| `BREVO_API_KEY`, `MAIL_FROM` | for emailed links & password resets | See below. |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | for uploads | Cloudinary → Settings → API Keys. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_FOLDER` | optional | Default `dj2ciluyx` / `onegrid`. |
| `ANALYTICS_TIMEZONE` | optional | Time zone for days and hours in Analytics. Default `Africa/Lagos`. |
| `ANALYTICS_RETENTION_DAYS` | optional | How long visit data is kept. Default `730` (two years). |
| `ANALYTICS_ORIGINS` | optional | Starting point for which websites may send visits, until an owner saves it on the Analytics page: empty = any website, or comma-separated addresses (plus `SITE_URL`). |

Sign-in methods appear automatically when their variables are set; password sign-in is always on.

### Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project, then
   *APIs & Services → OAuth consent screen* (External, app name "OneGrid WebAdmin").
2. *Credentials → Create credentials → OAuth client ID* → **Web application**.
   Authorised redirect URI: `<PUBLIC_URL>/auth/google/callback`.
3. Put the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Only people on the team (or in `OWNER_EMAILS`) can get in — signing in with any other Google
account shows "isn't on the team".

### Emailed sign-in links (Brevo)

1. In [Brevo](https://www.brevo.com), go to *Senders, Domains & Dedicated IPs → Domains*, add
   `onegridenergies.com` and add the DNS records it shows (DKIM, DMARC), so emails aren't marked
   as spam. Then add the sender address you'll use (e.g. `admin@onegridenergies.com`).
2. *SMTP & API → API Keys → Generate a new API key* → put it in `BREVO_API_KEY`.
3. Set `MAIL_FROM` to that sender, e.g. `OneGrid Admin <admin@onegridenergies.com>`.

Links work once and expire after 20 minutes.

## Website analytics

Owners see **Analytics** in the menu: visitors, visits, page views, time on page, how far people
scroll, where they came from (search, social, AI assistants, other sites, campaign links), countries,
devices and browsers, every page, and the actions that matter — WhatsApp taps (including which
solar plan was selected), forms sent, clicks to *Get a quote* and *Contact*, email taps, gallery
photos opened, videos played, and which solar plans and home-page programmes people looked at.
A CSV export is included.

To switch it on, open **Analytics → Connect the website** once. That saves this admin's address
(`PUBLIC_URL`) as `analytics_url` in `content/site.json`; the site rebuilds and its script starts
sending visits to `<PUBLIC_URL>/e`. Visits are anonymous: no cookies, no IP addresses stored; a
visitor is counted with a hash that changes daily.

Every copy of the website reports — e.g. `onegridenergies.com`, `onegridenergies.org` and a GitHub
Pages copy (sites served from a folder such as `/onegrid-web/` are understood) — and each visit
records which domain it was on. The Analytics page lists them under **Websites** and has a
**Website** picker to see one at a time (the CSV export follows it). Under **Which websites may
send visits**, owners choose *Any website* or *Only the websites listed* (`SITE_URL` is always
allowed); the choice is saved in MongoDB (`settings` collection) and applies straight away.
Websites turned away are listed under *Recently refused* with an **Allow** button. Country comes from
Cloudflare's `CF-IPCountry` header if the admin is behind Cloudflare, otherwise from the visitor's
time zone.

On Render's free plan the service sleeps when idle; the first visit after a sleep wakes it, so a
visit or two can be missed while it starts. A paid instance (or any always-on host) avoids that.

To stop counting your own visits, open the website once per browser with `?analytics=off`
(`?analytics=on` to undo).

## First sign-in

Sign in with Google or an emailed link using an `OWNER_EMAILS` address — or, if neither is set up
yet, with that email and `OWNER_INITIAL_PASSWORD`. Then add your staff under **Team**.

## Local development

```bash
cd admin-app
npm install
cp .env.example .env      # fill it in; CONTENT_BACKEND=local edits local files, and without
                          # MONGODB_URI an in-memory database is used (lost on restart)
node server.js            # loads .env automatically
```

Open http://localhost:3000. In local mode changes are written to the files in this checkout
(not GitHub) and emailed links are printed in the terminal. `.env.example` lists and explains every
setting. The app loads `admin-app/.env` automatically when it exists (like `dotenv.config()`, but
built into Node), and real environment variables take priority over it. `.env` is git-ignored, so
secrets never get committed. On Render, enter the settings in the Environment tab (its
"Add from .env" option accepts this file's contents).

## Running elsewhere

It's a plain Node.js (20.12+) app with three small dependencies (`jose`, `mongodb`, `yaml`), so it runs on any Node host or as a container
(`docker build -t onegrid-admin admin-app && docker run -p 3000:3000 --env-file admin-app/.env onegrid-admin`).
