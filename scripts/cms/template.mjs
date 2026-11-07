// Content annotations for src/index.html.
//
// The template is ordinary HTML. Editable pieces are marked with data-cms-*
// attributes; the build replaces their contents with values from content/*.json
// and strips the annotations from the output. Everything that is not annotated
// is copied through byte-for-byte.
//
//   data-cms-scope="home"            content file (content/home.json) used below this element
//   data-cms="hero.title"            element inner HTML ("\n" in content becomes <br />)
//   data-cms-text="label"            only the element's own text, keeping icons/child elements
//   data-cms-attr="src:image; alt:alt"
//                                    attribute values; "bg" sets the url() inside style and
//                                    "css.width" one property of the style attribute
//   data-cms-mod="layout:wide tall"  modifier classes, stored as a list of the ones applied
//   data-cms-list="items"            repeating children; the first child is the item template
//     data-cms-static                child of a list that is kept as-is (e.g. a placeholder option)
//     data-cms-stagger="4"           re-number reveal-delay-N classes on the items
//     data-cms-duplicate             render the items twice, the copy hidden (marquee loops)
//   data-cms-highlight               with data-cms: *words* in content become the template's
//                                    first <span …>words</span> (e.g. the yellow word in a heading)
//   data-cms-img="hero_image"        an <img> from { url, width, height, alt }: optimised Cloudinary
//                                    src/srcset (widths in data-cms-img-widths, default 400,800,1200),
//                                    width/height to prevent layout shift, and alt text
//   data-cms-optional[="key"]        drop the element when the value (or key) is empty
//   data-cms-label / -hint / -widget / -options
//                                    admin field label, help text, widget and select options
//
// Keys are dotted paths relative to the current content object (the scope root,
// or the list item). Prefix with "site:" to read from another file, e.g.
// data-cms="site:contact.phone". Keys whose last part starts with "_" (e.g. "_price_text")
// are worked out by the build (see build-static-pages.mjs): they are never seeded into
// content/*.json or shown in the admin.

import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';

// parse5 reports exact source offsets for every tag, which lets the build
// splice values into the template without reformatting anything else.
export function parseTemplate(html) {
  return parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
}

const isElement = node => node.type === 'tag';
const has = (el, name) => Object.prototype.hasOwnProperty.call(el.attribs, name);
const ANNOTATION = /\s+data-cms(?:-[\w-]+)?(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g;

// ── source positions ─────────────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Offsets of an element: start (first "<"), tagEnd ("> " of the start tag),
// inner [from, to) and end (exclusive).
function ranges(html, el) {
  const { startTag, endTag, startOffset, endOffset } = el.sourceCodeLocation;
  const tagEnd = startTag.endOffset - 1;
  if (!endTag) {
    if (VOID.has(el.name) || html[tagEnd - 1] === '/') return { start: startOffset, tagEnd, inner: null, end: startTag.endOffset };
    throw new Error(`<${el.name}> at ${lineOf(html, startOffset)} has no explicit closing tag`);
  }
  return { start: startOffset, tagEnd, inner: [startTag.endOffset, endTag.startOffset], end: endOffset };
}

const nodeStart = node => node.sourceCodeLocation.startOffset;
const nodeEnd = node => node.sourceCodeLocation.endOffset;

function lineOf(html, index) {
  return `line ${html.slice(0, index).split('\n').length}`;
}

// ── content paths ────────────────────────────────────────────────────────────

function locate(ctx, key) {
  const colon = key.indexOf(':');
  if (colon !== -1) {
    const scope = key.slice(0, colon);
    ctx.files[scope] ??= {};
    return { base: ctx.files[scope], path: key.slice(colon + 1) };
  }
  return { base: ctx.data, path: key };
}

const isComputed = key => /(^|[.:])_[^.:]*$/.test(key);

function lookup(ctx, key) {
  const { base, path } = locate(ctx, key);
  return path.split('.').reduce((value, part) => (value == null ? undefined : value[part]), base);
}

function assign(ctx, key, value) {
  if (isComputed(key)) return;
  const { base, path } = locate(ctx, key);
  const parts = path.split('.');
  const last = parts.pop();
  let target = base;
  for (const part of parts) target = target[part] ??= {};
  if (!(last in target)) target[last] = value;
}

const isEmpty = value => value == null || value === '' || (Array.isArray(value) && value.length === 0);

// "src:image; data-cat:category[select]" → [{ attr, key, widget }]
function parseAttrSpec(spec) {
  return spec.split(/[;,]/).map(part => part.trim()).filter(Boolean).map(part => {
    const colon = part.indexOf(':');
    const [, key, widget] = part.slice(colon + 1).trim().match(/^(.*?)(?:\[(\w+)\])?$/);
    return { attr: part.slice(0, colon).trim(), key, widget };
  });
}

function parseModSpec(spec) {
  const colon = spec.indexOf(':');
  return { key: spec.slice(0, colon).trim(), classes: spec.slice(colon + 1).trim().split(/\s+/) };
}

// ── value conversion ─────────────────────────────────────────────────────────

function htmlToValue(raw) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/ ?<br\s*\/?> ?/gi, '\n')
    .replace(/ (\/?>)/g, '$1')
    .replace(/&amp;/g, '&')
    .trim();
}

