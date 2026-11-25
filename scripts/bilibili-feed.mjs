import { request, xmlText } from './feeds.mjs';

export const biliAccount = 296086460;
export const biliId = /^BV[1-9A-HJ-NP-Za-km-z0-9]{10}$/;
const searchOrigin = 'https://api.bilibili.com/x/web-interface/search/';
const chinaSeason = Date.parse('2026-01-01T00:00:00+08:00');
const roundNames = [
  [/拉斯维加斯/, 'las-vegas'], [/卡塔尔|卢赛尔/, 'qatar'], [/阿布扎比|亚斯码头/, 'abu-dhabi'],
  [/圣保罗|巴西大奖赛/, 'brazil'], [/墨西哥城|墨西哥大奖赛/, 'mexico'],
];
const strip = value => xmlText(String(value ?? '').replace(/<[^>]+>/g, '')).trim();

export function normalizeBilibili(item, now) {
  if (!biliId.test(item.bvid) || item.is_pay || item.is_charge_video) return null;
  const published = Number(item.pubdate) * 1000;
  if (!Number.isFinite(published) || published < chinaSeason || published > now) return null;
  const title = strip(item.title);
  if (!title) return null;
  const duration = String(item.duration || '').split(':');
  const seconds = duration.every(part => /^\d+$/.test(part)) ? duration.reduce((value, part) => value * 60 + Number(part), 0) : 0;
  const cover = String(item.pic || item.cover || '').replace(/^\/\//, 'https://');
  const round = roundNames.find(([pattern]) => pattern.test(title))?.[1] || '';
  const kind = /集锦|最快换胎|最快单圈/.test(title) ? 'highlights' :
    /车载|无线电/.test(title) ? 'onboard' : /采访|专访/.test(title) ? 'interviews' : 'featured';
  return [item.bvid, new Date(published).toISOString(), seconds, title,
    /^https:\/\/i\d+\.hdslb\.com\/bfs\//.test(cover) ? cover : '', round, kind, Number(item.play) || 0];
}

async function search(path, params) {
  const url = new URL(path, searchOrigin);
  url.search = new URLSearchParams(params);
  const { code, data } = await request(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  }).then(response => response.json());
  if (code !== 0 || !Array.isArray(data?.result)) throw new Error(`Unexpected Bilibili search response (${code})`);
  return data.result;
}

export async function latestBilibili(now = Date.now()) {
  const keyword = 'F1世界锦标赛';
  const jobs = [
    search('type', { search_type: 'video', keyword, order: 'pubdate' })
      .then(items => items.filter(item => Number(item.mid) === biliAccount)),
    search('all/v2', { keyword: 'F1' }).then(groups => groups
      .filter(group => group.result_type === 'bili_user').flatMap(group => group.data || [])
      .filter(account => Number(account.mid) === biliAccount).flatMap(account => account.res || [])),
  ];
  const results = await Promise.allSettled(jobs);
  return [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .map(item => normalizeBilibili(item, now)).filter(Boolean).map(row => [row[0], row])).values()]
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
}
