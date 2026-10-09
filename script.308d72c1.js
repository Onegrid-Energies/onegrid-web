// ══════════════════════════════════════
// CLOUDINARY HELPERS
// ══════════════════════════════════════
function cloudinaryUrl(url, options = {}) {
  if (!url || !url.includes('res.cloudinary.com') || url.includes('example.com')) {
    return url;
  }
  const { width, height, quality = 'auto', format = 'auto', crop } = options;
  const transforms = [`f_${format}`, `q_${quality}`];
  if (width) transforms.push(`w_${width}`);
  if (height) transforms.push(`h_${height}`);
  if (crop) transforms.push(`c_${crop}`);
  return url.replace('/upload/', `/upload/${transforms.join(',')}/`);
}

function cloudinaryVideoUrl(url, options = {}) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const { width = 1280, quality = 'auto:eco' } = options;
  return url.replace('/upload/', `/upload/q_${quality},w_${width},c_limit,f_mp4/`);
}

function getGalleryImageWidth(item) {
  const viewport = window.innerWidth;
  if (viewport <= 480) return 480;
  if (viewport <= 768) return item.classList.contains('wide') ? 768 : 400;
  if (item.classList.contains('wide') || item.classList.contains('tall')) return 800;
  return 400;
}

function getConnectionTier() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return 'normal';
  if (conn.saveData) return 'save';
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 'slow';
  return 'normal';
}

// ══════════════════════════════════════
// THEME
// ══════════════════════════════════════
const THEME_KEY = 'onegrid-theme';

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0A0A0A' : '#FFD400';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  applyTheme(getPreferredTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
}

// ══════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════
const PAGE_ROUTES = {
  home: '/',
  about: '/about/',
  oneplastic: '/oneplastic/',
  stories: '/stories-of-hope/',
  recognitions: '/recognitions/',
  quote: '/quote/',
  contact: '/contact/'
};

const SITE_URL = 'https://onegridenergies.com';
const DEFAULT_SOCIAL_IMAGE = 'https://res.cloudinary.com/dj2ciluyx/image/upload/f_auto,q_auto,w_1200,h_630,c_fill/v1784564050/photo4_cof80h.jpg';
const PAGE_METADATA = {
  home: {
    path: '/',
    title: 'OneGrid Energies | Clean Energy That Reduces Darkness',
    description: 'OneGrid Energies delivers clean energy, solar installations, circular innovation, and community impact solutions that reduce darkness across Nigeria.'
  },
  about: {
    path: '/about',
    title: 'About OneGrid Energies | Clean Energy & Circular Innovation',
    description: 'Discover how OneGrid Energies turns clean-energy innovation, recycling, and human empowerment into practical impact across Nigeria.'
  },
  oneplastic: {
    path: '/oneplastic',
    title: 'OnePlastic Initiative | OneGrid Energies',
    description: 'OnePlastic transforms waste plastic bottles and discarded batteries into solar-powered lanterns for communities without reliable electricity.'
  },
  stories: {
    path: '/stories-of-hope',
    title: 'Stories of Hope | OneGrid Energies',
    description: 'Meet the people and communities gaining safer, cleaner light through OneGrid Energies and the OnePlastic initiative.'
  },
  recognitions: {
    path: '/recognitions',
    title: 'Recognition, Milestones & Media | OneGrid Energies',
    description: 'Explore OneGrid Energies’ recognitions, milestones, and media coverage for clean energy, circular innovation, and community impact.'
  },
  quote: {
    path: '/quote',
    title: 'Get a Solar Quote | OneGrid Energies',
    description: 'Get a tailored solar or CCTV installation quote from OneGrid Energies for your home, business, school, or community.'
  },
  contact: {
    path: '/contact',
    title: 'Contact OneGrid Energies | Partner With Us',
    description: 'Contact OneGrid Energies to discuss solar solutions, clean-energy partnerships, community impact, or media enquiries.'
  }
};

