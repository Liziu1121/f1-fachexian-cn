import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { request, xmlText, publisherHeadlines } from './feeds.mjs';

const f1 = 'https://www.formula1.com';
const fia = 'https://www.fia.com/regulation/category/110';
const execute = promisify(execFile);
const hours = 3600_000;
const read = (path, fallback) => readFile(path, 'utf8').then(JSON.parse).catch(() => fallback);
const write = (path, data) => writeFile(path, JSON.stringify(data) + '\n');
const compact = value => decodeURIComponent(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const image = value => /^https:\/\/(?:media\.formula1\.com|e[0-9]+\.365dm\.com|cdn\.[a-z0-9.-]*motorsport\.com|cdn\.[a-z0-9.-]*autosport\.com)\//i.test(value || '') ? value : '';

export async function circuitMedia(site, cacheDir) {
  const match = (await readFile(join(site, 'data.js'), 'utf8')).match(/window\.F1_DATA\s*=\s*(\{[^\r\n]+\});/);
  if (!match) throw new Error('Mirrored calendar unavailable');
  const races = JSON.parse(match[1]).races;
  const cachePath = join(cacheDir, 'circuit-media.json');
  const collection = await read(cachePath, {});
  const todo = Object.entries(races).filter(([key, race]) => {
    const current = collection[key];
    const when = Date.parse(race.sessions.race);
    return !current?.photos?.length || current.photos.length < 10 || Date.now() - current.checked > (Math.abs(Date.now() - when) < 7 * 24 * hours ? 3 : 168) * hours;
  });
  const aliases = {
    'great-britain': ['british', 'silverstone'], 'barcelona-catalunya': ['barcelona', 'catalunya', 'spanish'],
    'abu-dhabi': ['abudhabi', 'yasmarina'], 'united-states': ['unitedstates', 'austin'],
    'spain': ['madrid', 'madring'], 'azerbaijan': ['azerbaijan', 'baku'], 'bahrain': ['bahrain', 'sepang', 'malaysia'],
    'brazil': ['saopaulo', 'brazilian', 'interlagos'], 'belgium': ['belgian', 'spafrancorchamps'],
    'netherlands': ['dutch', 'zandvoort'], 'mexico': ['mexicocity', 'mexican'],
    'hungary': ['hungarian', 'hungaroring'], 'italy': ['italian', 'monza'],
    'austria': ['austrian', 'spielberg'], 'china': ['chinese', 'shanghai'],
    'japan': ['japanese', 'suzuka'], 'australia': ['australian', 'melbourne'],
    'canada': ['canadian', 'montreal'],
  };
  for (let start = 0; start < todo.length; start += 8) {
    await Promise.all(todo.slice(start, start + 8).map(async ([key, race]) => {
      const date = Date.parse(race.sessions.race);
      if (!Number.isFinite(date)) return;
      const year = new Date(date).getUTCFullYear();
      const slug = key === 'abu-dhabi' ? 'united-arab-emirates' : key;
      const source = `${f1}/en/racing/${year}/${slug}`;
      const names = [compact(key), ...(aliases[key] || [])];
      const photos = new Map(), videos = new Map();
      function collect(html, officialPage) {
        const sources = [...html.matchAll(/https:\/\/media\.formula1\.com\/image\/upload\/[^"\\ <]+/gi)];
        for (const [src] of sources) {
          if (!src?.startsWith('https://media.formula1.com/image/upload/')) continue;
          const asset = src.match(/\/v\d+\/(.+\.(?:webp|jpe?g|png))(?:\?|$)/i)?.[1];
          if (!asset || !/trackside-images|racehub|\/20\d{2}\//i.test(asset)) continue;
          const location = compact(asset.split('/').slice(0, -1).join('/'));
          const header = /racehub/i.test(asset) && names.some(name => compact(asset).includes(name));
          if (!header && (!names.some(name => location.includes(name)) || /fallback|detailed|driver|teamlogos/i.test(asset))) continue;
          photos.set(asset.replace(/\.[^.]+$/, ''), {
            image: `https://media.formula1.com/image/upload/c_fit,w_1600/q_auto/v1740000001/${asset}`,
            source: officialPage,
          });
        }
        if (officialPage !== source || Date.now() < date - 5 * 24 * hours) return;
        for (const [, path] of html.matchAll(/href="(\/en\/video\/[\w-]+\.\d+)"/g)) {
          const slug = path.split('/').at(-1).split('.')[0];
          if (!names.some(name => compact(slug).includes(name))) continue;
          const session = /(?:fp([123])|qualifying|sprint|race)-highlights/.exec(slug)?.[0];
          const sessionKey = session?.startsWith('fp') ? session.slice(0, 3)
            : { 'race-highlights': 'race', 'sprint-highlights': 'sprint', 'qualifying-highlights': 'q' }[session];
          const stamp = race.sessions[sessionKey || 'race'] || race.sessions.race;
          if (Date.parse(stamp) > Date.now()) continue;
          const title = slug.replaceAll('-', ' ').replace(/\bfp([123])\b/, 'FP$1').replace(/^./, char => char.toUpperCase());
          videos.set(path, { url: f1 + path, title, stamp, type: session ? 'highlights' : 'featured', round: key });
        }
      }
      try {
        const html = await request(source, { redirect: 'follow' }).then(response => response.text()).catch(() => '');
        collect(html, source);
        if (photos.size < 10) {
          const related = [...new Set([...html.matchAll(/href="(\/en\/latest\/article\/[^"?#]+)"/g)].map(match => match[1]))]
            .filter(path => names.some(name => compact(path).includes(name)) && !/live-coverage|promot|ticket/.test(path)).slice(0, 4);
          await Promise.allSettled(related.map(path => request(f1 + path).then(response => response.text()).then(page => collect(page, f1 + path))));
        }
        for (const olderYear of [year - 1, year - 2]) {
          if (photos.size >= 10) break;
          const older = `${f1}/en/racing/${olderYear}/${slug}`;
          await request(older, { redirect: 'follow' }).then(response => response.text()).then(page => collect(page, older)).catch(() => {});
        }
        const saved = collection[key];
        collection[key] = { checked: Date.now(),
          photos: [...new Map([...photos, ...(saved?.photos || []).map(photo => [photo.image.split('/').slice(7).join('/').replace(/\.[^.]+$/, ''), photo])]).values()].slice(0, 10),
          videos: videos.size ? [...videos.values()].slice(0, 18).map(video => ({ ...video, image: [...photos.values()][0]?.image })) : saved?.videos || [] };
      } catch (error) {
        console.warn(`Circuit media ${key}: ${error.message}`);
      }
    }));
  }
  await write(cachePath, collection);
  return collection;
}

async function officialReports() {
  const html = await request(`${f1}/en/latest`).then(response => response.text());
  const payload = html.replaceAll('\\"', '"');
  return [...html.matchAll(/<li id="article-item-([\w]{16,24})"[\s\S]*?<\/li>/g)].flatMap(([card, id]) => {
    const link = card.match(/href="(\/en\/latest\/article\/[^"?#]+)"/)?.[1];
    const title = card.match(/href="\/en\/latest\/article\/[^"]+"[^>]*>([^<]+)<\/a>/)?.[1];
    const stamp = payload.match(new RegExp('"id":"' + id + '","updatedAt":"([^"]+)"'))?.[1];
    if (!link || !title || !Number.isFinite(Date.parse(stamp))) return [];
    return [[id, stamp, xmlText(title), '', 'F1', image(card.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1]), {}, { url: f1 + link, source: 'F1' }]];
  });
}

async function officialVideos(media) {
  const page = await request(`${f1}/en/video`).then(response => response.text());
  return page.replaceAll('\\"', '"').split(/(?=\{"videoId":"\d+")/g).flatMap(item => {
    const id = item.match(/^\{"videoId":"(\d+)"/)?.[1];
    if (!id) return [];
    const path = item.match(/"url":"(\/en\/video\/[\w-]+\.\d+)"/)?.[1];
    const stamp = item.match(/"publishedAt":"([^"]+)"/)?.[1];
    const title = item.match(/"caption":"([^"]+)"/)?.[1];
    if (!path || !title || !Number.isFinite(Date.parse(stamp))) return [];
    const image = item.match(/"url":"(https:\/\/d2n9h2wits23hf\.cloudfront\.net\/image\/[^"]+)"/)?.[1] || '';
    const round = Object.keys(media).find(key => path.includes(key));
    const type = /highlights/.test(path) ? 'highlights' : /radio|onboard/.test(path) ? 'onboard' : /analysis/.test(path) ? 'analysis' : 'featured';
    const seconds = Number(item.match(/"videoDurationInSeconds":(\d+)/)?.[1] || 0);
    return [{ url: f1 + path, title: xmlText(title), stamp, image, round, type, seconds }];
  });
}

const stopWords = new Set('the a an of in for to and at is after with from on as it his her says by or has how why what this that f1 formula grand prix will can but are was who'.split(' '));
const terms = title => new Set(title.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length > 2 && !stopWords.has(word)));
function similar(first, second) {
  const shared = [...first].filter(word => second.has(word)).length;
  return shared >= 3 && shared / Math.min(first.size, second.size) >= .55;
}

export async function refreshEdition({ feed, media, cacheDir }) {
  const path = join(cacheDir, 'edition.json');
  const previous = await read(path, { items: [], videos: [] });
  const now = Date.now();
  const window = Math.floor(now / (3 * hours));
  if (previous.window === window) return previous;
  const [external, reports, latestVideos] = await Promise.all([
    publisherHeadlines(), officialReports().catch(error => {
      console.warn(`F1 headlines: ${error.message}`);
      return [];
    }), officialVideos(media).catch(error => {
      console.warn(`F1 videos: ${error.message}`);
      return [];
    }),
  ]);
  const articles = external.map(item => [
    'source-' + createHash('sha256').update(item.url).digest('hex').slice(0, 20),
    new Date(item.date).toISOString(), item.title, '', item.source, image(item.image), {}, { url: item.url, source: item.source },
  ]);
  const pool = new Map([...previous.items, ...articles, ...reports, ...feed.items].map(row => [row[0], row]));
  const items = [...pool.values()].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 360);
  const recent = items.filter(row => Date.parse(row[1]) >= now - 72 * hours).map(row => ({ row, terms: terms(row[2]), source: row[7]?.source || 'F1' }));
  const lead = recent.map(({ row, terms: title, source }) => {
    const sources = new Set(recent.filter(other => other.source !== source && similar(title, other.terms)).map(other => other.source));
    return { id: row[0], score: sources.size * 12 - (now - Date.parse(row[1])) / hours + (row[5] ? 1 : 0) };
  }).sort((a, b) => b.score - a.score)[0]?.id;
  const raceVideos = Object.values(media).flatMap(item =>
    item.videos.map(video => ({ ...video, image: video.image || item.photos[0]?.image })));
  const videoPool = new Map([...previous.videos, ...raceVideos, ...latestVideos].map(video => [video.url, video]));
  const videos = [...videoPool.values()].sort((a, b) => Date.parse(b.stamp) - Date.parse(a.stamp)).slice(0, 100);
  const edition = { items, leadId: lead, videos, checked: now, window };
  await write(path, edition);
  return edition;
}

export const ruleToken = word => {
  let hash = 2166136261;
  for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};

let pdfRuntime;
async function pdfPython(directory) {
  if (process.env.F1_PDF_PYTHON) return process.env.F1_PDF_PYTHON;
  if (!process.env.GITHUB_ACTIONS) return 'python3';
  const environment = join(directory, 'pdf-runtime');
  const python = join(environment, 'bin', 'python');
  try {
    await execute(python, ['-c', 'import pypdfium2']);
  } catch {
    await execute('python3', ['-m', 'venv', environment], { timeout: 30_000 });
    await execute(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'pypdfium2'], { timeout: 60_000 });
  }
  return python;
}

async function indexDocument(document, directory) {
  const file = join(directory, `fia-${document.section}.pdf`);
  const pdf = Buffer.from(await request(document.url, { signal: AbortSignal.timeout(25_000), redirect: 'follow' }).then(response => response.arrayBuffer()));
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('FIA response is not a PDF');
  await writeFile(file, pdf);
  let pages;
  try {
    ({ stdout: pages } = await execute('pdftotext', ['-layout', file, '-'], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    pdfRuntime ??= pdfPython(directory);
    ({ stdout: pages } = await execute(await pdfRuntime, ['-c',
      'import sys, pypdfium2 as pdf; print("\\f".join(page.get_textpage().get_text_range() for page in pdf.PdfDocument(sys.argv[1])))', file], { maxBuffer: 16 * 1024 * 1024 }));
  }
  return pages.replace(/\f\s*$/, '').split('\f').map(page => [...new Set((page.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) || []).map(ruleToken))].sort().join(' '));
}

export async function regulations(site, cacheDir, year) {
  const file = join(cacheDir, 'fia-regulations.json');
  const previous = await read(file, {});
  let data = previous;
  try {
    const html = await request(fia, { redirect: 'follow', signal: AbortSignal.timeout(15_000) }).then(response => response.text());
    const group = html.split(`>${year} Regulations</div>`)[1]?.split('</ul>')[0] || '';
    const documents = [...group.matchAll(/<a href="(https:\/\/(?:www|api)\.fia\.com\/system\/files\/documents\/[^"?#]+\.pdf)"[^>]*>[\s\S]*?<div class="title">([^<]+)<\/div>[\s\S]*?<span class="date-display-single">([^<]+)<\/span>/gi)]
      .flatMap(([, url, title, published]) => {
        const section = title.match(/Section ([A-F])\b/i)?.[1];
        return section ? [{ section, url, title: xmlText(title), published }] : [];
      });
    const unique = [...new Map(documents.map(item => [item.section, item])).values()];
    if (unique.length !== 6) throw new Error(`Expected six FIA volumes, found ${unique.length}`);
    const indexed = await Promise.all(unique.map(async item => {
      const saved = previous.version === 2 && previous.documents?.find(document => document.url === item.url && document.pages?.length);
      return { ...item, pages: saved?.pages || await indexDocument(item, cacheDir) };
    }));
    data = { version: 2, year, source: fia, documents: indexed, checked: new Date().toISOString() };
    await write(file, data);
  } catch (error) {
    console.warn(`FIA rules: ${error.message}`);
  }
  await write(join(site, 'api', 'regulations.json'), { year, source: fia, documents: [], ...data });
}