function valueToHtml(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/\n/g, '<br />');
}

// Highlighted words: editors write *words*; the page uses the template's own <span …>.
const SPAN = /<span\b[^>]*>([\s\S]*?)<\/span\s*>/g;
const spansToStars = raw => raw.replace(SPAN, '*$1*');
function starsToSpans(htmlValue, templateInner) {
  const open = (templateInner.match(/<span\b[^>]*>/) || ['<span>'])[0].replace(/\s+/g, ' ').replace(/ >$/, '>');
  return htmlValue.replace(/\*([^*\n]+)\*/g, `${open}$1</span>`);
}

const escapeAttr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setAttr(tag, name, value) {
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`);
  const quoted = `"${escapeAttr(value)}"`;
  if (pattern.test(tag)) return tag.replace(pattern, (_, prefix) => `${prefix}${quoted}`);
  return tag.replace(/\s*\/?>$/, end => ` ${name}=${quoted}${end}`);
}

const BG_URL = /url\(\s*(?:&quot;|"|')?(.*?)(?:&quot;|"|')?\s*\)/;

const cssProperty = name => new RegExp(`(^|;)(\\s*${escapeRegExp(name)}\\s*:\\s*)([^;]*)`);

function readAttr(el, attr) {
  const style = el.attribs.style || '';
  if (attr === 'bg') return style.match(BG_URL)?.[1] ?? '';
  if (attr.startsWith('css.')) return style.match(cssProperty(attr.slice(4)))?.[3].trim() ?? '';
  return el.attribs[attr] ?? '';
}

function writeAttr(tag, el, attr, value) {
  const style = el.attribs.style || '';
  if (attr === 'bg') return setAttr(tag, 'style', style.replace(BG_URL, `url("${value ?? ''}")`));
  if (attr.startsWith('css.')) {
    return setAttr(tag, 'style', style.replace(cssProperty(attr.slice(4)), (_, start, prefix) => `${start}${prefix}${value ?? ''}`));
  }
  return setAttr(tag, attr, value);
}

// Cloudinary delivery URL with a transformation, e.g. f_auto,q_auto,w_800,c_limit.
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;
export function cloudinaryImage(url, width, extra = '') {
  const match = String(url || '').match(CLOUDINARY);
  if (!match) return url || '';
  const rest = match[2].replace(/^(?:[a-z]{1,3}_[^/]*\/)+(?=v\d+\/)/, ''); // drop transformations already there
  return `${match[1]}f_auto,q_auto,w_${width},c_limit${extra ? `,${extra}` : ''}/${rest}`;
}

function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${escapeRegExp(name)}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`), '');
}

