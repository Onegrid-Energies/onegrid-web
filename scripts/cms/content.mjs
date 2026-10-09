import { readdir, readFile } from 'node:fs/promises';

// Pages in navigation order: content file name, route folder and public path.
export const PAGES = [
  { name: 'home', label: 'Home', directory: 'home', path: '/' },
  { name: 'about', label: 'About', directory: 'about', path: '/about/' },
  { name: 'oneplastic', label: 'OnePlastic', directory: 'oneplastic', path: '/oneplastic/' },
  { name: 'stories', label: 'Stories of Hope', directory: 'stories-of-hope', path: '/stories-of-hope/' },
  { name: 'recognitions', label: 'Recognitions', directory: 'recognitions', path: '/recognitions/' },
  { name: 'quote', label: 'Quote', directory: 'quote', path: '/quote/' },
  { name: 'contact', label: 'Contact', directory: 'contact', path: '/contact/' }
];

export async function readContent(directory = 'content') {
  const files = {};
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names.filter(file => file.endsWith('.json'))) {
    files[name.replace(/\.json$/, '')] = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
  }
  return files;
}
