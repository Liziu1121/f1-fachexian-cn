import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { officialArticleUrl, officialNewsLinks, request, xmlText } from './feeds.mjs';
import { circuitMedia, refreshEdition } from './edition.mjs';
import { patchNews } from './news-overlay.mjs';

const biliAccount = 296086460;
const biliId = /^BV[1-9A-HJ-NP-Za-km-z0-9]{10}$/;
const han = value => typeof value === 'string' && /\p{Script=Han}/u.test(value);
const json = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('Content snapshot:', error.message);
    return fallback;
  }
};
const writeJson = (path, value) => writeFile(path, JSON.stringify(value) + '\n');

function plain(value) {
  return xmlText(String(value ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

async function chineseTitle(title) {
  if (!title || new TextEncoder().encode(title).byteLength > 500) return '';
  const url = new URL('https://api.mymemory.translated.net/get');
  url.search = new URLSearchParams({ q: title, langpair: 'en|zh-CN' });
  const data = await request(url, { signal: AbortSignal.timeout(4500) }).then(response => response.json());
  const translated = plain(data.responseData?.translatedText);
  return Number(data.responseStatus) === 200 && !data.quotaFinished && han(translated) ? translated : '';
}

async function buildNews(site, cacheDir, notes, edition, media) {
  const target = join(site, 'api', 'news', 'latest.json');
  const incoming = edition ? {} : await json(target, {});
  let feed = edition;
  if (!feed) {
    const rows = (incoming.items ?? []).filter(row => Array.isArray(row) && officialArticleUrl(row[0]) &&
      Number.isFinite(Date.parse(row[1])) && plain(row[2]));
    const links = rows.length ? await officialNewsLinks('latest').catch(() => new Map()) : new Map();
    const items = rows.map(([id, stamp, title, , kind, image, zh, info]) => [
      id, stamp, plain(title), '', kind, image,
      { title: [notes[id]?.title, zh?.title].find(han) || '' },
      { url: links.get(id) ?? info?.url ?? officialArticleUrl(id), source: 'F1' },
    ]);
    feed = await refreshEdition({ feed: { items }, media, cacheDir });
  }
  await mkdir(join(site, 'api', 'news'), { recursive: true });
  await writeJson(target, feed);
  return feed;
}

export async function translateLiveHeadlines(news, cacheDir) {
  const path = join(cacheDir, 'live-headline-translations.json');
  const translations = new Map((await json(path, [])).filter(pair => Array.isArray(pair) && han(pair[1])));
  const missing = news.items.filter(item => !item.titleZh && !translations.has(item.title));
  for (let i = 0; i < Math.min(missing.length, 12); i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async item => {
      const title = await chineseTitle(item.title).catch(() => '');
      if (title) translations.set(item.title, title);
    }));
  }
  await writeJson(path, [...translations].slice(-200));
  return { ...news, items: news.items.map(item => ({ ...item, titleZh: item.titleZh || translations.get(item.title) })) };
}

async function verifiedVideo(id) {
  try {
    const url = new URL('https://api.bilibili.com/x/web-interface/view');
    url.searchParams.set('bvid', id);
    const { data } = await request(url).then(response => response.json());
    return data?.bvid === id && data.owner?.mid === biliAccount ? true : false;
  } catch {
    return false;
  }
}

async function buildVideos(site, cacheDir, refresh) {
  const target = join(site, 'api', 'videos', 'mainland.json');
  const cachePath = join(cacheDir, 'official-video.json');
  const [incoming, previous] = await Promise.all([json(target, {}), json(cachePath, {})]);
  const official = new Map((previous.items ?? []).map(row => [row[0], row]));
  const candidates = (refresh || !previous.items ? incoming.items ?? [] : []).filter(row =>
    Array.isArray(row) && biliId.test(row[0]) && Number.isFinite(Date.parse(row[1])) && typeof row[3] === 'string');
  for (let i = 0; i < Math.min(candidates.length, 20); i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async row => {
      if (official.has(row[0]) || await verifiedVideo(row[0])) official.set(row[0], row);
    }));
  }
  const data = {
    items: [...official.values()].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 80),
  };
  await mkdir(join(site, 'api', 'videos'), { recursive: true });
  await writeJson(cachePath, data);
  return data;
}