// Titles, descriptions and intro videos edited in the admin app are written into the
// page by the build (see content/*.json); they override the defaults above.
const CMS_PAGES = (() => {
  try {
    return JSON.parse(document.getElementById('cms-data')?.textContent || '{}').pages || {};
  } catch {
    return {};
  }
})();

const withoutEmpty = values => Object.fromEntries(Object.entries(values || {}).filter(([, value]) => value));

Object.entries(CMS_PAGES).forEach(([page, { seo }]) => {
  if (PAGE_METADATA[page]) Object.assign(PAGE_METADATA[page], withoutEmpty(seo));
});

function getPageFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'home';
  const route = Object.entries(PAGE_ROUTES).find(([, value]) => value.replace(/\/+$/, '') === path);
  // Keep this short alias working for links shared before the canonical route existed.
  if (path === '/stories') return 'stories';
  if (path === '/home') return 'home';
  return route ? route[0] : 'home';
}

function updateDocumentMetadata(page) {
  const metadata = PAGE_METADATA[page] || PAGE_METADATA.home;
  const canonicalUrl = new URL(metadata.path, SITE_URL).href;
  document.title = metadata.title;
  document.querySelector('meta[name="description"]').content = metadata.description;
  document.querySelector('link[rel="canonical"]').href = canonicalUrl;
  document.querySelector('meta[property="og:title"]').content = metadata.title;
  document.querySelector('meta[property="og:description"]').content = metadata.description;
  document.querySelector('meta[property="og:url"]').content = canonicalUrl;
  document.querySelector('meta[property="og:image"]').content = DEFAULT_SOCIAL_IMAGE;
  document.querySelector('meta[name="twitter:title"]').content = metadata.title;
  document.querySelector('meta[name="twitter:description"]').content = metadata.description;
  document.querySelector('meta[name="twitter:image"]').content = DEFAULT_SOCIAL_IMAGE;
}

function navigateTo(page) {
  const activePage = PAGE_ROUTES[page] ? page : 'home';
  const targetPath = PAGE_ROUTES[activePage];
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const normalizedTarget = targetPath.replace(/\/+$/, '') || '/';
  if (currentPath !== normalizedTarget) window.location.assign(targetPath);
}

function activateCurrentPage(page) {
  const target = document.getElementById(`page-${page}`);
  if (!target) return;

  document.querySelectorAll('.page').forEach(element => {
    element.classList.toggle('active', element === target);
  });
}

function initRouting() {
  document.querySelectorAll('[onclick*="navigateTo("]').forEach(link => {
    const match = link.getAttribute('onclick').match(/navigateTo\('([^']+)'\)/);
    if (match && PAGE_ROUTES[match[1]]) link.setAttribute('href', PAGE_ROUTES[match[1]]);
  });

  const activePage = getPageFromPath();
  activateCurrentPage(activePage);
  const navLink = document.querySelector('[onclick*="navigateTo(\'' + activePage + '\')"]');
  if (navLink?.classList.contains('nav-link')) navLink.classList.add('active');

  document.getElementById('nav')?.classList.add('dark-mode');
  updateBackgroundVideo(activePage);
  updateDocumentMetadata(activePage);
}

// ══════════════════════════════════════
// SCROLL BEHAVIOUR
// ══════════════════════════════════════
window.addEventListener('scroll', () => {
  const nav = document.getElementById('nav');
  if (window.scrollY > 60) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
}, { passive: true });