function writeImage(tag, el, image) {
  const widths = String(el.attribs['data-cms-img-widths'] || '400,800,1200').split(',').map(Number).filter(Boolean);
  const url = image?.url || '';
  const natural = Number(image?.width) || 0;
  const usable = natural ? widths.filter(w => w < natural).concat(natural <= widths.at(-1) ? [natural] : []) : widths;
  const srcWidths = usable.length ? usable : widths;
  const isCloudinary = CLOUDINARY.test(url);
  tag = setAttr(tag, 'src', isCloudinary ? cloudinaryImage(url, Math.min(srcWidths.at(-1), Number(el.attribs['data-cms-img-src-width']) || Infinity)) : url);
  tag = isCloudinary && srcWidths.length > 1
    ? setAttr(tag, 'srcset', srcWidths.map(w => `${cloudinaryImage(url, w)} ${w}w`).join(', '))
    : removeAttr(tag, 'srcset');
  for (const attr of ['width', 'height']) {
    tag = Number(image?.[attr]) ? setAttr(tag, attr, String(Math.round(Number(image[attr])))) : removeAttr(tag, attr);
  }
  return setAttr(tag, 'alt', image?.alt || '');
}

function directText(el) {
  return el.children.filter(node => node.type === 'text').map(node => node.data).join(' ');
}

// ── rendering ────────────────────────────────────────────────────────────────

export function render(html, files) {
  const doc = parseTemplate(html);
  const ctx = { files, data: {} };
  return renderNodes(html, doc.children, ctx, 0, html.length);
}

function renderNodes(html, nodes, ctx, from, to, textValue) {
  let out = '';
  let pos = from;
  let textUsed = false;
  for (const node of nodes) {
    if (textValue !== undefined && node.type === 'text') {
      if (!node.data.trim()) continue;
      const [, lead, , trail] = node.data.match(/^(\s*)([\s\S]*?)(\s*)$/);
      out += html.slice(pos, nodeStart(node)) + (textUsed ? lead || trail : `${lead}${valueToHtml(textValue)}${trail}`);
      textUsed = true;
      pos = nodeEnd(node);
    } else if (isElement(node)) {
      out += html.slice(pos, nodeStart(node)) + renderElement(html, node, ctx);
      pos = nodeEnd(node);
    }
  }
  return out + html.slice(pos, to);
}

function renderElement(html, el, ctx, item) {
  const a = el.attribs;
  if (has(el, 'data-cms-scope')) {
    ctx.files[a['data-cms-scope']] ??= {};
    ctx = { ...ctx, data: ctx.files[a['data-cms-scope']] };
  }
  if (has(el, 'data-cms-optional')) {
    const key = a['data-cms-optional'] || a['data-cms'] || a['data-cms-text'];
    if (isEmpty(lookup(ctx, key))) return '';
  }

  const { start, tagEnd, inner, end } = ranges(html, el);
  let tag = html.slice(start, tagEnd + 1);

  if (a['data-cms-attr']) {
    for (const { attr, key } of parseAttrSpec(a['data-cms-attr'])) tag = writeAttr(tag, el, attr, lookup(ctx, key));
  }
  if (a['data-cms-img']) tag = writeImage(tag, el, lookup(ctx, a['data-cms-img']));
  if (a['data-cms-mod'] || item?.stagger) {
    let classes = (a.class || '').split(/\s+/).filter(Boolean);
    if (a['data-cms-mod']) {
      const { key, classes: allowed } = parseModSpec(a['data-cms-mod']);
      const selected = [].concat(lookup(ctx, key) ?? []).filter(cls => allowed.includes(cls));
      classes = classes.filter(cls => !allowed.includes(cls)).concat(selected);
    }
    if (item?.stagger) {
      classes = classes.filter(cls => !/^reveal-delay-\d+$/.test(cls));
      if (item.index % item.stagger) classes.push(`reveal-delay-${item.index % item.stagger}`);
    }
    tag = setAttr(tag, 'class', classes.join(' '));
  }
  if (item?.hidden) {
    if (el.name === 'img') tag = setAttr(tag, 'alt', '');
    tag = setAttr(tag, 'aria-hidden', 'true');
  }
  tag = tag.replace(ANNOTATION, '');

  if (!inner) return tag;
  const close = html.slice(inner[1], end);
  let body;
  if (has(el, 'data-cms')) {
    body = valueToHtml(lookup(ctx, a['data-cms']));
    if (has(el, 'data-cms-highlight')) body = starsToSpans(body, html.slice(inner[0], inner[1]));
  }
  else if (has(el, 'data-cms-text')) body = renderNodes(html, el.children, ctx, inner[0], inner[1], lookup(ctx, a['data-cms-text']) ?? '');
  else if (has(el, 'data-cms-list')) body = renderList(html, el, ctx, inner);
  else body = renderNodes(html, el.children, ctx, inner[0], inner[1]);
  return tag + body + close;
}

