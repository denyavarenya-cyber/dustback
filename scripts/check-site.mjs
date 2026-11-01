// Checks the static site before it can be deployed. Run: node scripts/check-site.mjs
// Exits non-zero on any failure. No dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.argv[2] ?? fileURLToPath(new URL('../site/', import.meta.url));
const failures = [];
const fail = (file, msg) => failures.push(`${relative(SITE, file) || file}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SITE);
const html = files.filter((f) => extname(f) === '.html');

const BANNED = [
  'revolutionary', 'seamless', 'cutting-edge', 'robust', 'powerful', 'next-generation', 'game-changer',
  'unlock', 'empower', 'leverage', 'journey', 'trustless', 'effortless', 'delve', 'genuinely', 'excited', 'thrilled',
];

function visibleText(source) {
  return source
    .replace(/<head>[\s\S]*?<\/head>/i, (h) => (h.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '') + ' ' + (h.match(/content="([^"]*)"/gi) ?? []).join(' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

for (const file of html) {
  const src = readFileSync(file, 'utf8');
  const text = visibleText(src);
  for (const word of BANNED) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) fail(file, `banned word "${word}"`);
  }
  if (/[–—]/.test(text) || /\s-\s/.test(text)) fail(file, 'dash used as punctuation');
  if (text.includes('!')) fail(file, 'exclamation mark');
  if (/\p{Extended_Pictographic}/u.test(text)) fail(file, 'emoji');
  if (/\?\s*$/m.test(text.trim())) fail(file, 'rhetorical question');
  if (/\b(19|20)\d\d\b/.test(text)) fail(file, 'a date or year on the page');
  if (/<script/i.test(src)) fail(file, 'script tag (the CSP allows none)');
  if (/\sstyle=/i.test(src)) fail(file, 'inline style (the CSP allows none)');
  if (/\son[a-z]+=/i.test(src)) fail(file, 'inline event handler');
  if (/<(form|input|button|iframe)\b/i.test(src)) fail(file, 'form, input, button or iframe');
  if (/connect (a |your )?wallet/i.test(text)) fail(file, 'wallet connect wording');
  const body = (src.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ');
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 70) fail(file, `${words} words on the page (about 60 at most)`);
  if (!body.includes('Noventia never asks for your seed phrase or private key.')) fail(file, 'missing the seed phrase line');
  if ((src.match(/class="button"/g) ?? []).length !== 1) fail(file, 'exactly one button expected');
  for (const m of src.matchAll(/<(?:link|img|source)\b[^>]*\b(?:href|src)="([^"]+)"/gi)) {
    if (/^(https?:)?\/\//i.test(m[1] ?? '')) fail(file, `loads a resource from another origin: ${m[1]}`);
  }
  if (!/<meta name="viewport"/.test(src)) fail(file, 'missing viewport meta');
  if (!/<html lang="en">/.test(src)) fail(file, 'missing lang');
}

for (const file of files.filter((f) => extname(f) === '.css')) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/url\(\s*["']?([^"')]+)/g)) {
    if (/^(https?:)?\/\//i.test(m[1] ?? '')) fail(file, `loads from another origin: ${m[1]}`);
  }
  if (/@import/i.test(src)) fail(file, '@import');
  for (const m of src.matchAll(/url\(\s*["']?(\/[^"')]+)/g)) {
    try {
      statSync(join(SITE, m[1] ?? ''));
    } catch {
      fail(file, `missing file ${m[1]}`);
    }
  }
}

const index = readFileSync(join(SITE, 'index.html'), 'utf8');
if (!/<h1>DustBack is now part of Noventia<\/h1>/.test(index)) failures.push('index.html: the headline must be "DustBack is now part of Noventia"');
if (!index.includes('href="https://noventia.app">Open noventia.app</a>')) failures.push('index.html: the button must open noventia.app');
for (const addr of ['https://noventia.app', 'https://noventia.xyz', 'https://x.com/NoventiaHq', 'https://discord.com/invite/5HaTQHW2Es', 'mailto:support@noventia.app']) {
  if (!index.includes(`href="${addr}"`)) failures.push(`index.html: missing official address ${addr}`);
}

const headers = readFileSync(join(SITE, '_headers'), 'utf8');
for (const h of ['Content-Security-Policy:', 'Strict-Transport-Security:', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy:', "frame-ancestors 'none'", "default-src 'none'"]) {
  if (!headers.includes(h)) fail(join(SITE, '_headers'), `missing ${h}`);
}

const links = JSON.parse(readFileSync(join(SITE, '.well-known/assetlinks.json'), 'utf8'));
const prints = links.flatMap((s) => s.target?.sha256_cert_fingerprints ?? []);
// The public Android debug key must never be vouched for.
if (prints.some((p) => p.startsWith('FA:C6:17:45'))) fail(join(SITE, '.well-known/assetlinks.json'), 'public debug key fingerprint');

const redirects = readFileSync(join(SITE, '_redirects'), 'utf8');
for (const path of ['/privacy', '/privacy/', '/privacy.html']) {
  if (!new RegExp(`^${path.replace('.', '\\.')}\\s`, 'm').test(redirects)) fail(join(SITE, '_redirects'), `no redirect for ${path}`);
}

const required = ['index.html', '404.html', 'style.css', 'icon.png', '.well-known/assetlinks.json', '.well-known/security.txt', 'fonts/OFL.txt'];
for (const r of required) {
  try {
    statSync(join(SITE, r));
  } catch {
    failures.push(`missing ${r}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log(`site check passed: ${html.length} pages, ${files.length} files`);