// ══════════════════════════════════════
// PAGE SCROLL CONTROLS
// ══════════════════════════════════════
function initPageScrollControls() {
  const control = document.querySelector('.page-scroll-control');
  const topButton = document.querySelector('[data-page-scroll="top"]');
  const bottomButton = document.querySelector('[data-page-scroll="bottom"]');
  if (!control || !topButton || !bottomButton) return;

  let scrollStopTimer;

  const scrollTo = position => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: position, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  };
  const update = () => {
    const pageHeight = document.documentElement.scrollHeight;
    const isNearTop = window.scrollY < 240;
    const isNearBottom = window.scrollY + window.innerHeight >= pageHeight - 16;
    topButton.hidden = isNearTop;
    bottomButton.hidden = isNearBottom;
  };
  const showWhileScrolling = () => {
    control.classList.add('is-scrolling');
    window.clearTimeout(scrollStopTimer);
    scrollStopTimer = window.setTimeout(() => {
      control.classList.remove('is-scrolling');
    }, 2000);
  };

  topButton.addEventListener('click', () => scrollTo(0));
  bottomButton.addEventListener('click', () => scrollTo(document.documentElement.scrollHeight));
  window.addEventListener('scroll', () => {
    update();
    showWhileScrolling();
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

// ══════════════════════════════════════
// MOBILE NAV
// ══════════════════════════════════════
function toggleMobileNav() {
  const mobileNav = document.getElementById('mobile-nav');
  const toggle = document.querySelector('.hamburger');
  if (!mobileNav || !toggle) return;

  const isOpen = mobileNav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(isOpen));
}

// ══════════════════════════════════════
// REVEAL ON SCROLL
// ══════════════════════════════════════
let revealObserver;

function initReveal() {
  const reveals = document.querySelectorAll('.page.active .reveal');
  if (!('IntersectionObserver' in window)) {
    reveals.forEach(element => element.classList.add('visible'));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  }

  reveals.forEach(el => {
    if (!el.classList.contains('visible') && el.dataset.revealObserved !== 'true') {
      revealObserver.observe(el);
      el.dataset.revealObserved = 'true';
    }
  });
}

// ══════════════════════════════════════
// COUNTER ANIMATION
// ══════════════════════════════════════
function animateCounters() {
  const counters = document.querySelectorAll('.counter');
  counters.forEach(counter => {
    const target = parseInt(counter.getAttribute('data-target'));
    const duration = 1800;
    const start = performance.now();

    function update(time) {
      const elapsed = time - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);

      if (target >= 1000) {
        counter.textContent = current.toLocaleString();
      } else {
        counter.textContent = current;
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }
    requestAnimationFrame(update);
  });
}

const impactObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounters();
      impactObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

const impactSection = document.getElementById('impact-section');
if (impactSection) impactObserver.observe(impactSection);

// ══════════════════════════════════════
// GALLERY FILTER
// ══════════════════════════════════════
const GALLERY_BATCH_SIZE = 12;
let galleryCategory = 'all';
let visibleGalleryItems = GALLERY_BATCH_SIZE;
let allGalleryOrderRandomized = false;

function randomizeAllGalleryOrder(items) {
  const shuffledItems = [...items];

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffledItems[index], shuffledItems[randomIndex]] = [shuffledItems[randomIndex], shuffledItems[index]];
  }

  shuffledItems.forEach((item, index) => {
    item.style.order = index;
  });
}

function updateGalleryVisibility() {
  const items = Array.from(document.querySelectorAll('.gallery-item'));
  if (galleryCategory === 'all' && !allGalleryOrderRandomized) {
    randomizeAllGalleryOrder(items);
    allGalleryOrderRandomized = true;
  }
  const matchingItems = items.filter(item => galleryCategory === 'all' || item.dataset.cat === galleryCategory);
  const more = document.getElementById('gallery-more');
  const moreButton = document.getElementById('gallery-more-button');

  items.forEach(item => {
    const itemIndex = matchingItems.indexOf(item);
    item.hidden = itemIndex === -1 || itemIndex >= visibleGalleryItems;
  });

  const remaining = matchingItems.length - visibleGalleryItems;
  if (more && moreButton) {
    more.hidden = remaining <= 0;
    moreButton.textContent = remaining > 0
      ? `See more (${Math.min(GALLERY_BATCH_SIZE, remaining)} more)`
      : 'See more';
  }
}

