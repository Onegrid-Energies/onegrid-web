// Link previews (Facebook, WhatsApp, LinkedIn, X, Slack…): a branded 1200 × 630 card for every
// page, drawn by Cloudinary from a photo — darkened, with the OneGrid logo, the page's headline
// and the site address. Product pages use a dark card with the product photo on the right so the
// product isn't cropped. Images that aren't on Cloudinary are used as they are.
//
// Each page's photo and headline can be set in the admin (Search & sharing → Preview photo /
// Preview headline); otherwise a photo from the page's own content is used (see pageImage).

export const CARD = { width: 1200, height: 630, type: 'image/jpeg' };
export const DEFAULT_IMAGE = 'https://res.cloudinary.com/dj2ciluyx/image/upload/v1784564050/photo4_cof80h.jpg';
const LOGO = 'ONEGRID_WHITE_PNG_nhbudu';
const DOMAIN = 'onegridenergies.com';
// Cloudinary has no Manrope; Montserrat is the closest geometric face it offers.
const FONT = 'Montserrat';
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?:(?:[a-z]{1,3}_[^/]*)\/)*(v\d+\/.+)$/;

// Text for a Cloudinary text layer: URL-encoded, with commas and slashes encoded twice.
const text = value => encodeURIComponent(String(value).replace(/\s+/g, ' ').trim())
  .replace(/%2C/g, '%252C').replace(/%2F/g, '%252F');

// The headline on the card: the part of the page title that isn't just the brand name,
// e.g. "OneGrid Energies | Clean Energy That Reduces Darkness" → "Clean Energy That Reduces Darkness".
export function cardHeadline(seo = {}) {
  if (seo.share_title) return seo.share_title;
  const parts = String(seo.title || '').split(/\s+[|—–-]\s+/).map(part => part.trim()).filter(Boolean);
  return parts.find(part => !/^onegrid energies$/i.test(part)) || parts[0] || 'OneGrid Energies';
}

export function socialCard(imageUrl, headline, { layout = 'photo' } = {}) {
  const match = String(imageUrl || '').match(CLOUDINARY);
  if (!match) return imageUrl || DEFAULT_IMAGE;
  const [, base, rest] = match;
  const { width, height } = CARD;
  const title = text(headline);
  const steps = layout === 'product'
    ? [
      // Whole product on the right of a near-black card; headline on the left.
      `c_pad,g_east,w_${width},h_${height},b_rgb:0A0A0A`,
      `l_${LOGO},w_150/fl_layer_apply,g_north_west,x_64,y_48`,
      `l_text:${FONT}_60_bold_line_spacing_-10:${title},co_white,c_fit,w_560/fl_layer_apply,g_west,x_72,y_20`,
      `l_text:${FONT}_26_bold:${text(DOMAIN)},co_rgb:FFD400/fl_layer_apply,g_south_west,x_72,y_60`
    ]
    : [
      `c_fill,g_auto,w_${width},h_${height}`,
      'co_black,e_colorize:45',
      `l_${LOGO},w_170/fl_layer_apply,g_north_west,x_56,y_40`,
      `l_text:${FONT}_66_bold_line_spacing_-12:${title},co_white,c_fit,w_900/fl_layer_apply,g_south_west,x_72,y_118`,
      `l_text:${FONT}_28_bold:${text(DOMAIN)},co_rgb:FFD400/fl_layer_apply,g_south_west,x_72,y_62`
    ];
  return `${base}${steps.join('/')}/f_jpg,q_auto/${rest}`;
}

const urlOf = image => (typeof image === 'string' ? image : image?.url) || '';
const altOf = image => (typeof image === 'object' && image?.alt) || '';

// The photo for each page's preview, from that page's own content.
export function pageImage(name, content, products = []) {
  const pick = (...candidates) => candidates.find(candidate => urlOf(candidate.image)) || null;
  const c = content;
  const choice = {
    home: () => pick({ image: DEFAULT_IMAGE, alt: 'OneGrid Energies technicians at a community clean-energy site in Nigeria' }),
    about: () => pick({ image: c.about?.journey?.image, alt: c.about?.journey?.image_alt }),
    // (the OnePlastic page's own photos carry a printed logo, which would clash with the card's)
    oneplastic: () => pick({ image: products[0]?.uses?.photos?.[0]?.image }, { image: c.oneplastic?.overview?.image, alt: c.oneplastic?.overview?.image_alt }),
    shop: () => pick({ image: products[0]?.image, layout: 'product' }),
    stories: () => pick({ image: c.oneplastic?.shop_teaser?.image }),
    recognitions: () => pick({ image: c.quote?.award?.image_1, alt: c.quote?.award?.image_1_alt, layout: 'product' }),
    quote: () => pick({ image: c.quote?.installations?.items?.[0]?.image, alt: c.quote?.installations?.items?.[0]?.image_alt }),
    contact: () => pick({ image: c.home?.vision?.background_image, alt: 'OneGrid Energies at work in a Nigerian community' })
  }[name]?.();
  return choice ? { url: urlOf(choice.image), alt: choice.alt || altOf(choice.image), layout: choice.layout || 'photo' } : null;
}

// Everything the page head needs for its preview.
export function preview(seo = {}, fallback) {
  const custom = urlOf(seo.image);
  const source = custom ? { url: custom, alt: seo.image_alt, layout: 'photo' } : (fallback || { url: DEFAULT_IMAGE, layout: 'photo' });
  return {
    image: socialCard(source.url, cardHeadline(seo), { layout: source.layout }),
    imageAlt: seo.image_alt || source.alt || cardHeadline(seo)
  };
}