function renderList(html, el, ctx, [innerStart, innerEnd]) {
  const children = el.children.filter(isElement);
  const statics = children.filter(child => has(child, 'data-cms-static'));
  const items = children.filter(child => !has(child, 'data-cms-static'));
  if (!items.length) throw new Error(`List "${el.attribs['data-cms-list']}" has no item template`);

  const first = children[0];
  const last = children[children.length - 1];
  const lead = html.slice(innerStart, nodeStart(first));
  const between = items.length > 1 ? html.slice(nodeEnd(items[0]), nodeStart(items[1])) : '';
  const separator = between && !between.trim() ? between : lead;
  const trail = html.slice(nodeEnd(last), innerEnd);

  const data = [].concat(lookup(ctx, el.attribs['data-cms-list']) ?? []);
  const stagger = Number(el.attribs['data-cms-stagger']) || 0;
  const renderItems = hidden => data.map((value, index) => renderElement(
    html, items[0], { ...ctx, data: value ?? {} }, { index, stagger, hidden }
  ));

  const before = statics.filter(child => nodeStart(child) < nodeStart(items[0]));
  const after = statics.filter(child => nodeStart(child) > nodeStart(items[0]));
  const parts = [
    ...before.map(child => renderElement(html, child, ctx)),
    ...renderItems(false),
    ...(has(el, 'data-cms-duplicate') ? renderItems(true) : []),
    ...after.map(child => renderElement(html, child, ctx))
  ];
  return lead + parts.join(separator) + trail;
}

// ── extraction (template → content) ─────────────────────────────────────────

export function extract(html) {
  const doc = parseTemplate(html);
  const ctx = { files: {}, data: {} };
  extractNodes(html, doc.children, ctx);
  return ctx.files;
}

function extractNodes(html, nodes, ctx) {
  for (const node of nodes) if (isElement(node)) extractElement(html, node, ctx);
}

