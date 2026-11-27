import { request } from './feeds.mjs';
import { withArchiveAudio } from './radio-archive.mjs';

export const archiveDelay = 30 * 60_000;
export const dashboardArchiveVersion = 4;
const api = 'https://api.openf1.org/v1';
let nextRequest = Promise.resolve();

async function openF1(path, params) {
  const turn = nextRequest;
  nextRequest = turn.then(() => new Promise(resolve => setTimeout(resolve, 400)));
  await turn;
  let response;
  try {
    response = await request(`${api}/${path}?${new URLSearchParams(params)}`);
  } catch (error) {
    if (path !== 'sessions' && error.message === 'Source returned HTTP 404') return [];
    throw error;
  }
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
    return [{ key, startsAt, endsAt, meeting: row.meeting_key, circuitKey: row.circuit_key, name: row.session_name, type: row.session_type,
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
    const value = summary.get(lap.driver_number) ?? {};
    if (!lap.is_pit_out_lap && (!value.best || lap.lap_duration < value.best.lap_duration)) value.best = lap;
    if (!value.last || value.last.lap_number <= lap.lap_number) value.last = lap;
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

function byDriver(items) {
  const values = new Map();
  for (const item of items) {
    if (!values.has(item.driver_number)) values.set(item.driver_number, []);
    values.get(item.driver_number).push(item);
  }
  return values;
}

function timedLap(lap) {
  if (!lap) return null;
  return {
    number: lap.lap_number, speed: lap.st_speed, speedTraps: [lap.i1_speed, lap.i2_speed, lap.st_speed],
    sectors: [1, 2, 3].map(i => ({
      time: lap[`duration_sector_${i}`],
      segments: lap[`segments_sector_${i}`] ?? [],
    })),
  };
}

function driverIdentity(rows) {
  return new Map(rows.map(row => [row.driver_number, {
    number: row.driver_number, name: row.full_name || row.broadcast_name || row.name_acronym,
    code: row.name_acronym, team: row.team_name, color: /^[\da-f]{6}$/i.test(row.team_colour) ? `#${row.team_colour}` : null,
  }]));
}

function publishedRadio(rows, driver) {
  return dated(rows).flatMap(row => {
    const url = radioUrl(row.recording_url);
    return url ? [{ date: row.date, driver: driver(row.driver_number), url }] : [];
  });
}

export async function activeRadio(session) {
  if (!session?.key) return [];
  const [radio, drivers] = await Promise.allSettled(['team_radio', 'drivers'].map(name => openF1(name, { session_key: session.key })));
  const identity = driverIdentity(drivers.value ?? []);
  return publishedRadio(radio.value ?? [], number => identity.get(number) ?? { number });
}

async function sampledTelemetry(session, laps) {
  const recorded = laps.map(row => Date.parse(row.date_start)).filter(Number.isFinite);
  if (!recorded.length) return null;
  const midpoint = session.startsAt + (session.endsAt - session.startsAt) * .67;
  const sample = Math.min(midpoint, Math.max(...recorded));
  if (!Number.isFinite(sample) || sample < session.startsAt) return null;
  const params = {
    session_key: session.key,
    'date>': new Date(sample - 2200).toISOString(),
    'date<': new Date(sample + 100).toISOString(),
  };
  const [location, speed] = await Promise.allSettled(['location', 'car_data'].map(endpoint => openF1(endpoint, params)));
  const positions = {};
  const speeds = {};
  for (const row of dated(location.value ?? [])) {
    if (!Object.hasOwn(positions, row.driver_number) && [row.x, row.y].every(Number.isFinite) && (row.x || row.y)) {
      positions[row.driver_number] = [row.x, row.y];
    }
  }
  for (const row of dated(speed.value ?? [])) {
    if (!Object.hasOwn(speeds, row.driver_number) && Number.isFinite(row.speed)) speeds[row.driver_number] = row.speed;
  }
  return Object.keys(positions).length || Object.keys(speeds).length ? { at: sample, positions, speeds } : null;
}

export async function archiveDetails(session) {
  const names = ['session_result', 'laps', 'race_control', 'team_radio', 'drivers', 'stints', 'pit', 'weather'];
  if (session.type === 'Race') names.push('intervals');
  const results = await Promise.allSettled(names.map(name => openF1(name, { session_key: session.key })));
  const feeds = Object.fromEntries(names.map((name, index) => [name, results[index].value]));
  const identity = driverIdentity(feeds.drivers ?? []);
  const driver = number => identity.get(number) ?? { number };
  const laps = lapSummary(feeds.laps ?? []);
  const stints = byDriver(feeds.stints ?? []);
  const stops = byDriver(dated(feeds.pit ?? []));
  const intervals = byDriver(dated(feeds.intervals ?? []));
  const rows = (feeds.session_result ?? []).map(row => {
    const number = row.driver_number;
    const lap = laps.get(number);
    const gap = Array.isArray(row.gap_to_leader) ? row.gap_to_leader.findLast(value => value != null) : row.gap_to_leader;
    const times = [row.duration].flat().filter(value => Number.isFinite(value) && value > 0);
    const best = session.type !== 'Race' && times.length ? Math.min(...times) : lap?.best?.lap_duration;
    const tyreStints = (stints.get(number) ?? []).sort((a, b) => a.stint_number - b.stint_number).map(stint => ({
      compound: stint.compound, start: stint.lap_start, end: stint.lap_end, ageAtStart: stint.tyre_age_at_start,
    }));
    const pit = stops.get(number);
    return { driver: driver(number), position: row.position ?? null,
      finish: row.dsq ? 'DSQ' : row.dns ? 'DNS' : row.dnf ? 'DNF' : null,
      gap: gap ?? null, interval: intervals.get(number)?.[0]?.interval ?? null,
      best: Number.isFinite(best) ? best : null, last: lap?.last?.lap_duration ?? null, laps: row.number_of_laps ?? null,
      measuredLap: timedLap(lap?.best), tyreStints,
      pitCount: feeds.pit ? pit?.length ?? 0 : null,
      lastPit: pit?.length ? { lap: pit[0].lap_number, stop: pit[0].stop_duration } : null,
    };
  }).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const controls = dated(feeds.race_control ?? []);
  const events = controls.filter(row => row.message && !(row.scope === 'Sector' && row.flag === 'CLEAR')).slice(0, 32)
    .map(row => ({ date: row.date, lap: row.lap_number, message: row.message, flag: row.flag }));
  const clips = publishedRadio(feeds.team_radio ?? [], driver);
  const weather = dated(feeds.weather ?? [])[0];
  const [radio, telemetry] = await Promise.all([withArchiveAudio(session, clips), sampledTelemetry(session, feeds.laps ?? [])]);
  return { session, rows, events, radio, telemetry,
    controlAvailable: Boolean(feeds.race_control), radioAvailable: Boolean(feeds.team_radio),
    weather: weather ? { date: weather.date, air: weather.air_temperature, track: weather.track_temperature,
      humidity: weather.humidity, wind: weather.wind_speed, rain: weather.rainfall } : null,
    version: dashboardArchiveVersion,
    updatedAt: controls[0]?.date ?? session.endsAt,
    complete: rows.length > 0 && identity.size > 0 && results.slice(0, 5).every(result => result.status === 'fulfilled') };
}
