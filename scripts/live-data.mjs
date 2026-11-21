import { request } from './feeds.mjs';
import { withArchiveAudio } from './radio-archive.mjs';

export const archiveDelay = 30 * 60_000;
const api = 'https://api.openf1.org/v1';
let nextRequest = Promise.resolve();

async function openF1(path, params) {
  const turn = nextRequest;
  nextRequest = turn.then(() => new Promise(resolve => setTimeout(resolve, 400)));
  await turn;
  const response = await request(`${api}/${path}?${new URLSearchParams(params)}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`Unexpected OpenF1 response for ${path}`);
  return rows;
}

export async function openCalendar(year) {
  return (await openF1('sessions', { year })).flatMap(row => {
    const startsAt = Date.parse(row.date_start);
    const endsAt = Date.parse(row.date_end);
    const key = String(row.session_key);
    if (row.is_cancelled || /testing/i.test(row.session_name) || !/^\d{1,8}$/.test(key) || !(endsAt > startsAt)) return [];
    return [{ key, startsAt, endsAt, meeting: row.meeting_key, name: row.session_name, type: row.session_type,
      location: row.location, country: row.country_name, circuit: row.circuit_short_name }];
  });
}

const scheduleTypes = {
  fp1: ['Practice 1', 'Practice', 60], fp2: ['Practice 2', 'Practice', 60], fp3: ['Practice 3', 'Practice', 60],
  sq: ['Sprint Qualifying', 'Qualifying', 45], sprint: ['Sprint', 'Race', 60],
  q: ['Qualifying', 'Qualifying', 60], race: ['Race', 'Race', 120],
};

export function mirrorCalendar(data) {
  const [, json] = data.match(/^window\.F1_DATA\s*=\s*(\{[^\r\n]+\});/m) ?? [];
  if (!json) throw new Error('Could not read the calendar from the mirrored data.js');
  return Object.entries(JSON.parse(json).races).flatMap(([slug, race]) => {
    const location = slug.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`);
    return Object.entries(race.sessions).flatMap(([code, start]) => {
      const startsAt = Date.parse(start);
      if (!Object.hasOwn(scheduleTypes, code) || !Number.isFinite(startsAt)) return [];
      const [name, type, minutes] = scheduleTypes[code];
      return [{ meeting: race.id, name, type, location, startsAt, endsAt: startsAt + minutes * 60_000 }];
    });
  });
}

function lapSummary(laps) {
  const summary = new Map();
  for (const lap of laps) {
    if (!Number.isFinite(lap.lap_duration) || lap.lap_duration <= 0 || !lap.lap_number) continue;
    const value = summary.get(lap.driver_number) ?? { best: Infinity, completed: 0, last: null };
    if (!lap.is_pit_out_lap) value.best = Math.min(value.best, lap.lap_duration);
    if (value.completed <= lap.lap_number) {
      value.last = lap.lap_duration;
      value.completed = lap.lap_number;
    }
    summary.set(lap.driver_number, value);
  }
  return summary;
}

function dated(items) {
  return items.map(item => ({ ...item, date: Date.parse(item.date) }))
    .filter(item => Number.isFinite(item.date)).sort((a, b) => b.date - a.date);
}

function radioUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'livetiming.formula1.com'
      && /^\/static\/.+\/TeamRadio\/.+\.mp3$/i.test(url.pathname)) return url.href;
  } catch { /* unusable recording */ }
  return null;
}

export async function archiveDetails(session) {
  const names = ['session_result', 'laps', 'race_control', 'team_radio', 'drivers'];
  const results = await Promise.allSettled(names.map(name => openF1(name, { session_key: session.key })));
  const feeds = Object.fromEntries(names.map((name, index) => [name, results[index].value]));
  const identity = new Map((feeds.drivers ?? []).map(row => [row.driver_number, {
    number: row.driver_number, name: row.full_name || row.broadcast_name || row.name_acronym,
    code: row.name_acronym, team: row.team_name, color: /^[\da-f]{6}$/i.test(row.team_colour) ? `#${row.team_colour}` : null,
  }]));
  const driver = number => identity.get(number) ?? { number };
  const laps = lapSummary(feeds.laps ?? []);
  const rows = (feeds.session_result ?? []).map(row => {
    const lap = laps.get(row.driver_number);
    const gap = Array.isArray(row.gap_to_leader) ? row.gap_to_leader.findLast(value => value != null) : row.gap_to_leader;
    const times = [row.duration].flat().filter(value => Number.isFinite(value) && value > 0);
    const best = session.type !== 'Race' && times.length ? Math.min(...times) : lap?.best;
    return { driver: driver(row.driver_number), position: row.position ?? null,
      finish: row.dsq ? 'DSQ' : row.dns ? 'DNS' : row.dnf ? 'DNF' : null,
      gap: gap ?? null, best: Number.isFinite(best) ? best : null, last: lap?.last ?? null, laps: row.number_of_laps ?? null };
  }).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const controls = dated(feeds.race_control ?? []);
  const events = controls.filter(row => row.message && !(row.scope === 'Sector' && row.flag === 'CLEAR')).slice(0, 32)
    .map(row => ({ date: row.date, lap: row.lap_number, message: row.message }));
  const clips = dated(feeds.team_radio ?? []).flatMap(row => {
    const url = radioUrl(row.recording_url);
    return url ? [{ date: row.date, driver: driver(row.driver_number), url }] : [];
  }).slice(0, 30);
  return { session, rows, events, radio: await withArchiveAudio(session, clips),
    controlAvailable: Boolean(feeds.race_control), radioAvailable: Boolean(feeds.team_radio),
    updatedAt: controls[0]?.date ?? session.endsAt,
    complete: rows.length > 0 && identity.size > 0 && results.every(result => result.status === 'fulfilled') };
}
