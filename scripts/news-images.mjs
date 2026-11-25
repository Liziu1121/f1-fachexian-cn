import { xmlText } from './feeds.mjs';

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
const unwanted = /\b(?:betting|odds|tickets|f1 tv|lego|f1 academy|esports|power rankings|winners and losers)\b/;
const normal = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

function photo(url, text = '') {
  if (typeof url !== 'string' || !url.startsWith(cdn)) return null;
  const matched = xmlText(url).match(/\/v(\d+)\/([^?#]+\.(?:jpe?g|png|webp))(?:[?#]|$)/i);
  if (!matched) return null;
  const [, version, asset] = matched;
  let decoded;
  try { decoded = decodeURIComponent(asset); } catch { return null; }
  if (/teamlogos|fallback|badge|favicon|template|\blogo\b/i.test(decoded)) return null;
  return {
    key: decoded.replace(/\.[^.]+$/, '').toLowerCase(), url: cdn + 'c_fit,w_1600/q_auto/v' + version + '/' + asset,
    assetText: normal(decoded), text: normal(decoded + ' ' + text), year: Number(decoded.match(/(?:^|\/)(20\d\d)\//)?.[1]),
  };
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

function focus(row, note) {
  const [id, , title] = row;
  const subject = (id.startsWith('team-') && title.split(' at the ')[0]) ||
    (/^(?:driver|constructor)-/.test(id) && title.split(':')[0]) ||
    (id.startsWith('fia-') && note?.fullTextEn?.[0]?.match(/\binvolving (.+?) in car \d+/)?.[1]) || '';
  if (subject) {
    const phrase = normal(subject);
    return [phrase, id.startsWith('driver-') || id.startsWith('fia-') ? phrase.split(' ').at(-1) : ''].filter(Boolean);
  }
  if (id.includes('mclaren')) return ['mclaren', 'piastri'];
  if (id.includes('alpine')) return ['gasly', 'alpine'];
  if (id.includes('audi')) return ['audi', 'hulkenberg', 'bortoleto'];
  if (id.startsWith('report-')) {
    const name = title.match(/^(.+?) (?:wins|leads)\b/i)?.[1];
    return name ? [normal(name).split(' ').at(-1)] : [];
  }
  return [];
}

export function newsImages(rows, notes, media, external) {
  const byRound = new Map(Object.keys(media).map(round => [round, roundTerms(round)]));
  const rounds = new Map([...byRound.keys()].map(round => [round, roundPool(round, media, external, byRound)]));
  const usage = new Map();
  const recentlyUsed = [];
  return rows.map(row => {
    const [id, stamp, title, , kind, image, , info] = row;
    if (!info?.onSite || !info.round) return row;
    const candidates = rounds.get(info.round) || [];
    if (!candidates.length) return row;
    const names = focus(row, notes[id]);
    const scene = topic(id, kind, normal(title));
    const year = new Date(stamp).getUTCFullYear();
    let best, bestScore = -Infinity;
    for (const candidate of candidates) {
      const subjectMatch = names.some(name => words(candidate.text, name));
      const sameYear = candidate.year === year;
      const shot = scene.test(candidate.text);
      const venue = /racehub/.test(candidate.text);
      const score = (subjectMatch ? 32 : 0) + (shot ? 12 : 0) + (sameYear ? 8 : 0) +
        (venue && !kind.includes('前瞻') ? -12 : 0) - 10 * (usage.get(candidate.key) || 0) -
        (recentlyUsed.includes(candidate.key) ? 30 : 0);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    const key = best.key;
    usage.set(key, (usage.get(key) || 0) + 1);
    recentlyUsed.unshift(key);
    if (recentlyUsed.length > 9) recentlyUsed.pop();
    const archived = best.year < year;
    return [...row.slice(0, 5), best.url || image, row[6], { ...info, photoReference: true, photoArchived: archived }];
  });
}
