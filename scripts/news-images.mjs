import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request, xmlText } from './feeds.mjs';

const cdn = 'https://media.formula1.com/image/upload/';
const aliases = {
  'great-britain': ['british', 'silverstone'], 'barcelona-catalunya': ['barcelona', 'catalunya'],
  'united-states': ['austin', 'united states'], 'abu-dhabi': ['yas marina', 'abu dhabi'],
  'las-vegas': ['vegas'], spain: ['madrid', 'spanish'], belgium: ['belgian', 'spa francorchamps'],
  azerbaijan: ['baku'], brazil: ['brazilian', 'sao paulo', 'interlagos'], italy: ['italian', 'monza'],
  netherlands: ['dutch', 'zandvoort'], hungary: ['hungarian', 'hungaroring'], japan: ['japanese', 'suzuka'],
  china: ['chinese', 'shanghai'], mexico: ['mexican', 'mexico city'], canada: ['canadian', 'montreal'],
  australia: ['australian', 'melbourne'], austria: ['austrian', 'spielberg'],
};
const teamNames = new Map([
  ['red-bull', 'red bull'], ['racing-bulls', 'racing bulls'], ['aston-martin', 'aston martin'],
  ...['mercedes', 'ferrari', 'mclaren', 'alpine', 'haas', 'audi', 'williams', 'cadillac'].map(name => [name, name]),
]);
const unwanted = /\b(?:betting|odds|tickets|f1 tv|lego|f1 academy|esports|power rankings|winners and losers)\b/;
const normal = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

