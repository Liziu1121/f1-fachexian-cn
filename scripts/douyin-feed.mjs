import { request, xmlText } from './feeds.mjs';

export async function recentDouyin(profile) {
  const response = await request(profile, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
  if (new URL(response.url).pathname !== new URL(profile).pathname) return [];
  const html = await response.text();
  const cards = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (value['@type'] === 'VideoObject') {
      const path = [value.url, value.embedUrl].find(url => typeof url === 'string' &&
        /^https:\/\/(?:www|open)\.douyin\.com\/(?:video\/\d{19}|player\/video\?vid=\d{19})$/.test(url));
      const id = path?.match(/\d{19}$/)?.[0];
      const stamp = Date.parse(value.uploadDate);
      const title = typeof value.name === 'string' && xmlText(value.name);
      const cover = [value.thumbnailUrl].flat().find(url => typeof url === 'string' && /^https:\/\/[^/]+\.douyinpic\.com\//.test(url));
      if (id && title && Number.isFinite(stamp) && stamp <= Date.now()) {
        cards.push({ id, title, en: title, stamp: new Date(stamp).toISOString(), cover, kind: 'featured' });
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const [, raw] of html.matchAll(/<script\b[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(raw)); } catch { /* Skip unrelated malformed snippets. */ }
  }
  return cards;
}