function filterGallery(cat, btn) {
  document.querySelectorAll('.filter-btn').forEach(button => {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  galleryCategory = cat;
  allGalleryOrderRandomized = false;
  if (cat !== 'all') {
    document.querySelectorAll('.gallery-item').forEach(item => item.style.removeProperty('order'));
  }
  visibleGalleryItems = GALLERY_BATCH_SIZE;
  updateGalleryVisibility();
}

function showGalleryCategory(category) {
  const gallery = document.getElementById('gallery-grid');
  const filterButton = Array.from(document.querySelectorAll('.filter-btn')).find(
    button => button.getAttribute('onclick').includes(`filterGallery('${category}'`)
  );

  if (filterButton) filterGallery(category, filterButton);
  gallery?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initGalleryPagination() {
  const moreButton = document.getElementById('gallery-more-button');
  if (!moreButton) return;

  moreButton.addEventListener('click', () => {
    visibleGalleryItems += GALLERY_BATCH_SIZE;
    updateGalleryVisibility();
  });

  updateGalleryVisibility();
}

// ══════════════════════════════════════
// GALLERY LIGHTBOX
// ══════════════════════════════════════
let galleryLightboxTrigger = null;

function getGalleryCaption(item) {
  const label = item.querySelector('.gallery-overlay span')?.textContent.trim();
  if (label) return label;

  const labels = {
    oneplastic: 'OnePlastic',
    onehealth: 'OneHealth',
    onebox: 'OneBox',
    solar: 'Solar Installation',
    training: 'Training Academy',
    'office+workshop': 'Office / Workshop'
  };
  return labels[item.dataset.cat] || 'OneGrid Energies';
}

function openGalleryLightbox(item) {
  const modal = document.getElementById('gallery-lightbox');
  const image = document.getElementById('gallery-lightbox-image');
  const caption = document.getElementById('gallery-lightbox-title');
  const source = item.dataset.image;
  if (!modal || !image || !caption || !source || source.includes('example.com')) return;

  const label = getGalleryCaption(item);
  image.src = cloudinaryUrl(source, { width: 1600, quality: 'auto:good' });
  image.alt = label;
  caption.textContent = label;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  galleryLightboxTrigger = item;
  modal.querySelector('.gallery-lightbox__close')?.focus();
}

function closeGalleryLightbox() {
  const modal = document.getElementById('gallery-lightbox');
  const image = document.getElementById('gallery-lightbox-image');
  if (!modal || !image) return;

  modal.hidden = true;
  image.removeAttribute('src');
  image.alt = '';
  document.body.style.overflow = '';
  galleryLightboxTrigger?.focus();
  galleryLightboxTrigger = null;
}

function initGalleryLightbox() {
  const modal = document.getElementById('gallery-lightbox');
  if (!modal) return;

  document.querySelectorAll('.gallery-item[data-image]').forEach(item => {
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `View ${getGalleryCaption(item)} image`);
    item.addEventListener('click', () => openGalleryLightbox(item));
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openGalleryLightbox(item);
      }
    });
  });

  modal.querySelectorAll('[data-gallery-lightbox-close]').forEach(el => {
    el.addEventListener('click', closeGalleryLightbox);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) closeGalleryLightbox();
  });
}

