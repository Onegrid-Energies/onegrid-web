# OneGrid Energies website

A static website with a separate content admin (`admin-app/`, hosted on Render). Staff edit page
text, photos, lists and contact details in the browser; every save rebuilds the static pages
automatically. Each public route has its own folder and `index.html`, so the site works on hosts
such as Namecheap with no server and no rewrites.

```
Editor saves in the admin app ──► content/*.json committed to GitHub
                               ──► "Build site" GitHub Action runs npm run build
                               ──► generated pages committed (and uploaded over FTP if set up)
```

- **Website content** lives as JSON files in `content/` in this repository (full history in Git).
- **The admin's own data** — team, login links, rate limits, activity log — lives in MongoDB Atlas.

## Editing content (admin app)

Open the admin app (e.g. `https://admin.onegridenergies.com`) and sign in with Google, an emailed
link or your password.

| In the admin        | Changes                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| **Pages**           | Text, photos and lists on Home, About, OnePlastic, Stories of Hope, Recognitions, Quote and Contact, plus each page's search title/description and intro video |
| **Site settings**   | Phone, email, address, WhatsApp link, map, social links and the footer (shown on every page) |
| **Team / Activity** | (owners) who can sign in, and a log of recent changes                           |

- **Highlighted words:** in headings that have them, wrap words in `*asterisks*` to show them in
  yellow, e.g. `We Can *Reduce* Darkness.`; press Enter for a line break.
- **Lists** (gallery, partners, impact figures, recognitions, solar plans, FAQ, reviews…) can be
  added to, reordered and removed.
- **Photos and videos:** **Upload…** sends files straight to Cloudinary, or paste an existing
  Cloudinary link.
- **Publishing:** click **Save & publish**. The live site updates once the build (and deploy)
  finish, usually within a few minutes.

Setup and deployment: [admin-app/README.md](admin-app/README.md). The fields editors see are defined
in `admin-app/schema.yml`, which is generated from the template (see below).

## One-time setup

- **GitHub Actions** — in the repo: *Settings → Actions → General → Workflow permissions* →
  **Read and write permissions**, so the "Build site" workflow can commit the generated pages.
- **Deployment** — to upload the rebuilt pages to Namecheap automatically, add the repository
  secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` and optionally `FTP_SERVER_DIR`
  (e.g. `public_html/`). Without them, deploy the generated files the way you do today.
- **Admin app** — deploy it on Render and connect MongoDB Atlas, GitHub, and optionally Google,
  Brevo and Cloudinary: see [admin-app/README.md](admin-app/README.md).

## How the site is built

| Path | What it is |
| --- | --- |
| `src/index.html` | The design: every page as `<div class="page" id="page-…">`, with editable elements marked by `data-cms-*` attributes. Not a public page. |
| `content/*.json` | The content: one file per page plus `site.json` (contact details, social links, footer). Normally edited via the admin. |
| `build-static-pages.mjs` | Fills the template with the content and writes `index.html` and the route folders. |
| `scripts/cms/` | The template engine (`template.mjs`), plus the scripts that seed content and generate the admin schema. |
| `admin-app/` | The content admin (Node.js, for Render). |

`index.html` and the route folders (`home`, `about`, `oneplastic`, `stories-of-hope`,
`recognitions`, `quote`, `contact`) are generated — edit `src/index.html` or `content/*.json`
instead.

```bash
npm install
npm run build        # generate pages, then refresh hashed asset names (cache_burster.sh)
```

The GitHub Action in `.github/workflows/build.yml` runs the same build on every push to `master`
and commits the result.

## Changing the layout or adding editable fields

1. Edit `src/index.html`. To make something editable, add an annotation (the full list is
   documented at the top of `scripts/cms/template.mjs`), e.g.

   ```html
   <h2 data-cms="partners.title">Building Brighter Futures Together</h2>
   <img data-cms-attr="src:story.photo; alt:story.photo_alt" … />
   <div data-cms-list="faq.items"> … first child is the item template … </div>
   ```

2. `npm run cms:extract` copies the new values from the template into `content/*.json` (existing
   content is never overwritten).
3. `npm run cms:schema` regenerates `admin-app/schema.yml` so the new fields appear in the admin;
   redeploy the admin app.
4. `npm run build`.

To try the admin locally against this checkout (no GitHub or MongoDB needed), see *Local
development* in [admin-app/README.md](admin-app/README.md).
