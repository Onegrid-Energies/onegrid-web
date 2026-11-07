import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { render } from './scripts/cms/template.mjs';
import { PAGES, readContent } from './scripts/cms/content.mjs';
import { prepareShop, productJsonLd } from './scripts/cms/shop.mjs';
import { pageImage, preview } from './scripts/cms/social.mjs';

// src/index.html is the annotated template; content/*.json holds the text and
// images edited in the admin app (admin-app/). Together they produce index.html and one
// static document per route, plus one page per shop product (/shop/<slug>/).
const SITE_ORIGINS = ['https://onegridenergies.com', 'https://onegridenergies.org'];
const content = await readContent();
const template = await readFile('src/index.html', 'utf8');
const products = prepareShop(content);

// Per-page data: SEO (with the link-preview card, see scripts/cms/social.mjs) and intro video.
// The browser script uses it too when it updates the page's metadata.
const pageData = Object.fromEntries(PAGES.map(({ name }) => {
  const seo = content[name]?.seo ?? {};
  const card = preview(seo, pageImage(name, content, products));
  return [name, { seo: { ...seo, image: card.image, imageAlt: card.imageAlt }, intro: content[name]?.intro ?? {} }];
}));
const pageDataJson = JSON.stringify({ pages: pageData }).replace(/</g, '\\u003c');
const cmsDataTag = '<script type="application/json" id="cms-data">{}</script>';

if (!template.includes(cmsDataTag)) {
  throw new Error('Could not locate the cms-data script tag in src/index.html.');
}

// The product page template is filled with one product at a time (index.html shows the first).
const renderWith = product => render(template, { ...content, product: product ?? {} })
  .replace(cmsDataTag, cmsDataTag.replace('{}', pageDataJson));
const source = renderWith(products[0]);

function layout(document) {
  const firstPage = document.indexOf('<div class="page active" id="page-home">');
  const footer = document.indexOf('    <!-- ════════════════ FOOTER ══════════════════════════ -->');
  if (firstPage === -1 || footer === -1) {
    throw new Error('Could not locate the shared layout or page sections in index.html.');
  }
  return { header: document.slice(0, firstPage), footer: document.slice(footer) };
}

function pageMarkup(document, page) {
  const pageStart = document.indexOf(`<div class="page${page === 'home' ? ' active' : ''}" id="page-${page}">`);
  const pageEndMarker = `    <!-- /page-${page} -->`;
  const pageEnd = document.indexOf(pageEndMarker, pageStart);

  if (pageStart === -1 || pageEnd === -1) {
    throw new Error(`Could not locate the ${page} page section.`);
  }

  return document.slice(pageStart, pageEnd).replace(`class="page${page === 'home' ? ' active' : ''}"`, 'class="page active"');
}

// Pages without an intro video (the shop and products, unless one is set in the admin) start
// with the shared intro banner hidden: no flash of it, and its heading isn't a second <h1>.
const INTRO = '<section class="intro-video">';
const withoutIntro = document => document.replace(INTRO, '<section class="intro-video" hidden>');

const escapeAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function setPageMetadata(document, route, seo) {
  const url = `https://onegridenergies.com${route.path}`;
  const title = escapeAttribute(seo.title);
  const description = escapeAttribute(seo.description);
  let result = document
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(seo.title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${url}${b}`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${title}${b}`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${url}${b}`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${title}${b}`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${description}${b}`);
  if (seo.image) {
    const image = escapeAttribute(seo.image);
    const alt = escapeAttribute(seo.imageAlt || seo.title);
    result = result
      .replace(/(<meta\s+property="og:image"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${image}${b}`)
      .replace(/(<meta\s+property="og:image:alt"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${alt}${b}`)
      .replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${image}${b}`)
      .replace(/(<meta\s+name="twitter:image:alt"\s+content=")[^"]*("\s*\/>)/, (_, a, b) => `${a}${alt}${b}`);
  }
  for (const data of [].concat(seo.jsonLd || [])) {
    const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/^/gm, '      ').trim();
    result = result.replace('</head>', () => `    <script type="application/ld+json">\n      ${json}\n    </script>\n  </head>`);
  }
  return result;
}

// Breadcrumbs for search results: Home › Page (› Product).
function breadcrumbs(...trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((crumb, index) => ({
      '@type': 'ListItem', position: index + 1, name: crumb.name, item: `https://onegridenergies.com${crumb.path}`
    }))
  };
}

// index.html is what "/" serves (and what most shared links point to): give it the Home SEO and card.
const home = PAGES.find(route => route.name === 'home');
await writeFile('index.html', setPageMetadata(source, home, pageData.home.seo));

// Fixed pages (Home, About, …, Shop)
const site = layout(source);
await Promise.all(PAGES.map(async route => {
  const seo = { ...pageData[route.name].seo };
  if (route.name !== 'home') seo.jsonLd = breadcrumbs({ name: route.label, path: route.path });
  let document = setPageMetadata(`${site.header}${pageMarkup(source, route.name)}${site.footer}`, route, seo);
  if (route.name === 'shop' && !pageData.shop.intro?.video) document = withoutIntro(document);
  await mkdir(route.directory, { recursive: true });
  await writeFile(`${route.directory}/index.html`, document);
}));

// One page per product, and pages of removed products deleted.
await mkdir('shop', { recursive: true });
for (const product of products) {
  const route = { directory: `shop/${product.slug}`, path: product._url };
  const document = renderWith(product);
  const own = layout(document);
  const productSeo = { share_title: product.name, ...product.seo, title: product.seo?.title || `${product.name} | OneGrid Energies` };
  const card = preview(productSeo, product.image?.url ? { url: product.image.url, alt: product.image.alt, layout: 'product' } : null);
  const seo = {
    title: productSeo.title,
    description: product.seo?.description || product.summary || '',
    image: card.image,
    imageAlt: card.imageAlt,
    jsonLd: [
      productJsonLd(product, `https://onegridenergies.com${product._url}`),
      breadcrumbs({ name: 'Shop', path: '/shop/' }, { name: product.name, path: product._url })
    ]
  };
  await mkdir(route.directory, { recursive: true });
  await writeFile(`${route.directory}/index.html`, withoutIntro(setPageMetadata(`${own.header}${pageMarkup(document, 'product')}${own.footer}`, route, seo)));
}
const slugs = new Set(products.map(product => product.slug));
for (const entry of await readdir('shop', { withFileTypes: true })) {
  if (entry.isDirectory() && !slugs.has(entry.name)) await rm(`shop/${entry.name}`, { recursive: true });
}

// Sitemap: every page and product, on each domain the site is published on.
const paths = [...PAGES.map(route => route.path), ...products.map(product => product._url)];
const urls = SITE_ORIGINS.flatMap(origin => paths.map(path => `${origin}${path}`))
  .sort((a, b) => paths.indexOf(new URL(a).pathname) - paths.indexOf(new URL(b).pathname));
await writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>\n    <loc>${url}</loc>\n  </url>`).join('\n')}
</urlset>
`);

console.log(`Generated index.html, ${PAGES.length} static route documents and ${products.length} product page${products.length === 1 ? '' : 's'}.`);
