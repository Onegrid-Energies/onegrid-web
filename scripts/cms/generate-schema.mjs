// Writes admin-app/schema.yml — the sections and fields editors see in the
// admin app — from the data-cms annotations in src/index.html. Run after
// changing annotations (then redeploy the admin app):
//
//   npm run cms:schema

import { readFile, writeFile } from 'node:fs/promises';
import { mergeFields, schema } from './template.mjs';
import { PAGES } from './content.mjs';

const SITE_URL = 'https://onegridenergies.com';

const template = await readFile('src/index.html', 'utf8');
const scopes = schema(template);

// Hints for fields whose purpose is not obvious from the page.
const FIELD_HINTS = {
  whatsapp_link: 'WhatsApp link the button opens, e.g. https://wa.me/2347015613314?text=Hello',
  plan_name: 'Used to pre-select the plan in the quote form; keep it identical to an entry in "Preferred plan options".',
  video_label: 'Read aloud by screen readers, e.g. "Watch OnePlastic video".',
  map_embed_url: 'Google Maps embed link (Share → Embed a map → copy the src value).',
  email_link: 'Usually mailto: followed by the email address.',
  icon: 'A symbol, emoji or SVG code shown with this item.'
};

const seoFields = {
  name: 'seo', label: 'Search & sharing', widget: 'object', collapsed: true, fields: [
    { name: 'title', label: 'Browser tab / search title', widget: 'string' },
    { name: 'description', label: 'Search description', widget: 'text', hint: 'About 150 characters, shown in search results and link previews.' }
  ]
};
const introFields = {
  name: 'intro', label: 'Intro video', widget: 'object', collapsed: true, fields: [
    { name: 'video', label: 'Video (MP4)', widget: 'file', hint: 'Upload a video, or paste a Cloudinary .mp4 link.' },
    { name: 'poster', label: 'Poster image', widget: 'image', hint: 'Shown while the video loads.' },
    { name: 'label', label: 'Label', widget: 'string' },
    { name: 'title', label: 'Title', widget: 'string' },
    { name: 'subtitle', label: 'Subtitle', widget: 'text' }
  ]
};

// The admin app treats fields as required unless told otherwise; most of this
// content may legitimately be empty, so fields are optional unless marked.
function finalize(fields) {
  return fields.map(field => {
    const result = { ...field };
    if (FIELD_HINTS[result.name] && !result.hint) result.hint = FIELD_HINTS[result.name];
    if (result.fields) result.fields = finalize(result.fields);
    else if (!('required' in result)) result.required = false;
    return result;
  });
}

// Shop products: the product page template (scope "product") is filled from each product in
// content/shop.json, so its fields belong to the products list, after the fields only the
// build uses (address, price, WhatsApp messages, search title).
const productBasics = [
  { name: 'name', label: 'Product name', widget: 'string' },
  { name: 'slug', label: 'Web address', widget: 'string', hint: 'The product page is at /shop/<this>/, e.g. oneplastic-lantern. Lowercase letters, numbers and dashes. Changing it changes the page address.' },
  { name: 'price', label: 'Price (₦)', widget: 'number', value_type: 'int', required: false, hint: 'Numbers only, e.g. 25000. Leave empty to show “Price coming soon” and an “Ask about availability” button.' },
  { name: 'compare_at_price', label: 'Old price (₦), crossed out', widget: 'number', value_type: 'int', required: false, hint: 'Optional. Only shown when it is higher than the price.' },
  { name: 'price_pending_label', label: 'Label while there is no price', widget: 'string', required: false },
  { name: 'availability_message', label: 'WhatsApp message while there is no price', widget: 'text', required: false, hint: 'Pre-filled when someone taps “Ask about availability”. {name} becomes the product name.' },
  { name: 'order_message', label: 'WhatsApp message with a price', widget: 'text', required: false, hint: 'Pre-filled when someone taps “Order on WhatsApp”. {name} and {price} are filled in.' },
  { name: 'seo', label: 'Search & sharing', widget: 'object', collapsed: true, fields: [
    { name: 'title', label: 'Browser tab / search title', widget: 'string', required: false },
    { name: 'description', label: 'Search description', widget: 'text', required: false, hint: 'About 150 characters, shown in search results and link previews.' }
  ] }
];
const categories = (scopes.shop ?? []).find(field => field.name === 'categories');
const productsField = categories?.fields.find(field => field.name === 'products');
if (productsField) {
  const fromPage = (scopes.product ?? []).filter(field => !productBasics.some(basic => basic.name === field.name));
  const fromCard = productsField.fields.filter(field => !productBasics.some(basic => basic.name === field.name));
  productsField.fields = mergeFields([...productBasics, ...fromCard], fromPage);
  productsField.label_singular = 'Product';
  categories.label_singular = 'Category';
  categories.fields = [
    { name: 'name', label: 'Category name', widget: 'string' },
    { name: 'slug', label: 'Short name for filters', widget: 'string', required: false, hint: 'Lowercase, e.g. lanterns. Leave empty to make it from the name.' },
    ...categories.fields.filter(field => !['name', 'slug'].includes(field.name))
  ];
}

function pageFields(name) {
  const fields = (scopes[name] ?? []).filter(field => field.name !== 'intro');
  return finalize([seoFields, introFields, ...fields]);
}

const config = {
  site_url: SITE_URL,
  collections: [
    {
      name: 'pages',
      label: 'Pages',
      label_singular: 'Page',
      description: 'Text, photos and lists on each page. Saved changes go live after the site rebuilds (a few minutes).',
      files: PAGES.map(page => ({
        name: page.name,
        label: page.label,
        file: `content/${page.name}.json`,
        fields: pageFields(page.name)
      }))
    },
    {
      name: 'settings',
      label: 'Site settings',
      description: 'Contact details, social links and the footer, shown on every page.',
      files: [{
        name: 'site',
        label: 'Contact details, social links & footer',
        file: 'content/site.json',
        // Advanced settings last.
        fields: finalize([...(scopes.site ?? [])].sort((a, b) => (a.name === 'analytics_url') - (b.name === 'analytics_url')))
      }]
    }
  ]
};

// ── minimal YAML writer (strings are JSON-quoted, which YAML accepts) ────────
function yaml(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return ' []';
    return value.map(item => {
      if (item && typeof item === 'object') {
        const body = yaml(item, `${indent}  `).replace(/^\n\s*/, '');
        return `\n${indent}- ${body}`;
      }
      return `\n${indent}- ${scalar(item)}`;
    }).join('');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === 'object') return `\n${indent}${key}:${yaml(item, `${indent}  `)}`;
      return `\n${indent}${key}: ${scalar(item)}`;
    }).join('');
  }
  return ` ${scalar(value)}`;
}

function scalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return /^[A-Za-z0-9_./-]+$/.test(value) && !/^(true|false|null|yes|no|on|off|\d.*)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

const header = `# Admin app: the content sections and the fields editors see.
# Generated by scripts/cms/generate-schema.mjs from the data-cms annotations in src/index.html —
# don't edit by hand; run \`npm run cms:schema\` instead. Changes apply after the app is redeployed.
`;
await writeFile('admin-app/schema.yml', `${header}\n${yaml(config).trimStart()}\n`);
console.log('Wrote admin-app/schema.yml');