// Use the roster for names only. Portrait and studio assets are excluded from covers.
export async function newsPhotoCatalog(site) {
  const source = await readFile(join(site, 'content.js'), 'utf8');
  const block = name => source.match(new RegExp(String.raw`^  ${name}: \{([\s\S]*?)^  \},`, 'm'))?.[1] || '';
  const chinese = new Map([...block('drivers').matchAll(/([A-Z]{3}):"([^"]+)"/g)].map(([, code, zh]) => [code, zh]));
  const people = {};
  for (const [, code, slug] of block('rosters').matchAll(/\["([A-Z]{3})","([a-z-]+)","[a-z0-9]+",/g)) {
    const en = slug.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
    people[code] = { en, zh: chinese.get(code) || en, surname: slug.split('-').at(-1) };
  }
  const circuits = Object.fromEntries([...block('circuit').matchAll(/^    "([a-z-]+)":\s*\["[^"]+","[^"]+","[^"]+","([a-z0-9]+)"/gm)]
    .map(([, key, asset]) => [key, `${cdn}c_fit,w_1600/q_auto/v1740000001/common/f1/2026/track/2026track${asset}detailed.webp`]));
  if (!Object.keys(people).length || !Object.keys(circuits).length) throw new Error('Official news photo catalog is empty.');
  const teamPhotos = [...(source.match(/^  teams: \[([\s\S]*?)^  \],/m)?.[1] || '')
    .matchAll(/^    (\[[^\r\n]+\]),?$/gm)].flatMap(([, row]) => {
      const [team, , asset, frame, name, , , source] = JSON.parse(row);
      const driver = Object.entries(people).find(([, person]) => person.zh === name);
      return driver ? [{ asset: asset + '.webp', frame, source, team, people: [driver[0]], scene: 'driving on track' }] : [];
    });
  return { people, circuits, teamPhotos };
}

export function centralPeople(title, catalog) {
  const headline = normal(title);
  return Object.entries(catalog).map(([code, { surname }]) => [code, ` ${headline} `.indexOf(` ${surname} `)])
    .filter(([, index]) => index >= 0).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([code]) => code);
}

function photo(url, text = '') {
  if (typeof url !== 'string' || !url.startsWith(cdn)) return null;
  const matched = xmlText(url).match(/\/v(\d+)\/([^?#]+\.(?:jpe?g|png|webp))(?:[?#]|$)/i);
  if (!matched) return null;
  const [, version, asset] = matched;
  let decoded;
  try { decoded = decodeURIComponent(asset); } catch { return null; }
  if (/common\/f1|portrait|headshot|driver[-_ ]?profile|teamlogos|fallback|badge|favicon|template|\blogo\b/i.test(decoded)) return null;
  const crop = url.match(/\/(t_16by9(?:North|Centre|South))\//)?.[1];
  return {
    key: decoded.replace(/\.[^.]+$/, '').toLowerCase(),
    url: cdn + (crop ? crop + '/' : '') + 'c_fit,w_1600/q_auto/v' + version + '/' + asset,
    assetText: normal(decoded), text: normal(decoded + ' ' + text), year: Number(decoded.match(/(?:^|\/)(20\d\d)\//)?.[1]),
  };
}

const sceneCaption = /\b(?:driving|speaks|talks|interview|press conference|on the podium|looks on|prepares|walks|arrives|aerial|general view|wide view|grandstands)\b/i;
const wideCaption = /\b(?:aerial|general view|wide view|overview)\b/i;
const personCover = /^(?:fia|driver|q3-cut)-/;
const articleUrl = /^https:\/\/www\.formula1\.com\/en\/latest\/article\/[a-z0-9.-]+$/i;
const attribute = (tag, name) => xmlText(tag.match(new RegExp(`(?:^| )${name}="([^"]*)"`, 'i'))?.[1] || '');

export function imageCaptions(html, url, people) {
  const start = html.search(/<h1\b/i);
  if (start < 0) return [];
  const section = html.slice(start).split(/>Next Up<|>Related Articles</i)[0];
  return [...section.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
    const src = attribute(tag, 'src');
    const caption = attribute(tag, 'alt');
    if (!sceneCaption.test(caption) || /w_352\//.test(src) || !photo(src)) return [];
    if (!/^(?:[A-Z .,'’-]+) - [A-Z]+ \d{1,2}:/u.test(caption)) return [];
    const subjects = centralPeople(caption, people);
    const neutral = !subjects.length && wideCaption.test(caption);
    return subjects.length || neutral ? [{ src, people: subjects, neutral, scene: caption, source: url }] : [];
  });
}

export async function editorialPhotos(root, cacheDir, external, catalog) {
  const path = join(cacheDir, 'news-photo-evidence.json');
  const [manual, saved] = await Promise.all([
    readFile(join(root, 'content', 'news-editorial-photos.json'), 'utf8').then(JSON.parse),
    readFile(path, 'utf8').then(JSON.parse).catch(() => ({})),
  ]);
  const unique = new Set(external.map(row => row[7]?.url).filter(url => articleUrl.test(url) && !unwanted.test(normal(url))));
  const next = [...unique].filter(url => !Object.hasOwn(saved, url)).slice(0, 10);
  for (let i = 0; i < next.length; i += 5) {
    await Promise.all(next.slice(i, i + 5).map(async url => {
      try {
        const html = await request(url, { signal: AbortSignal.timeout(4500) }).then(response => response.text());
        saved[url] = imageCaptions(html, url, catalog.people);
      } catch { /* A temporary source outage must leave the existing photos available. */ }
    }));
  }
  if (next.length) await writeFile(path, JSON.stringify(saved) + '\n');
  return [...catalog.teamPhotos, ...Object.values(saved).flat(), ...manual].flatMap(entry => {
    const prefix = /^(?:North|Centre|South)$/.test(entry.frame) ? 't_16by9' + entry.frame + '/' : '';
    const url = entry.src || cdn + prefix + 'v1740000001/' + entry.asset;
    const candidate = photo(url, entry.scene);
    return candidate ? [{ ...candidate, ...entry }] : [];
  });
}

const roundTerms = round => [normal(round), ...(aliases[round] || [])];

function roundPool(round, media, external, byRound) {
  const matchesRound = (text, key) => byRound.get(key).some(term => words(text, term));
  const gallery = (media[round]?.photos || []).map(entry => photo(entry.image, entry.source)).filter(Boolean);
  const headlines = external.flatMap(row => {
    const candidate = photo(row[5], row[2] + ' ' + (row[7]?.url || ''));
    if (!candidate || unwanted.test(normal(row[2])) || !matchesRound(candidate.text, round)) return [];
    // Headlines can discuss one event while showing a photo from another venue.
    if (!matchesRound(candidate.assetText, round) &&
        [...byRound.keys()].some(key => key !== round && matchesRound(candidate.assetText, key))) return [];
    return [candidate];
  });
  return [...new Map([...gallery, ...headlines].map(candidate => [candidate.key, candidate])).values()];
}

function topic(id, kind, title) {
  if (/tyre|tire|technical/.test(title) || id.includes('tyre')) return /tyres?|tires?|pirelli|pit lane/;
  if (id.includes('press-conference')) return /press conference|paddock|media day|preview/;
  if (id.startsWith('q3-cut-') || kind.includes('排位')) return /qualifying|pole position|q3|\bsq[123]\b/;
  if (kind.includes('练习')) return /practice|\bfp[123]\b/;
  if (kind.includes('冲刺')) return /sprint/;
  if (kind.includes('前瞻')) return /preview|racehub|schedule|timetable/;
  if (id.startsWith('fia-')) return /clash|collision|penalty|stewards|pit lane|incident/;
  return /race report|lowdown|podium|victory|grand prix|trackside images/;
}

function storySubjects(row, note, catalog) {
  const [id, , title] = row;
  const declared = row[7].subjects;
  if (declared?.length) return declared.filter(code => catalog[code]).slice(0, 3);
  const text = id.startsWith('fia-') ? note?.fullTextEn?.[0]?.match(/\binvolving (.+?) in car \d+/)?.[1] :
    id.startsWith('q3-cut-') ? note?.fullTextEn?.[0] : title;
  return centralPeople(text || '', catalog);
}

export function newsImages(rows, notes, media, external, catalog, editorials) {
  const { people, circuits } = catalog;
  const byRound = new Map(Object.keys(media).map(round => [round, roundTerms(round)]));
  const rounds = new Map([...byRound.keys()].map(round => [round, roundPool(round, media, external, byRound)]));
  const pool = [...new Map(editorials.map(item => [item.key, item])).values()].map(item => ({
    ...item,
    team: item.team || [...teamNames].find(([, name]) => words(normal(item.scene || ''), name))?.[0],
    round: item.round || [...byRound].find(([, terms]) => terms.some(term => words(item.assetText, term)))?.[0] ||
      [...byRound].find(([, terms]) => terms.some(term => words(item.text, term)))?.[0],
  }));
  const usage = new Map();
  const recentlyUsed = [];
  return rows.map(row => {
    const [id, stamp, title, , kind, , , info] = row;
    if (!info?.onSite) return row;
    const subjects = storySubjects(row, notes[id], people);
    const personStory = subjects.length || info.subjects?.length || personCover.test(id) || /^.+? (?:wins|leads)\b/i.test(title);
    const team = !personStory && [...teamNames].find(([, name]) => normal(title).startsWith(name + ' '))?.[0];
    const assigned = pool.filter(photo => photo.stories?.includes(id));
    const verified = pool.filter(candidate => personStory ? candidate.people?.includes(subjects[0]) : team && candidate.team === team);
    const neutral = pool.filter(candidate => candidate.neutral && candidate.round === info.round);
    const candidates = assigned.length || personStory || team ? [...new Set([...assigned, ...verified, ...neutral])] :
      (rounds.get(info.round) || []);
    const map = circuits[info.round];
    if (!candidates.length) return [...row.slice(0, 5), map || '', row[6],
      { ...info, photoReference: true, photoKind: map ? 'circuit' : 'none' }];
    const alternate = verified.some(candidate => !recentlyUsed.includes(candidate.key));
    const scene = topic(id, kind, normal(title));
    const year = new Date(stamp).getUTCFullYear();
    let best, bestScore = -Infinity;
    for (const candidate of candidates) {
      const sameYear = candidate.year === year;
      const named = candidate.people?.includes(subjects[0]);
      const inRound = candidate.round && candidate.round === info.round;
      const score = (candidate.stories?.includes(id) ? 180 : 0) + (named ? 75 : 0) +
        (named ? 10 * subjects.filter(code => candidate.people.includes(code)).length : 0) +
        (inRound ? 28 : 0) + (scene.test(candidate.text) ? 16 : 0) + (sameYear ? 8 : 0) -
        (candidate.neutral ? 18 : 0) - 7 * (usage.get(candidate.key) || 0) -
        (recentlyUsed.includes(candidate.key) ? (alternate ? 68 : 24) : 0);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    usage.set(best.key, (usage.get(best.key) || 0) + 1);
    recentlyUsed.unshift(best.key);
    if (recentlyUsed.length > 9) recentlyUsed.pop();
    const editorial = Boolean(best.people?.length || best.neutral);
    const archived = best.year < year || (editorial && (!best.round || best.round !== info.round));
    const caption = best.people?.length ? {
      zh: best.captionZh || best.people.map(code => people[code].zh).join('、'),
      en: best.captionEn || best.people.map(code => people[code].en).join(', '),
    } : undefined;
    return [...row.slice(0, 5), best.url, row[6], { ...info, photoReference: true,
      photoKind: editorial ? 'editorial' : 'context', photoArchived: archived, photoCaption: caption,
      photoPeople: best.people }];
  });
}
