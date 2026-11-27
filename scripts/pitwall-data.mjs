import { request } from './feeds.mjs';

const entry = session => session && Number.isInteger(session.circuitKey)
  ? [new Date(session.startsAt).getUTCFullYear(), session.circuitKey] : null;

async function circuitLayout(year, key) {
  const response = await request('https://api.t1f1.com/api/static/circuits/' + key + '/data?year=' + year);
  const { data } = await response.json();
  const { x, y } = data?.track_outline ?? {};
  if (Number(data?.year) !== year || Number(data?.circuit_id) !== key || !Array.isArray(x) || !Array.isArray(y)
    || x.length !== y.length || x.length < 3 || x.length > 12_000 || ![...x, ...y].every(Number.isFinite)) return null;
  return { x, y, rotation: Number(data.rotation) || 0 };
}

async function grid(year) {
  const response = await request('https://api.t1f1.com/api/static/drivers?year=' + year);
  const { drivers } = await response.json();
  if (!Array.isArray(drivers)) return [];
  return drivers.flatMap(({ number, code, full_name, team, color }) => {
    if (!Number.isInteger(number) || !/^[A-Z]{3}$/.test(code) || typeof full_name !== 'string') return [];
    return [{ number, code, name: full_name, team, color }];
  });
}

export async function pitwallReference(schedule, archives, previous, now) {
  const recent = schedule.find(session => session.startsAt <= now);
  const next = schedule.findLast(session => session.startsAt > now);
  const races = [recent, next, archives[0]].filter(Boolean);
  const candidates = new Map();
  for (const session of races) {
    const related = session.meeting != null && archives.find(archive => String(archive.meeting) === String(session.meeting));
    const parts = entry(session) || entry(related);
    if (parts) candidates.set(parts.join('-'), parts);
  }
  const year = new Date(now).getUTCFullYear();
  const drivers = previous?.year === year && previous.drivers?.length
    ? previous.drivers : await grid(year).catch(() => []);
  const layouts = {};
  for (const [id, [season, key]] of candidates) {
    const layout = previous?.layouts?.[id] ?? await circuitLayout(season, key).catch(() => null);
    if (layout) layouts[id] = layout;
  }
  return { year, drivers, layouts };
}