function patchVideo(js, replace) {
  const oldSources = js.match(/  const douyinClips=\[[\s\S]*?\n  };\n(?=  const hasBilibili=)/)?.[0];
  if (!oldSources) throw new Error('The mirror’s video sources have changed.');
  const sources = [
    '  const officialDouyin=window.F1_CONTENT_EXTRAS.douyin;',
    '  const douyinClips=officialDouyin.items.map(item=>["dy-"+item.id,item.stamp,item.seconds||0,item.title,item.cover||"",item.round,item.kind,0]);',
    '  const douyinSources=Object.fromEntries(officialDouyin.items.map(item=>["dy-"+item.id,{...item,author:"F1世界锦标赛",title:[item.title,item.en]}]));',
    '  const matchesSource=(row,source)=>!source||(source==="douyin"?Object.hasOwn(douyinSources,row[0]):hasBilibili(row[0]));',
    '',
  ].join('\n');
  js = replace(js, oldSources, sources);
  js = replace(js, 'const hasBilibili=id=>id.startsWith("BV");',
    'const hasBilibili=id=>typeof id==="string"&&'+biliId+'.test(id);');
  js = replace(js, '...types[row[6]]', '...(types[row[6]]||types.featured)');
  js = replace(js, '\'<span class="video-duration">\'+duration+\'</span></span>\'', '(seconds>0?\'<span class="video-duration">\'+duration+\'</span>\':"")+\'</span>\'');
  js = replace(js, 'const category=types[type][0];', 'const category=(types[type]||types.featured)[english()?1:0];');
  js = replace(js, 'const newest=[...videos.values()].sort', 'const newest=[...videos.values()].filter(row=>matchesSource(row,qs("#videoSource").value)).sort');
  js = replace(js, 'const source=qs("#videoSource").value;\n    const terms',
    'const source=qs("#videoSource").value;\n    const month=qs("#videoMonth").value;\n    const monthAt=new Intl.DateTimeFormat("en",{timeZone:"Asia/Shanghai",month:"2-digit"});\n    const terms');
  js = replace(js, '(!source||(source==="douyin"?Object.hasOwn(douyinSources,row[0]):hasBilibili(row[0])))&&',
    'matchesSource(row,source)&&(!month||monthAt.format(new Date(row[1]))===month)&&');
  js = replace(js, 'qs("#videoList").innerHTML=items.length?', [
    'qs("#videoDouyinCoverage").hidden=Boolean(source&&source!=="douyin");',
    '    qs("#videoList").innerHTML=items.length?',
  ].join('\n'));
  js = js.replaceAll('all.length.toLocaleString()', 'all.filter(row=>matchesSource(row,source)).length.toLocaleString()');
  js = replace(js, 'signal:AbortSignal.timeout(10000)', 'signal:AbortSignal.timeout(10000),cache:"no-cache"');
  js = replace(js, 'if(!Array.isArray(result?.items)||!result.items.length)return;', 'if(!Array.isArray(result?.items))return;\n      lastRefresh=Date.now();\n      result.items=result.items.filter(row=>hasBilibili(row[0]));\n      if(!result.items.length)return;');
  js = replace(js, '      insert(result.items);\n      lastRefresh=Date.now();', '      insert(result.items);');
  const platformSwitch = [
    '    const swap=qs("#videoSwitch");',
    '    swap.hidden=!douyinSources[playing[0]]||!hasBilibili(playing[0]);',
    '    swap.textContent=douyin?(en?"Play on Bilibili":"切换哔哩哔哩"):(en?"Play on Douyin":"切换抖音");',
  ].join('\n');
  js = replace(js, platformSwitch, '');
  js = replace(js, [
    '  qs("#videoSwitch").addEventListener("click",()=>{',
    '    playerSource=playerSource==="douyin"?"bilibili":"douyin";',
    '    loadPlayer();',
    '  });\n',
  ].join('\n'), '');
  js = replace(js, '  for(const [id,event] of [["videoSeason","change"]', [
    '  function drawMonths() {',
    '    const select=qs("#videoMonth"), month=select.value;',
    '    const names=new Intl.DateTimeFormat(english()?"en":"zh-CN",{month:"long",timeZone:"UTC"});',
    '    select.replaceChildren(new Option(english()?"All months":"全部月份",""), ...Array.from({length:12},(_,i)=>',
    '      new Option(names.format(new Date(Date.UTC(2026,i,1))),String(i+1).padStart(2,"0"))));',
    '    select.value=month;',
    '  }',
    '  drawMonths();',
    '  for(const [id,event] of [["videoMonth","change"],["videoSeason","change"]',
  ].join('\n'));
  js = replace(js, '  window.addEventListener("f1:language",()=>{', '  window.addEventListener("f1:language",()=>{\n    drawMonths();');
  js = replace(js, '      const data=await archive();\n      if(!active)return;\n      if(data){\n        if(!videos.size){\n          insert(data.rows);\n          insert(douyinClips);\n          classic=data.classic;\n        }',
    '      if(douyinClips.length&&!videos.has(douyinClips[0][0])) insert(douyinClips);\n      const data=await archive();\n      if(!active)return;\n      if(data){\n        for(const row of data.rows.filter(row=>hasBilibili(row[0]))) if(!videos.has(row[0])) insert([row]);\n        if(!classic.length) classic=data.classic.filter(row=>hasBilibili(row[0]));\n      }\n      if(videos.size){');
  js = replace(js, '  setInterval(()=>{if(active&&!document.hidden)sync();},300000);',
    '  setInterval(()=>{if(active&&!document.hidden)sync();},300000);\n  document.addEventListener("visibilitychange",()=>{if(active&&!document.hidden)sync();});');
  js = js.replace('  const hasBilibili=', '  const officialVideo=row=>/^https:\\/\\/www\\.formula1\\.com\\/en\\/video\\/[a-z0-9-]+\\.\\d+$/i.test(row?.[8]||"");\n  const officialRows=items=>(items||[]).map(item=>["f1-"+item.url.split(".").at(-1),item.stamp,item.seconds||0,item.title,item.image||"",item.round,item.type,0,item.url]).filter(officialVideo);\n  const hasBilibili=');
  js = js.replace('source==="douyin"?Object.hasOwn(douyinSources,row[0]):hasBilibili(row[0])',
    'source==="f1"?officialVideo(row):source==="douyin"?Object.hasOwn(douyinSources,row[0]):hasBilibili(row[0])');
  const sourceChoice = '    const source=preferred&&(!hasBilibili(id)||qs("#videoSource").value!=="bilibili")?"douyin":"bilibili";';
  js = replace(js, sourceChoice, sourceChoice.replace('const source=', 'const source=officialVideo(row)?"f1":'));
  const player = '  function loadPlayer() {';
  js = replace(js, player, player + `
    const retry=qs("#videoRetry");
    retry.hidden=playerSource==="f1";
    if(playerSource==="f1"){
      const status=document.createElement("p");
      status.className="video-unavailable sub";
      status.textContent=english()?"The official source does not offer playback on this site.":"此视频的官方来源暂未开放站内播放。";
      qs("#videoPlayer").replaceChildren(status);
      showPlayerDetails();
      return;
    }`);
  const credit = '    qs("#videoCredit").textContent=douyin?';
  js = replace(js, credit, credit.replace('=douyin?', '=playerSource==="f1"?(en?"Formula 1 official":"F1 官网"):douyin?'));
  js = js.replace('    const lead=raceHighlights[0]||newest[0];', [
    '    const latest=newest.filter(row=>Date.parse(row[1])>=cutoff);',
    '    const score=row=>Math.log10(1+Math.max(0,Number(row[7])||0))*10-(Date.now()-Date.parse(row[1]))/3600000;',
    '    const lead=latest.sort((a,b)=>score(b)-score(a))[0]||newest[0];',
  ].join('\n'));
  js = js.replace('      result.items=result.items.filter(row=>hasBilibili(row[0]));', '      result.items=[...result.items.filter(row=>hasBilibili(row[0])),...officialRows(result.official)];');
  js = js.replace('  window.F1_VIDEOS={', '  insert(officialRows(window.F1_CONTENT_EXTRAS.feed.videos));\n  window.F1_VIDEOS={');
  return js;
}

