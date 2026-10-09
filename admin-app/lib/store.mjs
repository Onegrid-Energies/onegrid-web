// Reads and writes repository files. Two backends with the same interface:
//   github — production: the GitHub contents API (each save is a commit on the branch)
//   local  — development/testing: files in this checkout
// Every read returns a `sha` (git blob hash). Saves must send the sha they read; if the file has
// changed since (e.g. another editor saved it), the save is refused with a conflict instead of
// overwriting their work.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, REPO_DIR } from './config.mjs';

export class ConflictError extends Error {
  constructor(message = 'This item was changed by someone else since you opened it.') { super(message); this.status = 409; }
}
export class NotFoundError extends Error {
  constructor(message = 'Not found.') { super(message); this.status = 404; }
}

const blobSha = buffer => createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');

// Only these parts of the repository can ever be read or written by the admin.
const ALLOWED = [/^content\/[a-z0-9_/-]+\.json$/i];
export function assertAllowedPath(file) {
  if (typeof file !== 'string' || file.includes('..') || file.startsWith('/') || !ALLOWED.some(rule => rule.test(file))) {
    throw Object.assign(new Error(`Access to "${file}" is not allowed.`), { status: 400 });
  }
}

// ---------------------------------------------------------------- local files

const local = {
  async read(file) {
    try {
      const buffer = await readFile(path.join(REPO_DIR, file));
      return { content: buffer.toString('utf8'), sha: blobSha(buffer) };
    } catch (error) {
      if (error.code === 'ENOENT') throw new NotFoundError(`${file} does not exist.`);
      throw error;
    }
  },
  async list(dir) {
    try {
      const names = (await readdir(path.join(REPO_DIR, dir))).filter(name => name.endsWith('.json')).sort();
      return Promise.all(names.map(async name => ({ name, path: `${dir}/${name}`, sha: (await local.read(`${dir}/${name}`)).sha })));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  },
  async write(file, content, { sha, message } = {}) {
    let current = null;
    try { current = await local.read(file); } catch (error) { if (!(error instanceof NotFoundError)) throw error; }
    if (sha === undefined && current) throw new ConflictError(`${file} already exists.`);
    if (sha && (!current || current.sha !== sha)) throw new ConflictError();
    await mkdir(path.dirname(path.join(REPO_DIR, file)), { recursive: true });
    await writeFile(path.join(REPO_DIR, file), content);
    console.log(`[local] ${message}`);
    return { sha: blobSha(Buffer.from(content)) };
  },
  async remove(file, { sha, message } = {}) {
    const current = await local.read(file);
    if (current.sha !== sha) throw new ConflictError();
    await rm(path.join(REPO_DIR, file));
    console.log(`[local] ${message}`);
  }
};

// ---------------------------------------------------------------- GitHub

const API = 'https://api.github.com';
async function github(method, endpoint, body) {
  const response = await fetch(`${API}/repos/${config.github.repo}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'onegrid-admin',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 401 || response.status === 403) {
    console.error('GitHub refused the request', response.status, (await response.text()).slice(0, 200));
    throw Object.assign(new Error('The admin can’t reach the website’s GitHub repository — the GitHub token is invalid, expired or missing permissions. Ask an owner to check GITHUB_TOKEN on Render.'), { status: 502 });
  }
  if (response.status === 404) throw new NotFoundError();
  if (response.status === 409 || (response.status === 422 && /sha/i.test(await response.clone().text()))) throw new ConflictError();
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(`GitHub error ${response.status}: ${detail.slice(0, 300)}`), { status: 502 });
  }
  return response.status === 204 ? null : response.json();
}
const encodePath = file => file.split('/').map(encodeURIComponent).join('/');
const ref = () => `ref=${encodeURIComponent(config.github.branch)}`;

const remote = {
  async read(file) {
    const data = await github('GET', `/contents/${encodePath(file)}?${ref()}`);
    if (Array.isArray(data) || data.type !== 'file') throw new NotFoundError(`${file} is not a file.`);
    // Files over 1 MB come without inline content; fetch them through the blob API.
    const base64 = data.content || (await github('GET', `/git/blobs/${data.sha}`)).content;
    return { content: Buffer.from(base64, 'base64').toString('utf8'), sha: data.sha };
  },
  async list(dir) {
    try {
      const data = await github('GET', `/contents/${encodePath(dir)}?${ref()}`);
      return (Array.isArray(data) ? data : [])
        .filter(item => item.type === 'file' && item.name.endsWith('.json'))
        .map(item => ({ name: item.name, path: item.path, sha: item.sha }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (error instanceof NotFoundError) return [];
      throw error;
    }
  },
  async write(file, content, { sha, message, author } = {}) {
    const result = await github('PUT', `/contents/${encodePath(file)}`, {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: config.github.branch,
      ...(sha ? { sha } : {}),
      ...(author ? { author } : {})
    });
    return { sha: result.content.sha };
  },
  async remove(file, { sha, message, author } = {}) {
    await github('DELETE', `/contents/${encodePath(file)}`, { message, sha, branch: config.github.branch, ...(author ? { author } : {}) });
  }
};

// ---------------------------------------------------------------- public interface

const backend = config.backend === 'local' ? local : remote;

// Small read cache keyed by sha, so listing a collection doesn't refetch unchanged files.
const contentCache = new Map();

export const store = {
  backend: config.backend,
  async read(file) {
    assertAllowedPath(file);
    const result = await backend.read(file);
    contentCache.set(`${file}@${result.sha}`, result.content);
    return result;
  },
  async readCached(file, sha) {
    const cached = contentCache.get(`${file}@${sha}`);
    return cached !== undefined ? { content: cached, sha } : store.read(file);
  },
  async list(dir) {
    if (!/^content\/[a-z0-9_/-]+$/i.test(dir)) throw Object.assign(new Error('Invalid folder.'), { status: 400 });
    return backend.list(dir);
  },
  async write(file, content, options) {
    assertAllowedPath(file);
    return backend.write(file, content, options);
  },
  async remove(file, options) {
    assertAllowedPath(file);
    return backend.remove(file, options);
  }
};