function extractElement(html, el, ctx) {
  const a = el.attribs;
  if (has(el, 'data-cms-scope')) {
    ctx.files[a['data-cms-scope']] ??= {};
    ctx = { ...ctx, data: ctx.files[a['data-cms-scope']] };
  }
  if (a['data-cms-attr']) {
    for (const { attr, key } of parseAttrSpec(a['data-cms-attr'])) assign(ctx, key, readAttr(el, attr));
  }
  if (a['data-cms-mod']) {
    const { key, classes } = parseModSpec(a['data-cms-mod']);
    const present = (a.class || '').split(/\s+/);
    assign(ctx, key, classes.filter(cls => present.includes(cls)));
  }
  if (a['data-cms-img']) {
    assign(ctx, a['data-cms-img'], {
      url: a.src || '', width: Number(a.width) || null, height: Number(a.height) || null, alt: a.alt || ''
    });
  }
  if (has(el, 'data-cms')) {
    const { inner } = ranges(html, el);
    const raw = html.slice(inner[0], inner[1]);
    assign(ctx, a['data-cms'], htmlToValue(has(el, 'data-cms-highlight') ? spansToStars(raw) : raw));
  } else if (has(el, 'data-cms-text')) {
    assign(ctx, a['data-cms-text'], htmlToValue(directText(el)));
    extractNodes(html, el.children, ctx);
  } else if (has(el, 'data-cms-list')) {
    const children = el.children.filter(isElement);
    for (const child of children) if (has(child, 'data-cms-static')) extractElement(html, child, ctx);
    const items = children.filter(child => !has(child, 'data-cms-static'));
    const values = items.map(item => {
      const value = {};
      extractElement(html, item, { ...ctx, data: value });
      return value;
    });
    // Marquee loops repeat their items; keep only the first copy.
    const count = has(el, 'data-cms-duplicate') ? items.filter(item => item.attribs['aria-hidden'] !== 'true').length : values.length;
    assign(ctx, a['data-cms-list'], values.slice(0, count));
  } else {
    extractNodes(html, el.children, ctx);
  }
}

// ── schema (template → admin fields) ─────────────────────────────────────────

// Preferred fields for the one-line summary of each list item in the admin.
const SUMMARY_NAMES = ['title', 'name', 'question', 'label', 'caption', 'location', 'heading', 'text', 'quote', 'value'];
const IMAGE_ATTRS = new Set(['src', 'data-src', 'data-image', 'data-logo', 'data-bg', 'poster', 'bg']);

export function schema(html) {
  const doc = parseTemplate(html);
  const scopes = {};
  const ctx = { scopes, fields: null, scope: null };
  schemaNodes(html, doc.children, ctx);
  return scopes;
}

function schemaNodes(html, nodes, ctx) {
  for (const node of nodes) if (isElement(node)) schemaElement(html, node, ctx);
}