// ══════════════════════════════════════
// INTRO VIDEO PLAYBACK
// ══════════════════════════════════════
const BACKGROUND_VIDEOS = {
  home: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781117070/Background_video_1_nwdtxu.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781117070/Background_video_1_nwdtxu.jpg',
    label: 'OneGrid Energies',
    title: 'A brighter future starts with one loop of light.',
    subtitle: 'This muted video section plays in a continuous loop before you continue down the page to the rest of the OneGrid story.',
    target: '.hero'
  },
  recognitions: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781117070/Background_video_1_nwdtxu.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781117070/Background_video_1_nwdtxu.jpg',
    label: 'Recognition, Milestones & Media',
    title: 'A journey built to reduce darkness.',
    subtitle: 'Explore the recognitions and milestones that reflect OneGrid Energies’ work in clean energy, circular innovation and community impact.',
    target: '#page-recognitions .page-hero'
  },
  about: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781116924/Background_video_3_jshjf7.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781116924/Background_video_3_jshjf7.jpg',
    label: 'Our Story',
    title: 'Small innovations can create big change.',
    subtitle: 'Background Video 3 opens the About story before you continue into OneGrid Energies, its journey, and its mission.',
    target: '#page-about .page-hero'
  },
  oneplastic: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1782152748/MP4_Background_video_2_p7wmtx.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1782152748/MP4_Background_video_2_p7wmtx.jpg',
    label: 'OnePlastic Initiative',
    title: 'Waste becomes light before the story begins.',
    subtitle: 'Background Video 2 introduces the OnePlastic journey before you continue into the initiative, its model, and its community impact.',
    target: '#page-oneplastic .page-hero'
  },
  stories: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781117070/Background_video_1_nwdtxu.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781117070/Background_video_1_nwdtxu.jpg',
    label: 'Stories of Hope',
    title: 'Every light carries a human story.',
    subtitle: 'This shared intro video opens the Stories of Hope page before you continue into the people and communities behind OneGrid Energies.',
    target: '#page-stories'
  },
  quote: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781117070/Background_video_1_nwdtxu.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781117070/Background_video_1_nwdtxu.jpg',
    label: 'Solar Installations',
    title: 'Let’s build the right solar solution for you.',
    subtitle: 'Share your energy needs and receive a tailored solar installation quote from OneGrid Energies.',
    target: '#page-quote .page-hero'
  },
  contact: {
    src: 'https://res.cloudinary.com/dj2ciluyx/video/upload/v1781117070/Background_video_1_nwdtxu.mp4',
    poster: 'https://res.cloudinary.com/dj2ciluyx/video/upload/so_0,q_auto:low,w_800,c_limit/v1781117070/Background_video_1_nwdtxu.jpg',
    label: 'Contact OneGrid',
    title: 'Start a partnership that reduces darkness.',
    subtitle: 'This shared intro video opens the Contact page before you continue to partnership, investment, donation, and media enquiries.',
    target: '#page-contact .page-hero'
  }
};

Object.entries(CMS_PAGES).forEach(([page, { intro }]) => {
  if (!BACKGROUND_VIDEOS[page] || !intro) return;
  const { video, ...text } = intro;
  Object.assign(BACKGROUND_VIDEOS[page], withoutEmpty({ src: video, ...text }));
});

function updateIntroContent(config) {
  const label = document.querySelector('[data-intro-label]');
  const title = document.querySelector('[data-intro-title]');
  const subtitle = document.querySelector('[data-intro-subtitle]');
  const cta = document.querySelector('[data-intro-cta]');

  if (label) label.textContent = config.label;
  if (title) title.textContent = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;
  if (cta) cta.dataset.introTarget = config.target;
}

function scrollIntroTarget() {
  const cta = document.querySelector('[data-intro-cta]');
  const selector = cta?.dataset.introTarget || '.page.active';
  const target = document.querySelector(selector);
  if (target) target.scrollIntoView({ behavior: 'smooth' });
}

function scrollToQuoteSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playBackgroundVideo(video) {
  if (!video) return;

  const tier = getConnectionTier();
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (tier === 'save' || tier === 'slow' || prefersReducedMotion) return;

  video.play().catch(() => {});
}

function getOptimizedVideoSrc(baseSrc) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const width = isMobile ? 720 : 1280;
  return baseSrc.includes('cloudinary.com') ? cloudinaryVideoUrl(baseSrc, { width }) : baseSrc;
}

function setSharedVideoSource(video, config) {
  const source = video.querySelector('source');
  if (!source) return;

  if (source.getAttribute('data-base') !== config.src) {
    source.setAttribute('data-base', config.src);
    source.src = getOptimizedVideoSrc(config.src);
    video.poster = config.poster;
    video.load();
  }
}

