import { cache, request } from './feeds.mjs';

const origin = 'https://f1archive.org';
const api = `${origin}/api/v1`;
const slug = /^[a-z\d]+(?:-[a-z\d]+)*$/;
const read = async url => (await request(url, { signal: AbortSignal.timeout(3000) })).json();
const calendar = cache(year => read(`${api}/seasons/${year}/calendar`), 30 * 60_000, 5);
const eventDetails = cache(path => read(`${api}/events/${path}`), 10 * 60_000);
const radioDetails = cache(path => read(`${api}/sessions/${path}/radio`), 10 * 60_000);

export async function withArchiveAudio(session, clips) {
  if (!clips.length) return clips;
  try {
    const year = new Date(session.startsAt).getUTCFullYear();
    const events = await calendar(year);
    const weekend = events.find(event => slug.test(event.event) && Date.parse(event.start_utc) <= session.startsAt + 20 * 60_000
      && Date.parse(event.end_utc) >= session.startsAt - 20 * 60_000);
    if (!weekend) return clips;
    const eventPath = `${year}/${weekend.event}`;
    const event = await eventDetails(eventPath);
    const known = event.sessions?.find(item => slug.test(item.slug) && Date.parse(item.start_utc) === session.startsAt);
    if (!known?.has_radio) return clips;
    const sessionPath = `${eventPath}/${known.slug}`;
    const rows = await radioDetails(sessionPath);
    const prefix = `/media/radio/${sessionPath}/`;
    const alternatives = new Map(rows.flatMap(row => {
      const path = row.audio_url;
      if (typeof path !== 'string' || !path.startsWith(prefix) || !/^\d+\.mp3$/.test(path.slice(prefix.length))) return [];
      return [[row.source_url, `${origin}${path}`]];
    }));
    return clips.map(clip => alternatives.has(clip.url)
      ? { ...clip, url: alternatives.get(clip.url), originalUrl: clip.url, source: 'F1Archive' } : clip);
  } catch {
    return clips;
  }
}
