// Lists files in the Cloudinary account and saves their details to cloudinary-files.json.
//
//   node utils/get_cloudinary_urls.js                         # files in onegrid-web/oneplastic-shop
//   node utils/get_cloudinary_urls.js some/other/folder        # files in another folder
//
// Uses CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET from admin-app/.env
// (or the environment) and Cloudinary's web API directly, so it needs no extra packages.
// The JSON file is written to the folder you run the command from.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
if (!cloudName || !apiKey || !apiSecret) {
  console.error('Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in admin-app/.env first.');
  process.exit(1);
}

const API = `https://api.cloudinary.com/v1_1/${cloudName}`;
const AUTH = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;

async function cloudinary(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: AUTH, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cloudinary ${response.status}: ${data.error?.message || response.statusText}`);
  return data;
}

// Every uploaded image in the account (same as cloudinary.api.resources({ type: 'upload' })).
async function getAllResources() {
  let allResources = [];
  let nextCursor = null;

  do {
    const query = new URLSearchParams({ max_results: '500', ...(nextCursor ? { next_cursor: nextCursor } : {}) });
    const result = await cloudinary(`${API}/resources/image/upload?${query}`);
    allResources = allResources.concat(result.resources);
    nextCursor = result.next_cursor;
  } while (nextCursor);

  return allResources;
}

// Every file (images, videos, raw) inside a folder and its subfolders.
async function searchFolder(folderPath) {
  let allResources = [];
  let nextCursor = null;

  do {
    const result = await cloudinary(`${API}/resources/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: `folder:"${folderPath}/*"`, max_results: 500, ...(nextCursor ? { next_cursor: nextCursor } : {}) })
    });
    allResources = allResources.concat(result.resources);
    nextCursor = result.next_cursor;
  } while (nextCursor);

  return allResources;
}

function save(resources) {
  writeFileSync('cloudinary-files.json', JSON.stringify(resources, null, 2));
  console.log(`Saved ${resources.length} resources to ${path.resolve('cloudinary-files.json')}`);
}

// To list the whole account instead:
// save(await getAllResources());

const folder = process.argv[2] || 'onegrid-web/oneplastic-shop';
try {
  save(await searchFolder(folder));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