function updateBackgroundVideo(page) {
  const video = document.getElementById('shared-bg-video');
  const introSection = document.querySelector('.intro-video');
  const introWrapper = document.querySelector('.intro-video__wrapper');
  if (!video || !introSection || !introWrapper) return;

  if (BACKGROUND_VIDEOS[page]) {
    introSection.hidden = false;
    updateIntroContent(BACKGROUND_VIDEOS[page]);
    setSharedVideoSource(video, BACKGROUND_VIDEOS[page]);
    introWrapper.prepend(video);
    playBackgroundVideo(video);
    return;
  }

  introSection.hidden = true;
  video.pause();
  introWrapper.prepend(video);
}

function initIntroVideo() {
  const video = document.getElementById('shared-bg-video');
  if (!video || video.dataset.initialized === 'true') return;

  const tier = getConnectionTier();
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = tier === 'save' || tier === 'slow' ? 'none' : 'metadata';

  const source = video.querySelector('source');
  if (source) {
    const baseSrc = source.getAttribute('data-base') || source.src;
    source.setAttribute('data-base', baseSrc);
    source.src = getOptimizedVideoSrc(baseSrc);
  }

  if (tier === 'save' || tier === 'slow' || prefersReducedMotion) {
    video.removeAttribute('autoplay');
  } else {
    video.autoplay = true;
  }

  video.dataset.initialized = 'true';
  updateBackgroundVideo(getPageFromPath());
}

// ══════════════════════════════════════
// LAZY IMAGE LOADING
// ══════════════════════════════════════
function loadBackgroundImage(el, url, width) {
  if (!url || el.dataset.loaded === 'true') return;
  const optimized = cloudinaryUrl(url, { width, crop: 'fill' });
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    el.style.backgroundImage = `url('${optimized}')`;
    el.classList.remove('is-loading');
    el.classList.add('is-loaded');
    el.dataset.loaded = 'true';
  };
  img.onerror = () => {
    el.classList.remove('is-loading');
  };
  img.src = optimized;
}

function initLazyImages() {
  const founderImg = document.querySelector('.story-founder-img-wrap img[data-src]');
  if (founderImg) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.getAttribute('data-src');
        img.src = cloudinaryUrl(src, { width: 640, crop: 'fill' });
        img.srcset = [
          `${cloudinaryUrl(src, { width: 400, crop: 'fill' })} 400w`,
          `${cloudinaryUrl(src, { width: 640, crop: 'fill' })} 640w`,
          `${cloudinaryUrl(src, { width: 900, crop: 'fill' })} 900w`
        ].join(', ');
        img.sizes = '(max-width: 768px) 100vw, 420px';
        img.removeAttribute('data-src');
        obs.unobserve(img);
      });
    }, { rootMargin: '200px' });
    observer.observe(founderImg);
  }

  const visionBg = document.querySelector('.vision-bg[data-bg]');
  if (visionBg) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const url = entry.target.getAttribute('data-bg');
        const optimized = cloudinaryUrl(url, { width: 1600, quality: 'auto:good' });
        entry.target.style.background = `linear-gradient(180deg, rgba(12,11,8,0.65), rgba(12,11,8,0.92)), url('${optimized}') center/cover no-repeat`;
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '100px' });
    observer.observe(visionBg);
  }
}

function initGalleryImages() {
  const galleryItems = document.querySelectorAll('.gallery-item[data-image]');
  if (!galleryItems.length) return;

  galleryItems.forEach(item => item.classList.add('is-loading'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const item = entry.target;
      const imageUrl = item.getAttribute('data-image');
      const width = getGalleryImageWidth(item);
      loadBackgroundImage(item, imageUrl, width);
      observer.unobserve(item);
    });
  }, { rootMargin: '150px', threshold: 0.01 });

  galleryItems.forEach(item => observer.observe(item));
}

