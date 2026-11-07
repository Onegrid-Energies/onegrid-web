// The shop: categories and products live in content/shop.json. The build adds the values the
// pages show but nobody types in (keys starting with "_"): links, the formatted price, the
// order button and its WhatsApp message.
//
// Prices: "price": null shows "Price coming soon" and an "Ask about availability" button.
// Setting a number (e.g. "price": 25000) shows ₦25,000 (and "compare_at_price", if set, struck
// through) with an "Order on WhatsApp" button whose message includes the name and price.

import { cloudinaryImage } from './template.mjs';

const DEFAULT_WHATSAPP = 'https://wa.me/2347015613314';

export const slugify = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// null, "" and anything that isn't a positive number mean "no price yet".
export function priceOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

// ₦2,800,000 — the same style as the solar plans.
export const formatNaira = amount => `₦${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// Same encoding as the solar plan links (spaces as %20, brackets encoded).
const encodeMessage = text => encodeURIComponent(text).replace(/[()']/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const fill = (template, values) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

// Adds the computed values to every category and product (in place) and returns the products.
export function prepareShop(content) {
  const shop = content.shop;
  if (!shop) return [];
  const whatsapp = String(content.site?.contact?.whatsapp_link || DEFAULT_WHATSAPP).split('?')[0];
  const products = [];
  const slugs = new Set();

  for (const category of shop.categories || []) {
    category.slug = category.slug || slugify(category.name);
    for (const product of category.products || []) {
      const slug = product.slug || slugify(product.name);
      if (!slug) throw new Error('Every product in content/shop.json needs a name or slug.');
      if (slugs.has(slug)) throw new Error(`Two products in content/shop.json use the slug "${slug}".`);
      slugs.add(slug);

      const price = priceOf(product.price);
      const compare = price ? priceOf(product.compare_at_price) : null;
      const priceText = price ? formatNaira(price) : '';
      const message = price
        ? fill(product.order_message || 'Hello OneGrid Energies, I am interested in the {name} priced at {price}. Please share the next steps.', { name: product.name, price: priceText })
        : fill(product.availability_message || 'Hello OneGrid Energies, I am interested in the {name}. Please let me know when it is available and the price.', { name: product.name });

      Object.assign(product, {
        slug,
        _url: `/shop/${slug}/`,
        _details_label: `View details of the ${product.name}`,
        _price: price,
        _price_text: priceText,
        _compare_text: compare && compare > price ? formatNaira(compare) : '',
        _price_pending: price ? '' : (product.price_pending_label || 'Price coming soon'),
        _order_label: price ? 'Order on WhatsApp' : 'Ask about availability',
        _order_link: `${whatsapp}?text=${encodeMessage(message)}`
      });
      products.push({ ...product, category: category.name });
    }
  }
  return products;
}

// Product structured data; prices are only included once one is set.
export function productJsonLd(product, url) {
  const images = [product.image, product.story?.image, product.local?.image, product.repair?.image]
    .map(image => image?.url).filter(Boolean).map(src => cloudinaryImage(src, 1200));
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.seo?.description || product.summary || '',
    image: images,
    url,
    category: product.category,
    brand: { '@type': 'Brand', name: 'OneGrid Energies' },
    manufacturer: { '@id': 'https://onegridenergies.com/#organization' }
  };
  if (product._price) {
    data.offers = {
      '@type': 'Offer',
      url,
      price: String(product._price),
      priceCurrency: 'NGN',
      seller: { '@id': 'https://onegridenergies.com/#organization' }
    };
  }
  return data;
}
