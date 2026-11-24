import { cache, request } from './feeds.mjs';

const origin = 'https://f1archive.org';
const api = `${origin}/api/v1`;
const slug = /^[a-z\d]+(?:-[a-z\d]+)*$/;
const absolute = value => { try { return new URL(value).href; } catch { return null; } };
const read = async url => (await request(url, { signal: AbortSignal.timeout(10_000) })).json();
const calendar = cache(year => read(`${api}/seasons/${year}/calendar`), 30 * 60_000, 5);
const eventDetails = cache(path => read(`${api}/events/${path}`), 10 * 60_000);
const radioDetails = cache(path => read(`${api}/sessions/${path}/radio`), 10 * 60_000);

export async function withArchiveAudio(session, clips) {
  if (!clips.length) return clips;
  try {
    const year = new Date(session.startsAt).getUTCFullYear();
    const events = await calendar(year);
    const candidates = events.filter(event => slug.test(event.event) && Date.parse(event.start_utc) <= session.startsAt + 20 * 60_000
      && Date.parse(event.end_utc) >= session.startsAt - 20 * 60_000);
    const sources = await Promise.allSettled(candidates.map(async weekend => {
      const eventPath = `${year}/${weekend.event}`;
      const event = await eventDetails(eventPath);
      const known = event.sessions?.find(item => slug.test(item.slug) && item.name === session.name &&
        Math.abs(Date.parse(item.start_utc) - session.startsAt) <= 15 * 60_000);
      if (!known?.has_radio) return [];
      const sessionPath = `${eventPath}/${known.slug}`;
      const prefix = `/media/radio/${sessionPath}/`;
      return (await radioDetails(sessionPath)).flatMap(row => {
        const path = row.audio_url;
        const source = absolute(row.source_url);
        if (!source || typeof path !== 'string' || !path.startsWith(prefix) || !/^\d+\.mp3$/.test(path.slice(prefix.length))) return [];
        return [[source, `${origin}${path}`]];
      });
    }));
    const alternatives = new Map(sources.flatMap(result => result.value || []));
    return clips.map(clip => alternatives.has(absolute(clip.originalUrl || clip.url))
      ? { ...clip, url: alternatives.get(absolute(clip.originalUrl || clip.url)), originalUrl: clip.originalUrl || clip.url, source: 'F1Archive' } : clip);
  } catch {
    return clips;
  }
}