function initPartnerLogos() {
  const track = document.getElementById('partners-track');
  if (!track) return;

  Array.from(track.children).forEach(card => {
    track.appendChild(card.cloneNode(true));
  });

  const partnersSection = document.querySelector('.partners-section');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const cards = partnersSection.querySelectorAll('.partner-card[data-logo]');
      const byUrl = new Map();
      cards.forEach(card => {
        const url = card.getAttribute('data-logo');
        if (!byUrl.has(url)) byUrl.set(url, []);
        byUrl.get(url).push(card);
      });

      let delay = 0;
      byUrl.forEach((cardGroup, logoUrl) => {
        setTimeout(() => {
          const optimized = cloudinaryUrl(logoUrl, { width: 320, height: 152, crop: 'limit' });
          const preload = new Image();
          preload.onload = () => {
            cardGroup.forEach(card => {
              const img = card.querySelector('.partner-card__img');
              if (img) img.src = optimized;
              card.classList.remove('is-loading');
              card.dataset.loaded = 'true';
            });
          };
          preload.onerror = () => {
            cardGroup.forEach(card => card.classList.remove('is-loading'));
          };
          preload.src = optimized;
        }, delay);
        delay += 30;
      });

      observer.unobserve(entry.target);
    });
  }, { rootMargin: '200px' });

  observer.observe(partnersSection);
}

// ══════════════════════════════════════
// SERVICE VIDEO MODAL (What We Do)
// ══════════════════════════════════════
function getYouTubeId(spec) {
  if (!spec) return '';
  if (spec.startsWith('youtube:')) return spec.slice('youtube:'.length);

  try {
    const url = new URL(spec);
    if (url.hostname.includes('youtu.be')) return url.pathname.replace('/', '');
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const embedMatch = url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
      if (embedMatch) return embedMatch[1];
    }
  } catch (e) {
    return spec.includes(':') ? '' : spec;
  }

  return '';
}

function buildServiceVideoEmbed(spec) {
  const youtubeId = getYouTubeId(spec);
  if (youtubeId) {
    const src = `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0`;
    return `<iframe src="${src}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }

  const [type, id] = spec.split(':');
  if (type === 'instagram' && id) {
    const src = `https://www.instagram.com/reel/${encodeURIComponent(id)}/embed`;
    return `<iframe src="${src}" title="Instagram reel" allowfullscreen scrolling="no"></iframe>`;
  }
  return '';
}

function initStoryVideoThumbnails() {
  document.querySelectorAll('.story-video-card__media[data-service-video]').forEach(trigger => {
    const youtubeId = getYouTubeId(trigger.dataset.serviceVideo);
    if (!youtubeId) return;

    const thumbnail = `https://img.youtube.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`;
    trigger.style.backgroundImage = `linear-gradient(180deg, rgba(10,10,10,0.08) 0%, rgba(10,10,10,0.82) 100%), url('${thumbnail}')`;
    trigger.style.backgroundSize = 'cover';
    trigger.style.backgroundPosition = 'center';
    trigger.classList.add('has-youtube-thumbnail');
  });
}

function openServiceVideoModal(spec) {
  const modal = document.getElementById('service-video-modal');
  const embedHost = document.getElementById('service-video-modal-embed');
  if (!modal || !embedHost) return;

  const html = buildServiceVideoEmbed(spec);
  if (!html) return;

  embedHost.innerHTML = html;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  modal.querySelector('.service-video-modal__close')?.focus();
}

function closeServiceVideoModal() {
  const modal = document.getElementById('service-video-modal');
  const embedHost = document.getElementById('service-video-modal-embed');
  if (!modal || !embedHost) return;

  modal.hidden = true;
  embedHost.innerHTML = '';
  document.body.style.overflow = '';
}

function initServiceVideos() {
  const modal = document.getElementById('service-video-modal');
  if (!modal) return;

  initStoryVideoThumbnails();

  document.querySelectorAll('[data-service-video]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      openServiceVideoModal(trigger.dataset.serviceVideo);
    });
  });

  modal.querySelectorAll('[data-service-video-close]').forEach(el => {
    el.addEventListener('click', closeServiceVideoModal);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeServiceVideoModal();
  });
}

// ══════════════════════════════════════
// SOLAR QUOTE PAGE
// ══════════════════════════════════════
function formatNaira(value) {
  return '₦' + Math.round(value).toLocaleString('en-NG');
}

