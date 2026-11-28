import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { request, xmlText } from './feeds.mjs';

const hour = 3600_000;
const publishers = new Map([
  ['F1', ['www.formula1.com', /^\/en\/latest\/article\//]],
  ['Sky Sports', ['www.skysports.com', /^\/f1\/news\//]],
  ['Motorsport.com', ['www.motorsport.com', /^\/f1\/news\//]],
]);
const ignored = /\b(?:f1 academy|quiz|betting|schedule and how to watch|buy tickets)\b/i;
const stop = new Set('the for and that with from this says after what why how was grand prix formula will day get could goes'.split(' '));
const words = text => new Set((text.toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !stop.has(word)));
function validSource(row) {
  const rule = publishers.get(row[7]?.source);
  if (!rule) return false;
  try {
    const url = new URL(row[7].url);
    return url.protocol === 'https:' && url.hostname === rule[0] && rule[1].test(url.pathname);
  } catch { return false; }
}

const plain = value => xmlText(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function sourceBody(html, source) {
  if (source !== 'F1') {
    const encoded = html.match(/"articleBody"\s*:\s*("(?:[^"\\]|\\[\s\S])*")/)?.[1];
    return encoded ? plain(JSON.parse(encoded)).slice(0, 5600) : '';
  }
  const main = html.split(/<footer\b/i)[0].split(/Unlock exclusive F1 content/i)[0];
  return [...main.matchAll(/<p\b[^>]*class="[^"]*typography-module_body[^"]*"[^>]*>([\s\S]*?)<\/p>/g)]
    .map(([, text]) => plain(text)).filter(text => text.length >= 42).join('\n').slice(0, 5600);
}

async function readSource(row) {
  const url = new URL(row[7].url);
  if (row[7].source === 'Sky Sports') {
    url.pathname = url.pathname.replace(/^\/f1\/news\/\d{4,5}\/(?=\d+\/)/, '/f1/news/');
  }
  const html = await request(url).then(response => response.text());
  const body = sourceBody(html, row[7].source);
  if (body.length < 330) return null;
  return { publisher: row[7].source, title: row[2], url: row[7].url, body };
}

const sessionReport = /^\/en\/latest\/article\/(fp[123]|sprint-qualifying|qualifying|sprint|race)-/;
const codes = {
  fp1: 'fp1', fp2: 'fp2', fp3: 'fp3', 'sprint-qualifying': 'sq', qualifying: 'q', sprint: 'sprint', race: 'race',
};
const topic = {
  fp1: /\b(?:fp1|first practice|opening practice)\b/i,
  fp2: /\b(?:fp2|second practice|friday practice|practice two)\b/i,
  fp3: /\b(?:fp3|third practice|final practice|practice three)\b/i,
  sq: /\b(?:sprint qualifying|sprint shootout)\b/i,
  q: /\b(?:qualifying|pole)\b/i,
  sprint: /\bsprint\b/i,
  race: /\b(?:wins?|race result|victory|takes the flag)\b/i,
};

export async function sourceNews(rows, existingNotes, results, cacheDir, now = Date.now()) {
  const file = join(cacheDir, 'verified-source-news.json');
  const archive = await readFile(file, 'utf8').then(JSON.parse, error => {
    if (error.code !== 'ENOENT') throw error;
    return { articles: {}, hour: null, count: 0 };
  });
  const current = Math.floor(now / hour);
  if (archive.hour !== current) { archive.hour = current; archive.count = 0; }
  const recent = rows.filter(row => validSource(row) && !ignored.test(row[2]) &&
    Date.parse(row[1]) <= now && Date.parse(row[1]) >= now - 48 * hour);
  const articles = recent.filter(row => row[7].source === 'F1');
  const supported = results.items.filter(row => results.notes[row[0]]?.classification)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  const media = recent.filter(row => row[7].source !== 'F1');
  for (const article of articles) {
    const [, stamp, , , , , , info] = article;
    const url = new URL(info.url);
    const code = codes[url.pathname.match(sessionReport)?.[1]];
    if (!code) continue;
    const verified = supported.find(row => {
      if (Math.abs(Date.parse(row[1]) - Date.parse(stamp)) > 16 * hour) return false;
      const round = row[7].round;
      const resultId = code === 'race' ? `report-${round}` : `report-${round}-${code}`;
      return row[0] === resultId && url.pathname.includes(round);
    });
    if (!verified) continue;
    const report = results.notes[verified[0]];
    const winner = report.classification.en.rows.find(row => String(row[0]) === '1')?.[2];
    const family = winner?.split(' ').at(-1)?.toLowerCase();
    if (!family || !words(article[2]).has(family)) continue;
    const id = article[0];
    const siteReport = (reportId, source, references) => ({
      item: [reportId, stamp, verified[2], '', '赛况报道', verified[5], verified[6],
        { ...verified[7], source, generated: true }],
      note: { ...report, sources: [...references.map(ref => ref.publisher), 'F1 官方成绩'] },
      refs: references.map(({ publisher, url }) => ({ publisher, url })),
    });
    // An official results story becomes a normal article only when the winner and session match the classification.
    if (!existingNotes[id]?.fullTextZh?.length && archive.articles[id]?.item[1] !== stamp) {
      const primary = await readSource(article).catch(() => null);
      if (primary && words(primary.body).has(family)) archive.articles[id] = siteReport(id, 'F1 官方来源', [primary]);
    }
    const originalId = 'original-' + id;
    if (archive.count >= 10 || archive.articles[originalId]) continue;
    const relatedMedia = media.filter(row => topic[code].test(row[2]) &&
      words(row[2]).has(family) && Math.abs(Date.parse(row[1]) - Date.parse(stamp)) < 6 * hour);
    const byPublisher = ['Sky Sports', 'Motorsport.com'].map(name => relatedMedia.find(row => row[7].source === name));
    if (byPublisher.some(row => !row)) continue;
    const refs = await Promise.all(byPublisher.map(row => readSource(row).catch(() => null)));
    if (refs.some(ref => !ref || !words(ref.body).has(family) || !topic[code].test(ref.body))) continue;
    const original = siteReport(originalId, 'F1 发车线', refs);
    // Link the reporting to the two matched outlets while keeping the article based on the official classification.
    original.note.fullTextZh = [`Sky Sports 与 Motorsport.com 均报道了这场比赛的成绩。本文以 F1 公布的成绩表核对名次、用时和圈数。`, ...original.note.fullTextZh];
    original.note.fullTextEn = ['Sky Sports and Motorsport.com both covered the session. The positions, times and lap counts in this report were checked against the Formula 1 classification.', ...original.note.fullTextEn];
    archive.articles[originalId] = original;
    archive.count++;
  }
  await writeFile(file + '.tmp', JSON.stringify(archive) + '\n');
  await rename(file + '.tmp', file);
  const entries = Object.values(archive.articles);
  console.log(`Source newsroom: ${entries.filter(entry => entry.item[0].startsWith('original-')).length} original reports and ${entries.filter(entry => !entry.item[0].startsWith('original-')).length} F1 reports available.`);
  return { items: entries.map(entry => entry.item), notes: Object.fromEntries(entries.map(entry => [entry.item[0], entry.note])) };
}
