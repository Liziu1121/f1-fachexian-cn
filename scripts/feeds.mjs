const official = 'https://www.formula1.com';
const publishers = [
  ['Motorsport.com', 'https://www.motorsport.com/rss/f1/news/'],
  ['Autosport', 'https://www.autosport.com/rss/f1/news/'],
];

export const originalSite = 'https://f1-fachexian.briskrhubarb8.chatgpt.site';

export async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(7500), ...options });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return response;
}

export function cache(read, ttl, maxEntries = 64) {
  const entries = new Map();
  return (key) => {
    const previous = entries.get(key);
    if (previous?.pending) return previous.pending;
    if (previous?.until > Date.now()) return Promise.resolve(previous.value);
    const entry = { value: previous?.value, until: 0 };
    if (entries.size >= maxEntries && !entries.has(key)) entries.delete(entries.keys().next().value);
    entries.set(key, entry);
    entry.pending = Promise.resolve().then(() => read(key)).then(value => {
      entry.value = value;
      entry.until = Date.now() + (typeof ttl === 'function' ? ttl(value) : ttl);
      return value;
    }).catch(error => {
      if (!entry.value) throw error;
      entry.until = Date.now() + 20_000;
      return entry.value;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  };
}

export const originalData = cache(async path => {
  const response = await request(`${originalSite}/api/${path}`, { headers: { Accept: 'application/json' } });
  return response.json();
}, 120_000);

export function xmlText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, key) => {
      if (key[0] !== '#') return named[key] ?? entity;
      const point = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    },
  );
}

function tag(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi'))]
    .map(match => xmlText(match[1]));
}

const rss = publishers.map(([source, feed]) => cache(async () => {
  const response = await request(feed, { headers: { Accept: 'application/rss+xml, application/xml' } });
  const feedHost = new URL(feed).hostname;
  const xml = await response.text();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const [title] = tag(item, 'title');
    const [link] = tag(item, 'link');
    const date = Date.parse(tag(item, 'pubDate')[0]);
    if (!title || !Number.isFinite(date) || !link) return [];
    let url;
    try { url = new URL(link); } catch { return []; }
    if (url.protocol !== 'https:' || url.hostname !== feedHost) return [];
    url.search = '';
    return [{ title, url: url.href, date, source, search: tag(item, 'category').join(' ') }];
  });
}, 120_000));

export const officialNewsIndex = 'https://www.formula1.com/en/latest';
const articlePath = /^\/en\/latest\/article\/[\w.-]+\.([A-Za-z0-9]{16,24})$/;
export const officialNewsLinks = cache(async () => {
  const page = await request(officialNewsIndex).then(response => response.text());
  return new Map([...page.matchAll(/href="(\/en\/latest\/article\/[^"?]+)"/g)].flatMap(([, path]) => {
    const id = path.match(articlePath)?.[1];
    return id ? [[id, `${official}${path}`]] : [];
  }));
}, 120_000);

export function officialArticleUrl(id) {
  return /^[A-Za-z0-9]{16,24}$/.test(id) ? `${officialNewsIndex}/article/news.${id}` : '';
}

async function officialHeadlines(feed) {
  const { items } = feed ?? await originalData('news/latest');
  const links = await officialNewsLinks('latest').catch(() => new Map());
  return (items ?? []).flatMap(([id, stamp, title, summary, , , zh, info]) => {
    const date = Date.parse(stamp);
    const url = info?.url ?? links.get(id) ?? officialArticleUrl(id);
    return url && title && Number.isFinite(date) ? [{ title, titleZh: zh?.title, url, date, source: 'F1', search: summary ?? '' }] : [];
  });
}

const headlines = cache(async feed => {
  const sources = await Promise.allSettled([officialHeadlines(feed), ...rss.map(read => read('f1'))]);
  if (sources.every(source => source.status === 'rejected')) throw new Error('News feeds unavailable');
  return sources.flatMap(source => source.status === 'fulfilled' ? source.value : []);
}, 120_000);

export async function liveNews(session, now, feed) {
  try {
    const articles = await headlines(feed);
    const terms = [session?.location, session?.circuit]
      .filter(value => value && value.length >= 4).map(value => value.toLowerCase());
    const matches = articles.filter(item => item.date >= session?.startsAt - 72 * 3600_000
      && item.date <= session?.endsAt + 36 * 3600_000
      && terms.some(term => `${item.title} ${item.search}`.toLowerCase().includes(term)));
    const recent = articles.filter(item => item.date >= now - 7 * 86400_000);
    const relevant = matches.length > 0;
    const coverage = matches.find(item => item.source === 'F1' && /^(?:LIVE COVERAGE|AS IT HAPPENED)\b/i.test(item.title)
      && item.date >= session.startsAt - 3600_000 && item.date <= session.endsAt);
    const titles = new Set();
    const links = new Set();
    const items = (relevant ? matches : recent).sort((a, b) => b.date - a.date).filter(item => {
      const title = item.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (titles.has(title) || links.has(item.url)) return false;
      titles.add(title);
      links.add(item.url);
      return true;
    }).slice(0, 12).map(({ title, titleZh, date, url, source }) => ({ title, titleZh, date, url, source }));
    return { items, scope: relevant ? 'session' : 'series', coverage: coverage?.url };
  } catch {
    return { items: [], scope: 'unavailable' };
  }
}

const fiaOrigin = 'https://www.fia.com';
const fiaList = year => `${fiaOrigin}/documents/championships/110/${year}`;
const fiaDocuments = cache(async year => {
  const page = await request(fiaList(year)).then(response => response.text());
  return [...page.matchAll(/<li class="document-row\b[^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([, row]) => {
    const path = row.match(/href="(\/system\/files\/decision-document\/[^"?]+\.pdf)"/i)?.[1];
    const title = xmlText(row.match(/<div class="title">([^<]+)<\/div>/i)?.[1] ?? '');
    const published = row.match(/class="date-display-single"[^>]*>(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})<\/span>\s*(CET|CEST)\b/i);
    if (!path || !title || !published) return [];
    const [, day, month, shortYear, hour, minute, zone] = published;
    const offset = zone.toUpperCase() === 'CEST' ? '+02:00' : '+01:00';
    const date = Date.parse(`20${shortYear}-${month}-${day}T${hour}:${minute}:00${offset}`);
    if (!Number.isFinite(date)) return [];
    return [{ title, date, url: `${fiaOrigin}${path}` }];
  });
}, 180_000, 4);

export async function fiaBulletins(session, sessions) {
  const year = new Date(session?.startsAt ?? Date.now()).getUTCFullYear();
  const source = fiaList(year);
  if (!session) return { source, items: [] };
  try {
    const round = sessions.filter(item => item.meeting === session.meeting);
    const first = Math.min(session.startsAt, ...round.map(item => item.startsAt));
    const last = Math.max(session.endsAt, ...round.map(item => item.endsAt));
    const items = (await fiaDocuments(year)).filter(item => item.date >= first - 3 * 86400_000
      && item.date <= last + 30 * 3600_000
      && /classification|infringement|decision|summons|protest|timetable|race director|deleted lap|penalty/i.test(item.title))
      .sort((a, b) => b.date - a.date).slice(0, 3);
    return { source, items };
  } catch {
    return { source, items: [], unavailable: true };
  }
}
