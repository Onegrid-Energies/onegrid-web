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
    if (state.me) route(); // before start-up finishes, start-up does the routing
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
    if (parts[0] === 'analytics') return analyticsView(params);
    if (parts[0] === 'account') return accountView(params);
    setView(h('div', { class: 'empty', text: 'Page not found.' }));
  }

  // ---------------------------------------------------------------- navigation
  function renderNav() {
    const nav = $('[data-nav]');
    nav.replaceChildren(
      h('a', { class: 'nav-link', href: '#/', 'data-route': '' }, 'Dashboard'),
      state.me.role === 'owner' ? h('a', { class: 'nav-link', href: '#/analytics', 'data-route': 'analytics' }, 'Analytics') : null,
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
        const grow = () => {
          if (!control.offsetParent) return; // hidden (closed section): measured again when it opens
          control.style.height = 'auto';
          control.style.height = Math.min(control.scrollHeight + 2, 480) + 'px';
        };
        control._grow = grow;
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
  // Re-measure text boxes that were hidden when they were drawn (closed sections and items).
  function growTextareas(root) {
    requestAnimationFrame(() => root.querySelectorAll('textarea').forEach(area => area._grow?.()));
  }
  document.addEventListener('toggle', event => { if (event.target.open) growTextareas(event.target); }, true);

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

    // A small preview of the item's photo (gallery, logos…) next to its title.
    const thumbField = isObjects ? itemFields.find(f => f.widget === 'image' || f.widget === 'file') : null;
    const drawThumb = (thumb, item) => {
      const url = thumbField && String(item?.[thumbField.name] || '').trim();
      thumb.hidden = !url;
      if (url && thumb.dataset.url !== url) { thumb.dataset.url = url; thumb.src = cloudinaryThumb(url); }
    };

    function draw(openIndex = null) {
      listEl.replaceChildren(...items.map((item, index) => {
        const iconButtons = () => [
          h('button', { class: 'btn-icon', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: e => { e.stopPropagation(); move(index, -1); } }, '↑'),
          h('button', { class: 'btn-icon', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: index === items.length - 1, onclick: e => { e.stopPropagation(); move(index, 1); } }, '↓'),
          h('button', { class: 'btn-icon', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); removeAt(index); } }, '✕')
        ];
        if (!isObjects) {
          const inner = renderField(itemField, items, index, { bare: true });
          return h('div', { class: 'list-simple' }, inner, h('div', { class: 'actions' }, iconButtons()));
        }
        const titleEl = h('span', { class: 'title', text: itemTitle(item, index) });
        const thumb = h('img', { class: 'thumb', alt: '', loading: 'lazy', hidden: true });
        drawThumb(thumb, item);
        const body = h('div', { class: 'list-item-body' });
        // Phones: move/remove live here, with words, instead of crowding the title row.
        const bodyActions = h('div', { class: 'list-item-actions' },
          h('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: index === 0, onclick: () => move(index, -1) }, '↑ Move up'),
          h('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: index === items.length - 1, onclick: () => move(index, 1) }, '↓ Move down'),
          h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => removeAt(index) }, 'Remove'));
        // Fields are built the first time an item is opened, so long lists stay quick on phones.
        let built = false;
        const build = () => {
          if (built) return;
          built = true;
          renderFields(itemFields, item, body);
          body.append(bodyActions);
        };
        const refresh = () => { titleEl.textContent = itemTitle(item, index); drawThumb(thumb, item); };
        body.addEventListener('input', refresh);
        body.addEventListener('change', refresh);
        const card = h('div', { class: `list-item${openIndex === index ? '' : ' collapsed'}` },
          h('div', { class: 'list-item-head', onclick: () => {
            build();
            card.classList.toggle('collapsed');
            growTextareas(card);
          } }, h('span', { class: 'num', text: String(index + 1).padStart(2, '0') }), thumb, titleEl, h('span', { class: 'row-actions' }, iconButtons())),
          body);
        if (openIndex === index) { build(); requestAnimationFrame(() => growTextareas(card)); }
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

  // ---------------------------------------------------------------- analytics (owners)
  const RANGE_LABELS = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days', '12m': '12 months' };
  const PAGE_LABELS = { home: 'Home', about: 'About', oneplastic: 'OnePlastic', 'stories-of-hope': 'Stories of Hope', recognitions: 'Recognitions', quote: 'Get a quote', contact: 'Contact', other: 'Other', '404': 'Not found' };
  const ACTIONS = [
    ['whatsapp', 'WhatsApp taps'], ['enquiry', 'Forms sent'], ['plan_click', 'Solar plans selected'], ['quote_click', 'Clicks to Get a quote'],
    ['contact_click', 'Clicks to Contact'], ['email', 'Email taps'], ['call', 'Phone taps'], ['media_open', 'Gallery photos opened'],
    ['video_play', 'Videos played'], ['outbound', 'Links to other sites']
  ];
  const num = value => Math.round(value || 0).toLocaleString();
  const pct = value => `${Math.round((value || 0) * 100)}%`;
  const dur = seconds => {
    const s = Math.round(seconds || 0);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  };
  const flag = code => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1f1a5 + c.charCodeAt(0))) + ' ' : '');
  const shortTitle = title => String(title || '').split(/ — | \| /)[0].trim();
  const ago = date => {
    const s = Math.max(0, Math.round((Date.now() - new Date(date)) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  function delta(current, previous, { lowerIsBetter = false, asPoints = false } = {}) {
    if (!previous && !current) return null;
    if (!previous) return h('span', { class: 'delta up', text: 'new' });
    const change = asPoints ? (current - previous) * 100 : ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return h('span', { class: 'delta', text: '0%' });
    const good = lowerIsBetter ? change < 0 : change > 0;
    return h('span', { class: `delta ${good ? 'up' : 'down'}`, title: 'Compared with the previous period' }, `${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change))}${asPoints ? ' pts' : '%'}`);
  }

  // Horizontal bar list: rows of { label, value, sub }.
  function bars(rows, { empty = 'No data yet.', format = num, max } = {}) {
    if (!rows.length) return h('div', { class: 'muted small empty-note', text: empty });
    const top = max || Math.max(...rows.map(row => row.value), 1);
    return h('div', { class: 'bars' }, rows.map(row => h('div', { class: 'bar-row', title: row.title || row.label },
      h('div', { class: 'bar-fill', style: `width:${Math.max(2, (row.value / top) * 100)}%` }),
      h('span', { class: 'bar-label' }, row.prefix || '', row.href ? h('a', { href: row.href, target: '_blank', rel: 'noopener', text: row.label }) : row.label),
      row.sub ? h('span', { class: 'bar-sub', text: row.sub }) : null,
      h('b', { class: 'bar-value', text: format(row.value) }))));
  }

  function table(columns, rows, empty = 'No data yet.') {
    if (!rows.length) return h('div', { class: 'muted small empty-note', text: empty });
    return h('div', { class: 'table-scroll' }, h('table', { class: 'table data-table' },
      h('thead', {}, h('tr', {}, columns.map(column => h('th', { class: column.num ? 'num' : '', text: column.label })))),
      h('tbody', {}, rows.map(row => h('tr', {}, columns.map(column => h('td', { class: column.num ? 'num' : '', 'data-label': column.label }, column.render(row))))))));
  }

  // Line chart (SVG) of visitors and page views, with a hover/tap readout.
  function lineChart(series, unit) {
    const W = window.innerWidth < 600 ? 420 : 760; const H = window.innerWidth < 600 ? 240 : 220; const P = { l: 34, r: 10, t: 12, b: 26 };
    const max = Math.max(4, ...series.map(point => Math.max(point.visitors, point.pageviews)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step;
    const x = i => P.l + (series.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (series.length - 1));
    const y = v => H - P.b - (v / top) * (H - P.t - P.b);
    const path = key => series.map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point[key]).toFixed(1)}`).join('');
    const label = bucket => {
      if (unit === 'hour') return `${String(bucket).padStart(2, '0')}:00`;
      if (unit === 'month') return new Date(`${bucket}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      return new Date(`${bucket}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    };
    const svgNs = 'http://www.w3.org/2000/svg';
    const s = (tag, attrs) => { const el = document.createElementNS(svgNs, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Visitors and page views over time' });
    for (let v = 0; v <= top; v += step) {
      svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
      const t = s('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }); t.textContent = num(v); svg.append(t);
    }
    const every = Math.ceil(series.length / (W < 600 ? 5 : 8));
    const last = series.length - 1;
    series.forEach((point, i) => {
      // Every few points, plus the last one when it isn't crowded by its neighbour.
      if (i !== last ? i % every || (last - i < every / 2 && last % every) : 0) return;
      const t = s('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' });
      t.textContent = label(point.bucket); svg.append(t);
    });
    svg.append(s('path', { d: `${path('visitors')}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'area' }));
    svg.append(s('path', { d: path('pageviews'), class: 'line line-2' }));
    svg.append(s('path', { d: path('visitors'), class: 'line' }));
    const cursor = s('line', { y1: P.t, y2: H - P.b, class: 'cursor', visibility: 'hidden' });
    const dot = s('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
    svg.append(cursor, dot);
    const readout = h('div', { class: 'chart-readout muted small', text: 'Point at the chart to see each ' + (unit === 'hour' ? 'hour' : unit) + '.' });
    const show = clientX => {
      const box = svg.getBoundingClientRect();
      const px = ((clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (series.length - 1))));
      const point = series[i];
      cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(point.visitors)); dot.setAttribute('visibility', 'visible');
      readout.replaceChildren(h('b', { text: label(point.bucket) }), ` · ${num(point.visitors)} visitors · ${num(point.pageviews)} page views${point.leads ? ` · ${num(point.leads)} enquiry actions` : ''}`);
    };
    svg.addEventListener('pointermove', event => show(event.clientX));
    svg.addEventListener('pointerdown', event => show(event.clientX));
    return h('div', {}, h('div', { class: 'legend small' }, h('span', { class: 'key key-1' }, 'Visitors'), h('span', { class: 'key key-2' }, 'Page views')), svg, readout);
  }

  // Column chart for hours of the day / days of the week.
  function columns(values, labels, every = 1) {
    const top = Math.max(1, ...values);
    return h('div', { class: 'columns' }, values.map((value, i) => h('div', { class: 'column', title: `${labels[i]}: ${num(value)} page views` },
      h('div', { class: 'column-bar', style: `height:${Math.max(value ? 4 : 1, (value / top) * 100)}%` }),
      h('span', { class: 'column-label', text: i % every ? '' : labels[i] }))));
  }

  const panel = (title, ...children) => h('section', { class: 'panel' }, h('h2', { text: title }), ...children);
  const note = text => h('p', { class: 'small muted panel-note', text });

  let analyticsTimer;
  async function analyticsView(params) {
    clearInterval(analyticsTimer);
    if (state.me.role !== 'owner') return errorView(new Error('Only owners can see the website analytics.'));
    const range = RANGE_LABELS[params.get('range')] ? params.get('range') : '30d';
    loading();
    let data;
    try { data = await api('GET', `/api/analytics?range=${range}`); } catch (error) { return errorView(error); }
    const site = state.me.siteUrl;
    const S = data.summary; const P = data.previous;

    // Header: range picker, export, refresh
    const rangeTabs = h('div', { class: 'tabs range-tabs', role: 'tablist' }, Object.entries(RANGE_LABELS).map(([key, text]) =>
      h('a', { href: `#/analytics?range=${key}`, role: 'tab', 'aria-selected': String(key === range), text })));
    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', { text: 'Analytics' }), h('p', { text: `Visits to ${site.replace(/^https?:\/\//, '')} · ${RANGE_LABELS[range].toLowerCase()} · times shown in ${data.timezone.replace('_', ' ')}` })),
      h('div', { class: 'row head-actions' },
        h('a', { class: 'btn btn-ghost btn-small', href: `/api/analytics/export?range=${range}`, download: '' }, 'Export CSV'),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => analyticsView(params) }, 'Refresh')));

    // Setup notices
    const message = h('div');
    let setup = null;
    if (!data.tracking.connected) {
      const connect = h('button', { class: 'btn', type: 'button', onclick: async () => {
        connect.disabled = true;
        try {
          await api('POST', '/api/analytics/connect');
          message.replaceChildren(h('div', { class: 'notice notice-ok', text: 'Connected. The website is being rebuilt — visits will start appearing here within a few minutes.' }));
          setup.remove();
        } catch (error) { connect.disabled = false; message.replaceChildren(h('div', { class: 'notice notice-error', text: error.message })); }
      } }, 'Connect the website');
      setup = h('div', { class: 'panel setup' },
        h('h2', { text: data.tracking.url ? 'The website reports to a different address' : 'Turn on visit tracking' }),
        h('p', { class: 'muted', text: data.tracking.url
          ? `The website currently sends visits to ${data.tracking.url}, but this admin is at ${data.tracking.expected}. Connect it to this admin to see its visits here.`
          : 'The website isn’t sending visits yet. Connecting saves this admin’s address in the site settings; the site rebuilds automatically and starts counting anonymous visits (no cookies, no personal data).' }),
        connect);
    } else if (!data.total) {
      setup = h('div', { class: 'notice notice-warn', text: 'Tracking is connected. Waiting for the first visit — open the website in another tab to test it (it can take a few minutes after connecting for the site to rebuild).' });
    }

    // Live
    const live = h('div', { class: 'live' },
      h('span', { class: `live-dot${data.live.visitors ? ' on' : ''}` }),
      h('b', { text: `${num(data.live.visitors)} ${data.live.visitors === 1 ? 'person' : 'people'} on the site now` }),
      data.live.pages.length ? h('span', { class: 'muted small', text: ' · ' + data.live.pages.map(row => row.label).slice(0, 4).join(', ') }) : null);

    // Headline numbers
    const kpi = (label, value, change, hint) => h('div', { class: 'kpi', title: hint || '' }, h('span', { class: 'kpi-label', text: label }), h('b', { class: 'kpi-value', text: value }), change || h('span', { class: 'delta' }));
    const kpis = h('div', { class: 'kpis' },
      kpi('Visitors', num(S.visitors), delta(S.visitors, P.visitors), 'Different people (counted per day, without cookies).'),
      kpi('Visits', num(S.visits), delta(S.visits, P.visits), 'A visit ends after 30 minutes without activity.'),
      kpi('Page views', num(S.pageviews), delta(S.pageviews, P.pageviews)),
      kpi('Pages per visit', (S.viewsPerVisit || 0).toFixed(1), delta(S.viewsPerVisit, P.viewsPerVisit)),
      kpi('Avg. visit length', dur(S.visitDuration), delta(S.visitDuration, P.visitDuration), 'Time the site was actually on screen.'),
      kpi('Bounce rate', pct(S.bounceRate), delta(S.bounceRate, P.bounceRate, { lowerIsBetter: true, asPoints: true }), 'Visits that saw one page for under 30 seconds and did nothing else.'),
      kpi('Enquiry actions', num(S.leads), delta(S.leads, P.leads), 'WhatsApp, phone and email taps plus enquiry forms sent.'),
      kpi('Visits with an enquiry', pct(S.conversionRate), delta(S.conversionRate, P.conversionRate, { asPoints: true }), 'Share of visits that included an enquiry action.'));

    // Actions
    const A = data.actions;
    const actionTiles = h('div', { class: 'action-tiles' }, ACTIONS.map(([key, label]) =>
      h('div', { class: 'action-tile' }, h('b', { text: num(A.current[key]) }), h('span', { text: label }), delta(A.current[key], A.previous[key]))));

    const pageRow = row => h('div', {}, h('a', { href: site + row.path, target: '_blank', rel: 'noopener', text: shortTitle(row.title) || row.path }), h('div', { class: 'small muted', text: row.path }));
    const timeAndScroll = [
      { label: 'Avg. time', num: true, render: row => dur(row.time) },
      { label: 'Read', num: true, render: row => (row.scroll ? `${Math.round(row.scroll)}%` : '—') }
    ];

    const S2 = data.sources;
    const AU = data.audience;
    const hourLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);

    // Campaign link builder
    const builder = (() => {
      const out = h('input', { type: 'text', readOnly: true, placeholder: 'Your tracked link appears here' });
      const fields = { path: h('input', { type: 'text', value: '/', placeholder: '/' }), source: h('input', { type: 'text', placeholder: 'e.g. facebook, flyer, linkedin' }), campaign: h('input', { type: 'text', placeholder: 'e.g. solar-promo' }) };
      const update = () => {
        const url = new URL(fields.path.value.trim() || '/', site);
        if (fields.source.value.trim()) url.searchParams.set('utm_source', fields.source.value.trim().toLowerCase());
        if (fields.campaign.value.trim()) url.searchParams.set('utm_campaign', fields.campaign.value.trim().toLowerCase());
        out.value = fields.source.value.trim() ? url.href : '';
      };
      Object.values(fields).forEach(input => input.addEventListener('input', update));
      const copy = h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => { if (!out.value) return; try { await navigator.clipboard.writeText(out.value); toast('Link copied.'); } catch { out.select(); } } }, 'Copy');
      return h('div', { class: 'builder' },
        h('div', { class: 'form-grid builder-grid' },
          h('div', {}, h('label', { class: 'small muted', text: 'Page' }), fields.path),
          h('div', {}, h('label', { class: 'small muted', text: 'Where you’ll share it' }), fields.source),
          h('div', {}, h('label', { class: 'small muted', text: 'Campaign (optional)' }), fields.campaign)),
        h('div', { class: 'media-row' }, out, copy));
    })();

    setView(
      head, message, setup, rangeTabs, live, kpis,
      panel('Visitors over time', lineChart(data.series, data.unit)),
      h('div', { class: 'grid-2' },
        panel('Enquiries & actions', actionTiles,
          h('h3', { text: 'WhatsApp taps — from which page' }), bars(A.whatsappFrom.map(row => ({ label: row.label, value: row.count }))),
          h('h3', { text: 'What enquiries are about' }), bars(A.enquiryTopics.map(row => ({ label: row.label, value: row.count })), { empty: 'No enquiry forms sent yet.' }),
          h('h3', { text: 'Buttons that led to the Contact page' }), bars(A.contactFrom.map(row => ({ label: row.label, value: row.count })), { empty: 'None yet.' }),
          h('h3', { text: 'Buttons that led to Get a quote' }), bars(A.quoteFrom.map(row => ({ label: row.label, value: row.count })), { empty: 'None yet.' })),
        panel('How people find the site',
          bars(S2.channels.map(row => ({ label: row.label, value: row.visits, sub: `${num(row.visitors)} people` }))),
          h('h3', { text: 'Websites & apps that sent visitors' }), bars(S2.referrers.map(row => ({ label: row.label, value: row.visits })), { empty: 'No referring websites yet.' }),
          h('h3', { text: 'Campaign links' }), bars(S2.campaigns.map(row => ({ label: row.label, value: row.visits })), { empty: 'No tracked campaign links used yet — create one below.' }),
          note('Counts are visits. Search = Google, Bing, etc.; Social = Facebook, LinkedIn, WhatsApp, X, Instagram…; AI assistants = ChatGPT, Perplexity, Gemini…'))),
      panel('Pages', table([{ label: 'Page', render: pageRow }, { label: 'Views', num: true, render: row => num(row.views) }, { label: 'Visitors', num: true, render: row => num(row.visitors) }, ...timeAndScroll], data.pages),
        note('Avg. time = time the page was on screen. Read = how far down people scrolled, on average.')),
      h('div', { class: 'grid-2' },
        panel('Sections of the site', bars(data.sections.map(row => ({ label: PAGE_LABELS[row.page] || row.page, value: row.views, sub: `${num(row.visitors)} people · ${dur(row.time)}` })))),
        panel('First and last pages',
          h('h3', { text: 'Where visits start' }), bars(data.entryPages.map(row => ({ label: row.label, value: row.views }))),
          h('h3', { text: 'Where visits end' }), bars(data.exitPages.map(row => ({ label: row.label, value: row.views }))))),
      panel('Solar plans',
        table([{ label: 'Plan', render: row => row.label }, { label: 'Seen', num: true, render: row => num(row.seen) }, { label: 'People', num: true, render: row => num(row.people) }, { label: 'Selected', num: true, render: row => num(row.clicks) }], data.plans, 'No plan views yet.'),
        note('Seen = the plan was on screen for at least a second on the Quote page. Selected = its “Select” (WhatsApp) button was tapped.')),
      h('div', { class: 'grid-2' },
        panel('Gallery & videos',
          bars(data.media.map(row => ({ label: row.label, value: row.count, sub: `${num(row.people)} people` })), { empty: 'No photos opened or videos played yet.' }),
          A.filters.length ? h('h3', { text: 'Gallery filters used' }) : null,
          A.filters.length ? bars(A.filters.map(row => ({ label: row.label, value: row.count }))) : null),
        panel('Programmes',
          table([{ label: 'Programme', render: row => row.label }, { label: 'Seen', num: true, render: row => num(row.seen) }, { label: 'People', num: true, render: row => num(row.people) }], data.programmes, 'No programme views yet.'),
          note('How often each programme card on the home page (OnePlastic, OneHealth, OneBox…) was on screen for at least a second.'))),
      h('div', { class: 'grid-2' },
        panel('Countries', bars(AU.countries.map(row => ({ prefix: flag(row.key), label: row.label, value: row.visitors }))),
          note('Approximate, from the visitor’s time zone (or Cloudflare when available). Counts are people.')),
        panel('Devices',
          bars(AU.devices.map(row => ({ label: row.label, value: row.visitors }))),
          h('h3', { text: 'New or returning' }), bars(AU.newVsReturning.map(row => ({ label: row.label, value: row.visitors })), { empty: 'Not known yet.' }))),
      h('div', { class: 'grid-3' },
        panel('Browsers', bars(AU.browsers.map(row => ({ label: row.label, value: row.visitors })))),
        panel('Operating systems', bars(AU.os.map(row => ({ label: row.label, value: row.visitors })))),
        panel('Languages', bars(AU.languages.map(row => ({ label: row.label, value: row.visitors }))))),
      panel('When people visit',
        h('h3', { text: 'Time of day' }), columns(data.hours, hourLabels, 3),
        h('h3', { text: 'Day of the week' }), columns(Object.values(data.weekdays), Object.keys(data.weekdays))),
      panel('Recent visits', table([
          { label: 'When', render: row => h('span', { class: 'small nowrap', text: ago(row.at) }) },
          { label: 'Page', render: row => h('span', { text: row.path }) },
          { label: 'From', render: row => h('span', { class: 'small' }, flag(row.country), row.countryName, row.source ? h('div', { class: 'muted', text: `via ${row.source}` }) : null) },
          { label: 'Device', render: row => h('span', { class: 'small', text: `${row.device} · ${row.browser}` }) }
        ], data.recent, 'No visits yet.')),
      h('div', { class: 'grid-2' },
        panel('Links to other websites', bars(A.outbound.map(row => ({ label: row.label, value: row.count })), { empty: 'No outgoing clicks yet.' })),
        panel('Broken links (page not found)',
          bars(data.notFound.map(row => ({ label: row.path, value: row.views, sub: row.from ? `from ${row.from}` : '' })), { empty: 'No broken links visited. 🎉' }),
          note('Addresses people tried that don’t exist — fix the link where it came from, if you can.'))),
      panel('Track a campaign link',
        h('p', { class: 'small muted panel-note', text: 'Sharing the website on a flyer, in a WhatsApp status or a social post? Make a tracked link, and visits from it show up under “Campaign links”.' }),
        builder),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'Visits are anonymous: no cookies and no IP addresses are stored. Your own visits count too — to stop that on a device, open ',
        h('a', { href: `${site}/?analytics=off`, target: '_blank', rel: 'noopener', text: 'the website with ?analytics=off' }),
        ' once in each browser you use. Data is kept for two years.')
    );

    // Keep “on the site now” fresh while this page stays open.
    analyticsTimer = setInterval(async () => {
      if (!location.hash.startsWith('#/analytics') || !live.isConnected) return clearInterval(analyticsTimer);
      try {
        const fresh = await api('GET', `/api/analytics?range=today`);
        live.querySelector('.live-dot').classList.toggle('on', fresh.live.visitors > 0);
        live.querySelector('b').textContent = `${num(fresh.live.visitors)} ${fresh.live.visitors === 1 ? 'person' : 'people'} on the site now`;
      } catch { /* try again next time */ }
    }, 60_000);
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