function humanize(key) {
  const name = key.split(/[.:]/).pop().replace(/[_-]+/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function addField(ctx, key, field) {
  let fields = ctx.fields;
  let path = key;
  const colon = key.indexOf(':');
  if (colon !== -1) {
    const scope = key.slice(0, colon);
    fields = ctx.scopes[scope] ??= [];
    path = key.slice(colon + 1);
  }
  if (!fields) throw new Error(`Annotation "${key}" is outside any data-cms-scope`);
  if (isComputed(key)) return;
  const parts = path.split('.');
  const name = parts.pop();
  for (const part of parts) {
    let group = fields.find(f => f.name === part);
    if (!group) {
      group = { name: part, label: humanize(part), widget: 'object', collapsed: true, fields: [] };
      fields.push(group);
    }
    fields = group.fields;
  }
  const existing = fields.find(f => f.name === name);
  if (existing) {
    // Same value shown in several places; for lists/objects shown twice (e.g. category chips and
    // category sections), offer the fields of both.
    if (existing.fields && field.fields) mergeFields(existing.fields, field.fields);
    return;
  }
  fields.push({ name, label: humanize(name), ...field });
}

export function mergeFields(target, extra) {
  for (const field of extra) {
    const existing = target.find(f => f.name === field.name);
    if (!existing) target.push(field);
    else if (existing.fields && field.fields) mergeFields(existing.fields, field.fields);
  }
  return target;
}

function fieldOptions(el, field) {
  const a = el.attribs;
  if (a['data-cms-label']) field.label = a['data-cms-label'];
  if (a['data-cms-hint']) field.hint = a['data-cms-hint'];
  if (a['data-cms-widget']) field.widget = a['data-cms-widget'];
  if (a['data-cms-options']) field.options = a['data-cms-options'].split(',').map(o => o.trim());
  if (has(el, 'data-cms-optional') || field.widget === 'image') field.required = false;
  return field;
}

function textWidget(html, raw) {
  const value = htmlToValue(raw);
  return value.includes('\n') || value.length > 90 ? 'text' : 'string';
}

function schemaElement(html, el, ctx) {
  const a = el.attribs;
  if (has(el, 'data-cms-scope')) {
    ctx = { ...ctx, fields: ctx.scopes[a['data-cms-scope']] ??= [] };
  }
  if (a['data-cms-attr']) {
    for (const { attr, key, widget } of parseAttrSpec(a['data-cms-attr'])) {
      const field = { widget: widget || (IMAGE_ATTRS.has(attr) ? 'image' : 'string') };
      if (field.widget === 'image') field.required = false;
      if (field.widget === 'select' && a['data-cms-options']) field.options = a['data-cms-options'].split(',').map(o => o.trim());
      if (attr === 'alt') { field.label = 'Image description (alt text)'; field.required = false; }
      if (/^aria-/.test(attr)) field.required = false;
      const ownsHint = !has(el, 'data-cms') && !has(el, 'data-cms-text') && !has(el, 'data-cms-list');
      if (ownsHint && a['data-cms-hint'] && !/^(aria-|alt$)/.test(attr)) field.hint = a['data-cms-hint'];
      if (ownsHint && a['data-cms-label'] && !/^(aria-|alt$)/.test(attr)) field.label = a['data-cms-label'];
      addField(ctx, key, field);
    }
  }
  if (a['data-cms-img']) {
    addField(ctx, a['data-cms-img'], {
      label: a['data-cms-label'] || humanize(a['data-cms-img']), widget: 'object', collapsed: true, required: false,
      fields: [
        { name: 'url', label: 'Image', widget: 'image', required: false, hint: 'Upload a photo or paste a Cloudinary link. The site serves resized copies automatically.' },
        { name: 'alt', label: 'Image description (alt text)', widget: 'string', required: false },
        { name: 'width', label: 'Original width (px)', widget: 'number', value_type: 'int', required: false, hint: 'Used to keep the layout steady while the image loads.' },
        { name: 'height', label: 'Original height (px)', widget: 'number', value_type: 'int', required: false }
      ]
    });
  }
  if (a['data-cms-mod']) {
    const { key, classes } = parseModSpec(a['data-cms-mod']);
    const options = classes.map(value => ({ label: humanize(value.split('--').pop()), value }));
    const field = { ...fieldOptions(el, { widget: 'select', multiple: true, required: false }), options };
    delete field.hint; // the element's hint describes its other fields (e.g. the video link)
    addField(ctx, key, field);
  }
  if (has(el, 'data-cms')) {
    const { inner } = ranges(html, el);
    addField(ctx, a['data-cms'], fieldOptions(el, { widget: textWidget(html, html.slice(inner[0], inner[1])) }));
  } else if (has(el, 'data-cms-text')) {
    addField(ctx, a['data-cms-text'], fieldOptions(el, { widget: textWidget(html, directText(el)) }));
    schemaNodes(html, el.children, ctx);
  } else if (has(el, 'data-cms-list')) {
    for (const child of el.children) if (isElement(child) && has(child, 'data-cms-static')) schemaElement(html, child, ctx);
    const template = el.children.find(child => isElement(child) && !has(child, 'data-cms-static'));
    const itemFields = [];
    schemaElement(html, template, { ...ctx, fields: itemFields });
    const list = fieldOptions(el, { widget: 'list', collapsed: true, fields: itemFields });
    const textFields = itemFields.filter(f => f.widget === 'string' || f.widget === 'text');
    const summaryField = SUMMARY_NAMES.map(name => textFields.find(f => f.name === name)).find(Boolean) ?? textFields[0];
    const groupField = itemFields.find(f => f.widget === 'select' && !f.multiple);
    if (summaryField) list.summary = `${groupField ? `{{fields.${groupField.name}}} · ` : ''}{{fields.${summaryField.name}}}`;
    addField(ctx, a['data-cms-list'], list);
  } else {
    schemaNodes(html, el.children, ctx);
  }
}