function initDailyPricingCountdown() {
  const hours = document.querySelector('[data-countdown-hours]');
  const minutes = document.querySelector('[data-countdown-minutes]');
  const seconds = document.querySelector('[data-countdown-seconds]');
  if (!hours || !minutes || !seconds) return;

  const formatUnit = value => String(value).padStart(2, '0');
  const update = () => {
    const now = new Date();
    const deadline = new Date(now);
    deadline.setHours(24, 0, 0, 0);
    const remaining = Math.max(0, deadline.getTime() - now.getTime());
    const remainingSeconds = Math.floor(remaining / 1000);

    hours.textContent = formatUnit(Math.floor(remainingSeconds / 3600));
    minutes.textContent = formatUnit(Math.floor((remainingSeconds % 3600) / 60));
    seconds.textContent = formatUnit(remainingSeconds % 60);
  };

  update();
  window.setInterval(update, 1000);
}

function initAwardCarousel() {
  const carousel = document.querySelector('.quote-award__carousel');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.quote-award__slide'));
  const current = carousel.querySelector('[data-award-carousel-current]');
  if (slides.length < 2) return;

  let activeIndex = 0;
  let timer;
  const showSlide = index => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
    });
    current.textContent = activeIndex + 1;
  };
  const startAutoPlay = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => showSlide(activeIndex + 1), 6000);
  };

  carousel.querySelector('[data-award-carousel="previous"]').addEventListener('click', () => {
    showSlide(activeIndex - 1);
    startAutoPlay();
  });
  carousel.querySelector('[data-award-carousel="next"]').addEventListener('click', () => {
    showSlide(activeIndex + 1);
    startAutoPlay();
  });
  carousel.addEventListener('mouseenter', () => window.clearInterval(timer));
  carousel.addEventListener('mouseleave', startAutoPlay);
  carousel.addEventListener('focusin', () => window.clearInterval(timer));
  carousel.addEventListener('focusout', event => {
    if (!carousel.contains(event.relatedTarget)) startAutoPlay();
  });

  showSlide(activeIndex);
  startAutoPlay();
}

function initQuotePage() {
  initDailyPricingCountdown();
  initAwardCarousel();
  const fuelSpend = document.getElementById('fuel-spend');
  const generatorHours = document.getElementById('generator-hours');
  const preferredPlan = document.getElementById('preferred-plan');
  document.querySelectorAll('[data-quote-plan]').forEach(plan => {
    plan.addEventListener('click', () => {
      if (preferredPlan) preferredPlan.value = plan.dataset.quotePlan;
    });
  });
  if (!fuelSpend || !generatorHours) return;

  const updateSavings = () => {
    const monthly = Number(fuelSpend.value);
    const hours = Number(generatorHours.value);
    const estimatedSolarMonthlyCost = hours * 1000;
    document.getElementById('fuel-spend-output').textContent = formatNaira(monthly);
    document.getElementById('generator-hours-output').textContent = hours + 'hrs';
    document.getElementById('five-year-savings').textContent = formatNaira(Math.max(0, monthly - estimatedSolarMonthlyCost) * 60);
    document.getElementById('monthly-spend').textContent = formatNaira(monthly);
    document.getElementById('yearly-spend').textContent = formatNaira(monthly * 12);
    document.getElementById('solar-monthly-cost').textContent = formatNaira(estimatedSolarMonthlyCost);
  };

  fuelSpend.addEventListener('input', updateSavings);
  generatorHours.addEventListener('input', updateSavings);
  updateSavings();
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initRouting();
  initPageScrollControls();
  initGalleryPagination();
  initLazyImages();
  initGalleryImages();
  initGalleryLightbox();
  initPartnerLogos();
  initReveal();
  initIntroVideo();
  initServiceVideos();
  initQuotePage();

  const hero = document.querySelector('.hero');
  if (hero) {
    setTimeout(initReveal, 300);
  }
});
