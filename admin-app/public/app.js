/* OneGrid admin — single-page app. Forms are generated from admin-app/schema.yml (via /api/schema);
 * saving edits the website's content/*.json files in GitHub. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- tiny DOM helpers
  const $ = (selector, root = document) => root.querySelector(selector);
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return el;
  }
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const slugify = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const fill = (template, data) => String(template || '').replace(/\{\{\s*(?:fields\.)?([\w.]+)\s*\}\}/g, (_, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), data) ?? '');
  const cleanHint = text => String(text || '').replace(/\\\*/g, '*');

  // ---------------------------------------------------------------- API
  async function api(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-OneGrid-Admin': '1' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401) { location.href = '/login'; throw new Error('Signed out.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
    return data;
  }

  let toastTimer;
  function toast(message, ms = 4000) {
    const el = $('[data-toast]');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------------------------------------------------------------- state & routing
  const state = { me: null, schema: null, dirty: false, lastHash: location.hash };
  const view = () => $('[data-view]');
  const setView = (...nodes) => { view().replaceChildren(...nodes.filter(node => node !== null && node !== undefined && node !== false)); window.scrollTo(0, 0); };
  const loading = () => setView(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Loading…'));
  const errorView = error => setView(h('div', { class: 'notice notice-error', text: error.message }));
  const collectionByName = name => state.schema.collections.find(c => c.name === name);

  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    const status = $('[data-save-status]');
    if (status) { status.textContent = 'Unsaved changes'; status.className = 'status dirty'; }
  }
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });

  let ignoreHash = false;
  window.addEventListener('hashchange', () => {
    if (ignoreHash) { ignoreHash = false; return; }
    if (state.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
      ignoreHash = true;
      location.hash = state.lastHash;
      return;
    }
    state.dirty = false;
    route();
  });

  function route() {
    state.lastHash = location.hash;
    setMenu(false);
    const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(query);
    highlightNav(parts);
    document.title = 'OneGrid WebAdmin';
    if (!parts.length) return dashboard();
    if (parts[0] === 'c' && parts[1] && !parts[2]) return collectionView(parts[1]);
    if (parts[0] === 'c' && parts[2] === 'new') return editorView(parts[1], null);
    if (parts[0] === 'c' && parts[2] === 'e' && parts[3]) return editorView(parts[1], parts[3]);
    if (parts[0] === 'team') return teamView();
    if (parts[0] === 'activity') return activityView();
    if (parts[0] === 'account') return accountView(params);
    setView(h('div', { class: 'empty', text: 'Page not found.' }));
  }

  // ---------------------------------------------------------------- navigation
  function renderNav() {
    const nav = $('[data-nav]');
    nav.replaceChildren(
      h('a', { class: 'nav-link', href: '#/', 'data-route': '' }, 'Dashboard'),
      h('div', { class: 'nav-label', text: 'Content' }),
      ...state.schema.collections.map(c => h('a', { class: 'nav-link', href: `#/c/${c.name}`, 'data-route': `c/${c.name}` }, c.label)),
      h('div', { class: 'nav-label', text: 'Admin' }),
      state.me.role === 'owner' ? h('a', { class: 'nav-link', href: '#/team', 'data-route': 'team' }, 'Team') : null,
      state.me.role === 'owner' ? h('a', { class: 'nav-link', href: '#/activity', 'data-route': 'activity' }, 'Activity') : null,
      h('a', { class: 'nav-link', href: '#/account', 'data-route': 'account' }, 'My account'),
      h('a', { class: 'nav-link', href: state.me.siteUrl, target: '_blank', rel: 'noopener' }, 'View website ↗')
    );
    $('[data-user-name]').textContent = state.me.name || state.me.email;
    $('[data-user-role]').textContent = state.me.role === 'owner' ? 'Owner' : 'Editor';
  }
  function highlightNav(parts) {
    const current = parts[0] === 'c' ? `c/${parts[1]}` : parts[0] || '';
    document.querySelectorAll('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === current));
  }

  // Where an item appears on the live site.
  function liveUrl(collection, id, data = {}) {
    const site = state.me.siteUrl;
    if (collection.name === 'projects') return `${site}/projects/${slugify(data.slug || data.name || id)}/`;
    if (collection.name === 'services') return `${site}/services/#${data.anchor || id}`;
    if (collection.name === 'products') return `${site}/products/`;
    if (collection.name === 'pages') return id === 'home' ? `${site}/` : `${site}/${id}/`;
    if (collection.name === 'settings') return `${site}/contact/`;
    return site;
  }

  // ---------------------------------------------------------------- dashboard
  function dashboard() {
    const first = state.me.name ? state.me.name.split(' ')[0] : '';
    setView(
      h('div', { class: 'page-head' }, h('div', {},
        h('h1', { text: `Welcome${first ? ', ' + first : ''}` }),
        h('p', { text: 'Choose what you’d like to edit. Saved changes appear on the website within a few minutes.' }))),
      state.me.backend === 'local' ? h('div', { class: 'notice notice-warn', text: 'Local mode: changes are written to the files on this computer, not GitHub.' }) : null,
      h('div', { class: 'cards' }, state.schema.collections.map(c =>
        h('a', { class: 'card', href: `#/c/${c.name}` }, h('h3', { text: c.label }), h('p', { text: c.description || '' }))))
    );
  }

  // ---------------------------------------------------------------- collection list
  async function collectionView(name) {
    const collection = collectionByName(name);
    if (!collection) return errorView(new Error('Unknown section.'));
    loading();
    let entries;
    try { entries = (await api('GET', `/api/collections/${name}`)).entries; } catch (error) { return errorView(error); }

    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', { text: collection.label }), collection.description ? h('p', { text: collection.description }) : null),
      collection.type === 'folder' && collection.create ? h('a', { class: 'btn', href: `#/c/${name}/new` }, `+ New ${collection.labelSingular.toLowerCase()}`) : null);

    if (collection.type === 'files') {
      return setView(head, h('div', { class: 'entry-list' }, entries.map(entry =>
        h('a', { class: 'entry-row', href: `#/c/${name}/e/${entry.id}` }, h('span', { class: 'title', text: entry.label }), h('span', { class: 'muted small', text: 'Edit →' })))));
    }

    if (collection.sortableFields.includes('order')) entries.sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999) || a.label.localeCompare(b.label));
    else entries.sort((a, b) => a.label.localeCompare(b.label));

    const list = h('div', { class: 'entry-list' });
    const renderRows = filter => {
      const rows = entries.filter(entry => !filter || entry.label.toLowerCase().includes(filter.toLowerCase()));
      list.replaceChildren(...(rows.length ? rows.map(entry => h('a', { class: 'entry-row', href: `#/c/${name}/e/${entry.id}` },
        h('span', { class: 'title', text: entry.label }),
        entry.data.published === false ? h('span', { class: 'pill pill-off', text: 'Hidden' }) : null,
        typeof entry.data.order === 'number' ? h('span', { class: 'pill', text: `#${entry.data.order}` }) : null,
        h('span', { class: 'muted small', text: 'Edit →' }))) : [h('div', { class: 'empty', text: entries.length ? 'Nothing matches your search.' : `No ${collection.label.toLowerCase()} yet.` })]));
    };
    renderRows('');
    setView(head, entries.length > 6 ? h('div', { class: 'toolbar' }, h('input', { type: 'text', placeholder: `Search ${collection.label.toLowerCase()}…`, oninput: e => renderRows(e.target.value) })) : null, list);
  }

  // ---------------------------------------------------------------- editor
  async function editorView(name, id) {
    const collection = collectionByName(name);
    if (!collection) return errorView(new Error('Unknown section.'));
    const isNew = id === null;
    const fileDef = collection.type === 'files' ? collection.files.find(f => f.name === id) : null;
    if (collection.type === 'files' && !fileDef) return errorView(new Error('Unknown page.'));
    const fields = fileDef ? fileDef.fields : collection.fields;
    loading();

    let entry = { data: defaultsFor(fields), sha: null };
    if (!isNew) {
      try { entry = await api('GET', `/api/collections/${name}/entries/${id}`); } catch (error) { return errorView(error); }
    }
    const data = entry.data;
    let sha = entry.sha;

    const title = isNew ? `New ${collection.labelSingular.toLowerCase()}` : fileDef ? fileDef.label : (fill(collection.summary, data).replace(/^[\s—–-]+|[\s—–-]+$/g, '') || data[collection.identifierField] || id);
    const form = h('form', { class: 'editor', novalidate: true, onsubmit: event => { event.preventDefault(); save(); } });
    renderFields(fields, data, form);
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);

    const status = h('span', { class: 'status', 'data-save-status': true, text: isNew ? 'Not saved yet' : 'All changes saved' });
    const saveButton = h('button', { class: 'btn', type: 'button', onclick: () => save() }, isNew ? 'Create' : 'Save & publish');
    const deleteButton = !isNew && collection.type === 'folder' && collection.remove
      ? h('button', { class: 'btn btn-danger', type: 'button', onclick: () => remove() }, 'Delete') : null;

    async function save() {
      const problems = [...form.querySelectorAll('.field')].map(el => (el._validate ? el._validate() : null)).filter(Boolean);
      if (problems.length) {
        status.textContent = `Please fix ${problems.length} field${problems.length > 1 ? 's' : ''} marked in red.`;
        status.className = 'status error';
        form.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      saveButton.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'status';
      try {
        if (isNew) {
          const result = await api('POST', `/api/collections/${name}/entries`, { data });
          state.dirty = false;
          toast('Created. It will appear on the website in a few minutes.');
          ignoreHash = true;
          location.hash = `#/c/${name}/e/${result.id}`;
          ignoreHash = false;
          return editorView(name, result.id);
        }
        const result = await api('PUT', `/api/collections/${name}/entries/${id}`, { data, sha });
        sha = result.sha;
        state.dirty = false;
        status.textContent = result.unchanged ? 'No changes to save.' : 'Saved. The website updates in a few minutes.';
        status.className = 'status ok';
      } catch (error) {
        status.className = 'status error';
        if (error.status === 409 && !isNew) {
          status.replaceChildren('Someone else saved this item since you opened it. ',
            h('button', { class: 'link-button', type: 'button', onclick: () => { state.dirty = false; editorView(name, id); } }, 'Reload their version'),
            ' — your unsaved changes will be lost, so copy anything you need first.');
        } else {
          status.textContent = error.message;
        }
      } finally {
        saveButton.disabled = false;
      }
    }

    async function remove() {
      if (!confirm(`Delete “${title}”? It will be removed from the website.`)) return;
      try {
        await api('DELETE', `/api/collections/${name}/entries/${id}?sha=${encodeURIComponent(sha)}`);
        state.dirty = false;
        toast('Deleted.');
        location.hash = `#/c/${name}`;
      } catch (error) {
        status.textContent = error.status === 409 ? 'Someone else changed this item. Reload it before deleting.' : error.message;
        status.className = 'status error';
      }
    }

    setView(
      h('div', { class: 'crumb' }, h('a', { href: `#/c/${name}`, text: `← ${collection.label}` })),
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: title }), fileDef?.description ? h('p', { text: fileDef.description }) : null),
        !isNew ? h('a', { class: 'btn btn-ghost btn-small', href: liveUrl(collection, id, data), target: '_blank', rel: 'noopener' }, 'View on website ↗') : null),
      form,
      h('div', { class: 'savebar' }, status, deleteButton, saveButton)
    );
  }

  // ---------------------------------------------------------------- form builder
  function defaultsFor(fields) {
    const out = {};
    for (const field of fields || []) {
      const value = defaultFor(field);
      if (value !== undefined) out[field.name] = value;
    }
    return out;
  }
  function defaultFor(field) {
    if (field.default !== undefined) return clone(field.default);
    switch (field.widget) {
      case 'boolean': return false;
      case 'list': return [];
      case 'object': return defaultsFor(field.fields);
      case 'select': return field.multiple ? [] : '';
      case 'number': return undefined;
      case 'hidden': return undefined;
      default: return '';
    }
  }
  const isRequired = field => field.required !== false;
  const isEmpty = value => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

  function renderFields(fields, obj, container) {
    for (const field of fields || []) {
      const el = renderField(field, obj, field.name);
      if (el) container.append(el);
    }
  }

  function fieldShell(field, control, { bare = false } = {}) {
    const wrap = h('div', { class: 'field' });
    if (!bare) wrap.append(h('label', { class: 'field-label' }, field.label || field.name, isRequired(field) || field.widget === 'boolean' ? null : h('span', { class: 'optional', text: ' (optional)' })));
    wrap.append(control);
    if (field.hint) wrap.append(h('div', { class: 'hint', text: cleanHint(field.hint) }));
    return wrap;
  }
  function attachValidation(wrap, field, getValue) {
    const errorEl = h('div', { class: 'error-text', hidden: true });
    wrap.append(errorEl);
    wrap._validate = () => {
      const value = getValue();
      let problem = null;
      // Inside an optional section nobody has filled in? Then its required fields don't apply.
      for (let group = wrap.parentElement?.closest('[data-optional-group]'); group; group = group.parentElement?.closest('[data-optional-group]')) {
        if (group._unused && group._unused()) { wrap.classList.remove('invalid'); errorEl.hidden = true; return null; }
      }
      if (isRequired(field) && isEmpty(value) && field.widget !== 'boolean') problem = 'This field is required.';
      else if (field.pattern && typeof value === 'string' && value && !new RegExp(field.pattern[0]).test(value)) problem = field.pattern[1] || 'This doesn’t look right.';
      else if (field.widget === 'list' && Array.isArray(value)) {
        if (field.min && value.length < field.min) problem = `Add at least ${field.min}.`;
        if (field.max && value.length > field.max) problem = `No more than ${field.max}.`;
      }
      wrap.classList.toggle('invalid', Boolean(problem));
      errorEl.hidden = !problem;
      errorEl.textContent = problem || '';
      return problem;
    };
  }

  function renderField(field, obj, key, options = {}) {
    const widget = field.widget || 'string';
    if (widget === 'hidden') return null;
    if (obj[key] === undefined) {
      const initial = defaultFor(field);
      if (initial !== undefined && (widget === 'object' || widget === 'list' || field.default !== undefined)) obj[key] = initial;
    }
    const set = value => { obj[key] = value; markDirty(); };
    const id = `f-${Math.random().toString(36).slice(2, 9)}`;
    let control;
    let wrap;

    switch (widget) {
      case 'text':
      case 'markdown': {
        control = h('textarea', { id, rows: 3 });
        control.value = obj[key] ?? '';
        const grow = () => { control.style.height = 'auto'; control.style.height = Math.min(control.scrollHeight + 2, 480) + 'px'; };
        control.addEventListener('input', () => { set(control.value); grow(); });
        requestAnimationFrame(grow);
        break;
      }
      case 'number': {
        control = h('input', { id, type: 'number', step: field.value_type === 'int' ? '1' : 'any' });
        control.value = obj[key] ?? '';
        control.addEventListener('input', () => {
          if (control.value === '') return set(undefined);
          set(field.value_type === 'int' ? parseInt(control.value, 10) : Number(control.value));
        });
        break;
      }
      case 'boolean': {
        const input = h('input', { id, type: 'checkbox' });
        input.checked = Boolean(obj[key]);
        input.addEventListener('change', () => set(input.checked));
        control = h('label', { class: 'toggle', for: id }, input, h('span', { class: 'track' }), h('span', { text: input.checked ? 'On' : 'Off' }));
        input.addEventListener('change', () => { control.lastChild.textContent = input.checked ? 'On' : 'Off'; });
        break;
      }
      case 'select': {
        const choices = (field.options || []).map(option => (typeof option === 'object' ? option : { label: String(option), value: option }));
        if (field.multiple) {
          const selected = new Set(Array.isArray(obj[key]) ? obj[key] : []);
          control = h('div', { class: 'chips' }, choices.map(choice => {
            const input = h('input', { type: 'checkbox' });
            input.checked = selected.has(choice.value);
            input.addEventListener('change', () => {
              const next = choices.map(c => c.value).filter(value => (value === choice.value ? input.checked : (obj[key] || []).includes(value)));
              set(next);
            });
            return h('label', { class: 'chip' }, input, choice.label);
          }));
        } else {
          control = h('select', { id },
            !isRequired(field) || isEmpty(obj[key]) ? h('option', { value: '', text: 'Choose…' }) : null,
            choices.map(choice => h('option', { value: String(choice.value), text: choice.label })));
          control.value = obj[key] ?? '';
          control.addEventListener('change', () => {
            const choice = choices.find(c => String(c.value) === control.value);
            set(choice ? choice.value : '');
          });
        }
        break;
      }
      case 'image':
      case 'file':
        control = mediaControl(field, obj, key, set);
        break;
      case 'object': {
        const target = obj[key] && typeof obj[key] === 'object' ? obj[key] : (obj[key] = defaultsFor(field.fields));
        const body = h('div');
        renderFields(field.fields, target, body);
        const label = h('span', {}, field.label || field.name, isRequired(field) ? null : h('span', { class: 'optional', text: ' (optional)' }));
        wrap = field.collapsed
          ? h('details', { class: 'group' }, h('summary', { class: 'label' }, label), body)
          : h('fieldset', { class: 'group' }, h('legend', { class: 'label' }, label), body);
        if (field.hint) body.prepend(h('div', { class: 'hint', style: 'margin:-6px 0 14px', text: cleanHint(field.hint) }));
        if (!isRequired(field)) {
          // "In use" = any of its required fields (other than pre-filled defaults) has a value.
          const keyFields = (field.fields || []).filter(f => isRequired(f) && f.default === undefined && f.widget !== 'boolean');
          wrap.dataset.optionalGroup = '';
          wrap._unused = () => keyFields.length > 0 && keyFields.every(f => isEmpty(target[f.name]));
        }
        return wrap;
      }
      case 'list':
        control = listControl(field, obj, key);
        break;
      default: {
        control = h('input', { id, type: 'text' });
        control.value = obj[key] ?? '';
        control.addEventListener('input', () => set(control.value));
      }
    }

    wrap = fieldShell(field, control, { bare: options.bare });
    if (control.tagName !== 'DIV' && wrap.firstChild.classList.contains('field-label') && widget !== 'boolean') wrap.firstChild.setAttribute('for', id);
    attachValidation(wrap, field, () => obj[key]);
    return wrap;
  }

  // ---- lists
  function listControl(field, obj, key) {
    if (!Array.isArray(obj[key])) obj[key] = obj[key] == null || obj[key] === '' ? [] : String(obj[key]).split(',').map(s => s.trim()).filter(Boolean);
    const items = obj[key];
    const container = h('div');

    // Plain list of words, e.g. tags: one comma-separated box.
    if (!field.field && !field.fields) {
      const input = h('input', { type: 'text', placeholder: 'Separate items with commas' });
      input.value = items.join(', ');
      input.addEventListener('input', () => {
        obj[key] = input.value.split(',').map(s => s.trim()).filter(Boolean);
        markDirty();
      });
      container.append(input);
      return container;
    }

    const isObjects = Boolean(field.fields);
    const itemFields = isObjects ? field.fields : null;
    const itemField = isObjects ? null : { ...field.field, label: field.field.label || 'Item', required: false };
    const listEl = h('div', { class: 'list-items' });
    const addButton = h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => {
      items.push(isObjects ? defaultsFor(itemFields) : defaultFor(itemField) ?? '');
      markDirty();
      draw(items.length - 1);
    } }, `+ Add ${(field.label_singular || (isObjects ? 'item' : itemField.label)).toLowerCase()}`);

    const move = (index, delta) => {
      const target = index + delta;
      if (target < 0 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      markDirty();
      draw(target);
    };
    const removeAt = index => {
      if (isObjects && !confirm('Remove this item?')) return;
      items.splice(index, 1);
      markDirty();
      draw();
    };
    const itemTitle = (item, index) => {
      const text = field.summary ? fill(field.summary, item) : Object.values(item || {}).find(v => typeof v === 'string' && v.trim());
      return String(text || '').replace(/\s+/g, ' ').trim() || `Item ${index + 1}`;
    };

    function draw(openIndex = null) {
      listEl.replaceChildren(...items.map((item, index) => {
        const controls = [
          h('button', { class: 'btn-icon', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: e => { e.stopPropagation(); move(index, -1); } }, '↑'),
          h('button', { class: 'btn-icon', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: index === items.length - 1, onclick: e => { e.stopPropagation(); move(index, 1); } }, '↓'),
          h('button', { class: 'btn-icon', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); removeAt(index); } }, '✕')
        ];
        if (!isObjects) {
          const inner = renderField(itemField, items, index, { bare: true });
          return h('div', { class: 'list-simple' }, inner, h('div', { class: 'actions' }, controls));
        }
        const titleEl = h('span', { class: 'title', text: itemTitle(item, index) });
        const body = h('div', { class: 'list-item-body' });
        renderFields(itemFields, item, body);
        body.addEventListener('input', () => { titleEl.textContent = itemTitle(item, index); });
        body.addEventListener('change', () => { titleEl.textContent = itemTitle(item, index); });
        const card = h('div', { class: `list-item${openIndex === index ? '' : ' collapsed'}` },
          h('div', { class: 'list-item-head', onclick: () => card.classList.toggle('collapsed') }, h('span', { class: 'num', text: String(index + 1).padStart(2, '0') }), titleEl, controls),
          body);
        return card;
      }));
      addButton.disabled = Boolean(field.max && items.length >= field.max);
    }
    draw();
    container.append(listEl, addButton);
    return container;
  }

  // ---- photos & videos (Cloudinary)
  const isVideoUrl = url => /\/video\/upload\//.test(url) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
  function cloudinaryThumb(url) {
    const match = String(url).match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/)(.*)$/);
    if (!match) return url;
    const [, base, kind, rest] = match;
    const transform = kind === 'video' ? 'so_1,c_fill,w_240,h_168' : 'c_fill,g_auto,w_240,h_168';
    const thumb = /^[a-z]{1,3}_[^/]*\//.test(rest) ? url : `${base}${transform}/${rest}`;
    return kind === 'video' ? thumb.replace(/\.(mp4|webm|mov|m4v)(\?.*)?$/i, '.jpg') : thumb;
  }

  function mediaControl(field, obj, key, set) {
    const input = h('input', { type: 'url', placeholder: 'https://res.cloudinary.com/…' });
    input.value = obj[key] ?? '';
    const preview = h('div', { class: 'media-preview' });
    const drawPreview = () => {
      const url = input.value.trim();
      if (!url) return preview.replaceChildren();
      const video = isVideoUrl(url);
      preview.replaceChildren(h('img', { src: cloudinaryThumb(url), alt: '', loading: 'lazy' }), h('span', { class: 'tag', text: video ? 'Video' : 'Photo' }));
    };
    input.addEventListener('input', () => { set(input.value.trim()); drawPreview(); });
    const uploadButton = state.me.features.uploads
      ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
          try {
            const url = await openUploader(field.widget === 'image');
            if (url) { input.value = url; set(url); drawPreview(); }
          } catch (error) { toast(error.message); }
        } }, 'Upload…')
      : null;
    drawPreview();
    return h('div', { class: 'media-field' }, h('div', { class: 'media-row' }, input, uploadButton), preview);
  }

  let widgetScript;
  function loadUploadWidget() {
    widgetScript ||= new Promise((resolve, reject) => {
      const script = h('script', { src: 'https://upload-widget.cloudinary.com/global/all.js' });
      script.onload = resolve;
      script.onerror = () => reject(new Error('The uploader could not load. Check your connection.'));
      document.head.append(script);
    });
    return widgetScript;
  }
  async function openUploader(imagesOnly) {
    await loadUploadWidget();
    const { cloudName, apiKey, folder } = state.me.cloudinary;
    return new Promise(resolve => {
      let uploaded = null;
      const widget = window.cloudinary.createUploadWidget({
        cloudName, apiKey, folder,
        uploadSignature: (callback, paramsToSign) => {
          api('POST', '/api/cloudinary/sign', { params: paramsToSign }).then(r => callback(r.signature)).catch(error => toast(error.message));
        },
        sources: ['local', 'camera', 'url'],
        multiple: false,
        maxFiles: 1,
        clientAllowedFormats: imagesOnly ? ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'] : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'mp4', 'mov', 'webm', 'm4v'],
        maxImageFileSize: 10 * 1024 * 1024,
        maxVideoFileSize: 100 * 1024 * 1024,
        showAdvancedOptions: false,
        cropping: false,
        showPoweredBy: false,
        styles: { palette: { window: '#0A0A0A', windowBorder: '#2A2A2A', tabIcon: '#FFD400', menuIcons: '#BDBDBD', textDark: '#0A0A0A', textLight: '#FFFFFF', link: '#FFD400', action: '#FFD400', inactiveTabIcon: '#8A8A8A', error: '#FF6B6B', inProgress: '#FFD400', complete: '#4ADE80', sourceBg: '#141414' } }
      }, (error, result) => {
        if (error) { toast('Upload failed. Please try again.'); return; }
        if (result.event === 'success') uploaded = result.info.secure_url;
        if (result.event === 'queues-end' && uploaded) { widget.close({ quiet: true }); resolve(uploaded); }
        if (result.event === 'close') resolve(uploaded);
      });
      widget.open();
    });
  }

  // ---------------------------------------------------------------- team (owners)
  async function teamView() {
    if (state.me.role !== 'owner') return errorView(new Error('Only owners can manage the team.'));
    loading();
    let users;
    try { users = (await api('GET', '/api/team')).users; } catch (error) { return errorView(error); }

    const message = h('div');
    const say = (text, ok = true) => message.replaceChildren(h('div', { class: `notice ${ok ? 'notice-ok' : 'notice-error'}`, text }));
    const act = async (fn, okText) => { try { await fn(); say(okText); setTimeout(teamView, 900); } catch (error) { say(error.message, false); } };

    const addForm = h('form', { class: 'form-grid', onsubmit: event => {
      event.preventDefault();
      const f = event.target;
      act(() => api('POST', '/api/team', { email: f.email.value, name: f.name.value, role: f.role.value }), `${f.email.value} can now sign in.`);
    } },
      h('div', {}, h('label', { class: 'small muted', text: 'Email' }), h('input', { name: 'email', type: 'email', required: true, placeholder: 'name@company.com' })),
      h('div', {}, h('label', { class: 'small muted', text: 'Name' }), h('input', { name: 'name', type: 'text', placeholder: 'Optional' })),
      h('div', {}, h('label', { class: 'small muted', text: 'Role' }), h('select', { name: 'role' }, h('option', { value: 'editor', text: 'Editor' }), h('option', { value: 'owner', text: 'Owner' }))),
      h('button', { class: 'btn', type: 'submit' }, 'Add'));

    const rows = users.map(user => h('tr', {},
      h('td', {}, h('b', { text: user.name || user.email }), user.name ? h('div', { class: 'small muted', text: user.email }) : null),
      h('td', {}, h('span', { class: `pill ${user.role === 'owner' ? 'pill-owner' : ''}`, text: user.role === 'owner' ? 'Owner' : 'Editor' }), user.builtInOwner ? h('div', { class: 'small muted', text: 'set on the server' }) : null),
      h('td', { class: 'small muted', text: user.hasPassword ? 'Password set' : 'No password yet' }),
      h('td', {}, h('div', { class: 'row' },
        !user.builtInOwner && user.email !== state.me.email ? h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () =>
          act(() => api('POST', '/api/team', { email: user.email, name: user.name || '', role: user.role === 'owner' ? 'editor' : 'owner' }), 'Role updated.') }, user.role === 'owner' ? 'Make editor' : 'Make owner') : null,
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => {
          const password = prompt(`Set a temporary password for ${user.email} (at least 10 characters). Tell them to change it under “My account”.`);
          if (password) act(() => api('POST', `/api/team/${encodeURIComponent(user.email)}/password`, { password }), 'Password set.');
        } }, 'Set password'),
        !user.builtInOwner && user.email !== state.me.email ? h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => {
          if (confirm(`Remove ${user.email}? They will be signed out and can no longer sign in.`)) act(() => api('DELETE', `/api/team/${encodeURIComponent(user.email)}`), 'Removed.');
        } }, 'Remove') : null))));

    setView(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Team' }),
        h('p', { text: 'People who can sign in to this admin. They can use Google (with the same email), an emailed sign-in link, or a password.' }))),
      message,
      h('div', { class: 'panel' }, h('h2', { text: 'Add someone' }), addForm,
        h('p', { class: 'small muted', style: 'margin:12px 0 0', text: 'Editors can change all content. Owners can also manage the team and see the activity log.' })),
      h('div', { class: 'panel' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Person' }), h('th', { text: 'Role' }), h('th', { text: 'Password' }), h('th', {}))),
        h('tbody', {}, rows)))
    );
  }

  // ---------------------------------------------------------------- activity (owners)
  const ACTION_LABELS = { create: 'Created', update: 'Saved', delete: 'Deleted', 'sign-in': 'Signed in', team: 'Team', account: 'Account' };
  async function activityView() {
    if (state.me.role !== 'owner') return errorView(new Error('Only owners can see the activity log.'));
    loading();
    let activity;
    try { activity = (await api('GET', '/api/activity')).activity; } catch (error) { return errorView(error); }
    const when = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const itemCell = entry => {
      if (!entry.collection) return h('span', { class: 'muted', text: entry.summary || '' });
      const collection = collectionByName(entry.collection);
      const label = `${collection ? collection.labelSingular : entry.collection} · ${entry.entry}`;
      return entry.action === 'delete' ? h('span', { text: label }) : h('a', { href: `#/c/${entry.collection}/e/${entry.entry}`, text: label });
    };
    setView(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Activity' }),
        h('p', { text: 'Recent saves, sign-ins and team changes (kept for a year). Every content change is also in the website’s GitHub history.' }))),
      activity.length
        ? h('div', { class: 'panel' }, h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Who' }), h('th', { text: 'What' }), h('th', { text: 'Item' }))),
            h('tbody', {}, activity.map(entry => h('tr', {},
              h('td', { class: 'small muted', text: when(entry.at) }),
              h('td', {}, h('b', { text: entry.name || entry.email }), entry.name ? h('div', { class: 'small muted', text: entry.email }) : null),
              h('td', {}, h('span', { class: `pill ${entry.action === 'delete' ? 'pill-off' : ''}`, text: ACTION_LABELS[entry.action] || entry.action })),
              h('td', {}, itemCell(entry)))))))
        : h('div', { class: 'empty', text: 'No activity yet.' })
    );
  }

  // ---------------------------------------------------------------- my account
  function accountView(params) {
    const message = h('div');
    const say = (text, ok = true) => message.replaceChildren(h('div', { class: `notice ${ok ? 'notice-ok' : 'notice-error'}`, text }));
    if (params.get('first')) say('Welcome! Please choose your own password below.');
    if (params.get('reset')) say('Choose a new password below.');

    const nameForm = h('form', { onsubmit: async event => {
      event.preventDefault();
      try { await api('POST', '/api/account/name', { name: event.target.name.value }); state.me.name = event.target.name.value; renderNav(); say('Name saved.'); }
      catch (error) { say(error.message, false); }
    } }, h('div', { class: 'field' }, h('label', { text: 'Your name' }), h('input', { name: 'name', type: 'text', value: state.me.name || '' }),
      h('div', { class: 'hint', text: 'Shown in the history of changes on GitHub.' })), h('button', { class: 'btn btn-ghost', type: 'submit' }, 'Save name'));

    const passwordForm = h('form', { onsubmit: async event => {
      event.preventDefault();
      const f = event.target;
      if (f.password.value !== f.confirm.value) return say('The two passwords don’t match.', false);
      try { await api('POST', '/api/account/password', { password: f.password.value }); f.reset(); state.me.hasPassword = true; say('Password saved. You can now sign in with your email and password.'); }
      catch (error) { say(error.message, false); }
    } },
      h('div', { class: 'field' }, h('label', { text: 'New password' }), h('input', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 10 }),
        h('div', { class: 'hint', text: 'At least 10 characters. A short sentence works well.' })),
      h('div', { class: 'field' }, h('label', { text: 'Repeat new password' }), h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })),
      h('button', { class: 'btn', type: 'submit' }, state.me.hasPassword ? 'Change password' : 'Set password'));

    setView(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'My account' }), h('p', { text: state.me.email }))),
      message,
      h('div', { class: 'panel' }, h('h2', { text: 'Profile' }), nameForm),
      h('div', { class: 'panel' }, h('h2', { text: 'Password' }),
        h('p', { class: 'small muted', style: 'margin:-4px 0 14px', text: 'Optional if you sign in with Google or emailed links.' }), passwordForm)
    );
  }

  // ---------------------------------------------------------------- start
  $('[data-logout]').addEventListener('click', async () => {
    if (state.dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    state.dirty = false;
    await api('POST', '/auth/logout').catch(() => {});
    location.href = '/login';
  });
  // Phone menu: slides in over a backdrop; closes on ✕, backdrop tap, Escape or navigation.
  function setMenu(open) {
    const sidebar = $('[data-sidebar]');
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    $('[data-backdrop]').hidden = !open;
    document.body.classList.toggle('menu-open', open);
    $('[data-menu]').setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('.nav-link.active, .nav-link')?.focus({ preventScroll: true });
  }
  $('[data-menu]').addEventListener('click', () => setMenu(true));
  $('[data-menu-close]').addEventListener('click', () => { setMenu(false); $('[data-menu]').focus(); });
  $('[data-backdrop]').addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenu(false); $('[data-menu]').focus(); } });
  $('[data-nav]').addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });

  (async () => {
    try {
      [state.me, state.schema] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/schema')]);
    } catch (error) {
      return errorView(error);
    }
    renderNav();
    route();
  })();
})();
