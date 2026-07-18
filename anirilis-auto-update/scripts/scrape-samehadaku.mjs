import { load } from 'cheerio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SOURCE_URL = process.env.SOURCE_URL || 'https://v2.samehadaku.how/';
const MAX_ITEMS = Math.max(5, Math.min(Number(process.env.MAX_ITEMS || 24), 50));
const OUT_JS = resolve('assets/js/data.js');
const OUT_JSON = resolve('assets/data/anime.json');
const OUT_META = resolve('assets/data/last-update.json');
const UA = 'AniRilisMetadataBot/1.0 (+metadata-only; one request per scheduled run)';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const accents = ['#8b5cf6', '#2563eb', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];

function decodeHtml(value = '') {
  return load(`<body>${value}</body>`)('body').text().replace(/\s+/g, ' ').trim();
}

function stripHtml(value = '') {
  return decodeHtml(value).replace(/\s+/g, ' ').trim();
}

function slugify(value = '') {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || `anime-${Date.now()}`;
}

function episodeFromText(value = '') {
  const match = value.match(/(?:episode|eps?)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function titleWithoutEpisode(value = '') {
  return value
    .replace(/\s*(?:episode|eps?)\s*[0-9]+(?:\.[0-9]+)?.*$/i, '')
    .replace(/\s*(?:subtitle indonesia|sub indo|download|streaming).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value = '') {
  try {
    return new URL(value, SOURCE_URL).href;
  } catch {
    return '';
  }
}

function formatRelative(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'baru diperbarui';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} menit lalu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`;
  return `${Math.floor(seconds / 86400)} hari lalu`;
}

function dateFields(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return { day: DAY_NAMES[new Date().getDay()], time: '-' };
  return {
    day: DAY_NAMES[date.getDay()],
    time: new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date),
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} untuk ${url}`);
  return { response, text: await response.text() };
}

function normalizeItem(item, index) {
  const episode = Number(item.episode || 0);
  const title = titleWithoutEpisode(stripHtml(item.title));
  const published = item.published || new Date().toISOString();
  const { day, time } = dateFields(published);
  const sourceUrl = absoluteUrl(item.sourceUrl || SOURCE_URL);
  const poster = absoluteUrl(item.poster || '') || `assets/images/poster-${String((index % 12) + 1).padStart(2, '0')}.svg`;
  return {
    id: `${slugify(title)}-episode-${String(episode).replace('.', '-')}`,
    title,
    episode,
    type: item.type || 'TV',
    status: 'Ongoing',
    subtitle: 'SUB INDO',
    day,
    time,
    genre: Array.isArray(item.genre) && item.genre.length ? item.genre : ['Anime'],
    rating: Number(item.rating || 0),
    views: Math.max(0, Number(item.views || (MAX_ITEMS - index) * 1000)),
    updated: item.updated || formatRelative(published),
    studio: item.studio || '-',
    year: new Date(published).getFullYear() || new Date().getFullYear(),
    synopsis: stripHtml(item.synopsis || `Informasi ${title} Episode ${episode}. Klik tombol sumber untuk membuka halaman asal.`),
    accent: accents[index % accents.length],
    poster,
    sourceUrl,
    published,
  };
}

async function fromWordPressApi() {
  const api = new URL('/wp-json/wp/v2/posts', SOURCE_URL);
  api.searchParams.set('per_page', String(MAX_ITEMS));
  api.searchParams.set('_embed', '1');
  const { response, text } = await fetchText(api.href);
  if (!response.headers.get('content-type')?.includes('json')) return [];
  const posts = JSON.parse(text);
  if (!Array.isArray(posts)) return [];

  return posts.flatMap((post) => {
    const rawTitle = decodeHtml(post?.title?.rendered || '');
    const episode = episodeFromText(rawTitle);
    if (episode === null) return [];
    const media = post?._embedded?.['wp:featuredmedia']?.[0];
    return [{
      title: titleWithoutEpisode(rawTitle),
      episode,
      poster: media?.source_url || media?.media_details?.sizes?.medium_large?.source_url || '',
      sourceUrl: post.link,
      published: post.date_gmt ? `${post.date_gmt}Z` : post.date,
      synopsis: stripHtml(post?.excerpt?.rendered || ''),
    }];
  });
}

function fromHomepageHtml(html) {
  const $ = load(html);
  const found = [];
  const seen = new Set();
  const selectors = [
    '.post-show li', '.animepost', '.animposx', '.listupd article', '.listupd .bs',
    '.venz li', '.post-item', 'article', '.post', 'li'
  ];

  function addFromNode(node) {
    const el = $(node);
    const text = el.text().replace(/\s+/g, ' ').trim();
    const episode = episodeFromText(text);
    if (episode === null) return;

    const titleLink = el.find('h1 a, h2 a, h3 a, .title a, .data a, a[title]').first();
    const fallbackLink = el.find('a[href]').filter((_, a) => {
      const href = absoluteUrl($(a).attr('href'));
      return href.startsWith(new URL(SOURCE_URL).origin);
    }).first();
    const link = titleLink.length ? titleLink : fallbackLink;
    const sourceUrl = absoluteUrl(link.attr('href') || '');
    const rawTitle = link.attr('title') || link.text() || text.split(/Episode/i)[0];
    const title = titleWithoutEpisode(rawTitle);
    if (!title || title.length < 2 || !sourceUrl) return;

    const key = `${sourceUrl}|${episode}`;
    if (seen.has(key)) return;
    seen.add(key);

    const img = el.find('img').first();
    const poster = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';
    const releasedMatch = text.match(/Released on:\s*(.+?)(?:Posted by:|$)/i);
    found.push({
      title,
      episode,
      poster,
      sourceUrl,
      published: new Date().toISOString(),
      updated: releasedMatch?.[1]?.trim() || 'baru diperbarui',
    });
  }

  for (const selector of selectors) {
    $(selector).each((_, node) => addFromNode(node));
    if (found.length >= MAX_ITEMS) break;
  }

  if (found.length < 3) {
    $('a[href]').each((_, anchor) => {
      const parent = $(anchor).closest('article, li, div');
      addFromNode(parent);
    });
  }

  return found.slice(0, MAX_ITEMS);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${slugify(item.title)}|${item.episode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  let raw = [];
  let method = 'wordpress-rest-api';

  try {
    raw = await fromWordPressApi();
  } catch (error) {
    console.warn(`REST API tidak tersedia: ${error.message}`);
  }

  if (raw.length < 3) {
    method = 'homepage-html';
    const { text } = await fetchText(SOURCE_URL);
    raw = fromHomepageHtml(text);
  }

  const data = dedupe(raw).slice(0, MAX_ITEMS).map(normalizeItem);
  if (data.length < 3) {
    throw new Error(`Scraper hanya menemukan ${data.length} item. File lama dipertahankan.`);
  }

  await mkdir(dirname(OUT_JSON), { recursive: true });
  const js = `// Dibuat otomatis oleh scripts/scrape-samehadaku.mjs\n// Metadata dan tautan sumber saja; tidak mengunduh atau menyimpan video.\nwindow.ANIRILIS_DATA = ${JSON.stringify(data, null, 2)};\n`;
  await writeFile(OUT_JS, js, 'utf8');
  await writeFile(OUT_JSON, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await writeFile(OUT_META, `${JSON.stringify({ source: SOURCE_URL, method, count: data.length, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  console.log(`Berhasil memperbarui ${data.length} rilisan melalui ${method}.`);
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  try {
    await readFile(OUT_JS, 'utf8');
    console.error('Data lama tetap digunakan karena update gagal.');
  } catch {}
  process.exitCode = 1;
});