function patchIndex(index, replace) {
  index = replace(index, '  <script defer src="./video.js"></script>',
    '  <script defer src="./content-data.js"></script>\n  <script defer src="./video.js"></script>');
  const sourceField = '        <label>片源<select id="videoSource"><option value="">全部片源</option><option value="douyin">抖音</option><option value="bilibili">哔哩哔哩</option></select></label>';
  index = replace(index, sourceField, sourceField.replace('</select>', '<option value="f1">F1 官网</option></select>') +
    '\n        <label>月份<select id="videoMonth"><option value="">全部月份</option></select></label>');
  index = replace(index, '      <p id="videoCount" class="sub" role="status"></p>', [
    '      <p class="sub" id="videoDouyinCoverage">抖音档案收录已核对的 2026 年官号作品，尚未收齐。</p>',
    '      <p id="videoCount" class="sub" role="status"></p>',
  ].join('\n'));
  return replace(index, '          <button class="action" type="button" id="videoSwitch" hidden></button>\n', '');
}

export async function installContent({ root, site, cacheDir, replaceOnce }) {
  const notes = await json(join(root, 'content', 'news-notes.json'), {});
  const douyin = await json(join(root, 'content', 'douyin-2026.json'), null);
  if (!douyin || !/^https:\/\/www\.douyin\.com\/user\/[\w-]+$/.test(douyin.profile)) {
    throw new Error('The official Douyin account is missing from the archive.');
  }
  douyin.items = [...new Map(douyin.items.filter(item => /^\d{19}$/.test(item.id)
    && Date.parse(item.stamp) >= Date.parse('2026-01-01T00:00:00+08:00')
    && Date.parse(item.stamp) < Date.parse('2027-01-01T00:00:00+08:00')).map(item => [item.id, item])).values()];
  const sectors = JSON.parse(await readFile(join(root, 'content', 'circuit-sectors-2026.json'), 'utf8'));
  await mkdir(cacheDir, { recursive: true });
  const saved = await json(join(cacheDir, 'edition.json'), {});
  const edition = saved.window === Math.floor(Date.now() / (3 * 3600_000)) ? saved : null;
  const [media, videos] = await Promise.all([circuitMedia(site, cacheDir), buildVideos(site, cacheDir, !edition)]);
  const feed = await buildNews(site, cacheDir, notes, edition, media);
  await writeJson(join(site, 'api', 'videos', 'mainland.json'), { ...videos, official: feed.videos });
  const patch = async (asset, transform) => {
    const path = join(site, asset);
    const original = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    await writeFile(path, transform(original, (str, from, to) => replaceOnce(str, from, to, asset)));
  };
  await Promise.all([
    patch('app.js', patchNews),
    patch('video.js', patchVideo),
    patch('index.html', (html, replace) => patchIndex(html, replace)),
    writeFile(join(site, 'content-data.js'), 'window.F1_CONTENT_EXTRAS=' + JSON.stringify({ douyin, feed, notes, sectors, galleries: Object.fromEntries(Object.entries(media).map(([key, item]) => [key, item.photos])) }) + ';\n'),
  ]);
  console.log('Content ready: ' + feed.items.length + ' recent news items, ' + douyin.items.length + ' verified Douyin videos.');
  return feed;
}
