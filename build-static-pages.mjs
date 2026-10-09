import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { render } from './scripts/cms/template.mjs';
import { PAGES, readContent } from './scripts/cms/content.mjs';

// src/index.html is the annotated template; content/*.json holds the text and
// images edited in the admin app (admin-app/). Together they produce index.html and one
// static document per route.
const content = await readContent();
const template = await readFile('src/index.html', 'utf8');

// Per-page data the browser script needs when switching pages (SEO and intro video).
const pageData = Object.fromEntries(PAGES.map(({ name }) => [name, {
  seo: content[name]?.seo ?? {},
  intro: content[name]?.intro ?? {}
}]));
const pageDataJson = JSON.stringify({ pages: pageData }).replace(/</g, '\\u003c');
const cmsDataTag = '<script type="application/json" id="cms-data">{}</script>';

if (!template.includes(cmsDataTag)) {
  throw new Error('Could not locate the cms-data script tag in src/index.html.');
}

const source = render(template, content).replace(cmsDataTag, cmsDataTag.replace('{}', pageDataJson));
await writeFile('index.html', source);

const firstPage = source.indexOf('<div class="page active" id="page-home">');
const footer = source.indexOf('    <!-- ════════════════ FOOTER ══════════════════════════ -->');

if (firstPage === -1 || footer === -1) {
  throw new Error('Could not locate the shared layout or page sections in index.html.');
}

const sharedHeader = source.slice(0, firstPage);
const sharedFooter = source.slice(footer);

function pageMarkup(page) {
  const pageStart = source.indexOf(`<div class="page${page === 'home' ? ' active' : ''}" id="page-${page}">`);
  const pageEndMarker = `    <!-- /page-${page} -->`;
  const pageEnd = source.indexOf(pageEndMarker, pageStart);

  if (pageStart === -1 || pageEnd === -1) {
    throw new Error(`Could not locate the ${page} page section.`);
  }

  return source.slice(pageStart, pageEnd).replace(`class="page${page === 'home' ? ' active' : ''}"`, 'class="page active"');
}

const escapeAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function setPageMetadata(document, route, seo) {
  const url = `https://onegridenergies.com${route.path}`;
  const title = escapeAttribute(seo.title);
  const description = escapeAttribute(seo.description);
  return document
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(seo.title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${url}${b}`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${title}${b}`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${url}${b}`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${title}${b}`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`);
}

await Promise.all(PAGES.map(async route => {
  const document = setPageMetadata(`${sharedHeader}${pageMarkup(route.name)}${sharedFooter}`, route, pageData[route.name].seo);
  await mkdir(route.directory, { recursive: true });
  await writeFile(`${route.directory}/index.html`, document);
}));

console.log(`Generated index.html and ${PAGES.length} static route documents.`);
