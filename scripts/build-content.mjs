import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { officialArticleUrl, officialNewsLinks, request, xmlText } from './feeds.mjs';
import { circuitMedia, refreshEdition } from './edition.mjs';
import { patchHeroPhoto } from './home-photo.mjs';
import { biliAccount, biliId, latestBilibili } from './bilibili-feed.mjs';
import { recentDouyin } from './douyin-feed.mjs';
import { writeReports } from './newsroom.mjs';
import { patchNews } from './news-overlay.mjs';

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

async function buildNews(site, cacheDir, notes, edition) {
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
    feed = await refreshEdition({ feed: { items }, cacheDir });
  }
  await mkdir(join(site, 'api', 'news'), { recursive: true });
  const news = { items: feed.items, leadId: feed.leadId, checked: feed.checked, window: feed.window };
  await writeJson(target, news);
  return news;
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

async function buildVideos({ root, site, cacheDir, window }) {
  const target = join(site, 'api', 'videos', 'mainland.json');
  const cachePath = join(cacheDir, 'official-video.json');
  const [incoming, previous, seed] = await Promise.all([
    json(target, {}), json(cachePath, {}), json(join(root, 'content', 'bilibili-backfill.json'), []),
  ]);
  const officialRow = row => Array.isArray(row) && biliId.test(row[0]) &&
    Number.isFinite(Date.parse(row[1])) && Date.parse(row[1]) <= Date.now() && typeof row[3] === 'string';
  const published = new Map([...seed, ...(previous.items || [])].filter(officialRow).map(row => [row[0], row]));
  if (previous.window === window && previous.sourceVersion === 2 && previous.status === 'public-list') {
    return { ...previous, items: [...published.values()].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 80) };
  }
  const rows = await latestBilibili();
  for (const row of rows) published.set(row[0], row);
  const candidates = (incoming.items ?? []).filter(officialRow).slice(0, 20);
  let seen = rows.length;
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(candidates.slice(i, i + 4).map(async row => {
      if (!published.has(row[0]) && !(await verifiedVideo(row[0]))) return;
      if (!published.has(row[0])) published.set(row[0], row);
      seen += 1;
    }));
  }
  const items = [...published.values()].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 80);
  const now = new Date().toISOString();
  const data = {
    window, sourceVersion: 2, checkedAt: now,
    verifiedAt: seen ? now : previous.verifiedAt ?? null,
    status: seen ? 'public-list' : 'archive', items,
  };
  console.log(`Bilibili: ${rows.length} items from public search, ${items.length} validated items ready for publication.`);
  await writeJson(cachePath, data);
  return data;
}

function patchVideo(js, replace) {
  const oldSources = js.match(/  const douyinClips=\[[\s\S]*?\n  };\n(?=  const hasBilibili=)/)?.[0];
  if (!oldSources) throw new Error('The mirror’s video sources have changed.');
  const sources = [
    '  const officialDouyin=window.F1_CONTENT_EXTRAS.douyin;',
    '  const douyinSources=Object.create(null);',
    '  function douyinRows(items) {',
    '    return (items||[]).flatMap(item=>{',
    '      if(!/^\\d{19}$/.test(item.id)||!item.title||!Number.isFinite(Date.parse(item.stamp)))return [];',
    '      const id="dy-"+item.id;',
    '      douyinSources[id]={...item,author:"F1世界锦标赛",title:[item.title,item.en||item.title]};',
    '      return [[id,item.stamp,item.seconds||0,item.title,item.cover||"",item.round,item.kind,0]];',
    '    });',
    '  }',
    '  const douyinClips=douyinRows(officialDouyin.items);',
    '  let biliStatus=window.F1_CONTENT_EXTRAS.biliStatus;',
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
    'qs("#videoDouyinCoverage").hidden=Boolean(source&&source!=="douyin")||officialDouyin.status==="public-list";\n    qs("#videoBiliCoverage").hidden=Boolean(source&&source!=="bilibili")||biliStatus==="public-list";',
    '    qs("#videoList").innerHTML=items.length?',
  ].join('\n'));
  js = js.replaceAll('all.length.toLocaleString()', 'all.filter(row=>matchesSource(row,source)).length.toLocaleString()');
  js = replace(js, 'signal:AbortSignal.timeout(10000)', 'signal:AbortSignal.timeout(10000),cache:"no-cache"');
  js = replace(js, 'if(!Array.isArray(result?.items)||!result.items.length)return;', 'if(!Array.isArray(result?.items))return;\n      lastRefresh=Date.now();\n      result.items=[...result.items.filter(row=>hasBilibili(row[0])),...douyinRows(result.douyin)];\n      if(result.douyinStatus)officialDouyin.status=result.douyinStatus;\n      if(result.status)biliStatus=result.status;\n      if(!result.items.length)return;');
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
  js = js.replace('    const lead=raceHighlights[0]||newest[0];', [
    '    const latest=newest.filter(row=>Date.parse(row[1])>=cutoff);',
    '    const score=row=>Math.log10(1+Math.max(0,Number(row[7])||0))*10-(Date.now()-Date.parse(row[1]))/3600000;',
    '    const lead=latest.sort((a,b)=>score(b)-score(a))[0]||newest[0];',
  ].join('\n'));
  js = replace(js, '  window.F1_VIDEOS={',
    '  insert((window.F1_CONTENT_EXTRAS.biliItems||[]).filter(row=>hasBilibili(row[0])));\n  window.F1_VIDEOS={');
  return js;
}

function patchIndex(index, replace) {
  index = replace(index, '  <script defer src="./video.js"></script>',
    '  <script defer src="./content-data.js"></script>\n  <script defer src="./video.js"></script>');
  const sourceField = '        <label>片源<select id="videoSource"><option value="">全部片源</option><option value="douyin">抖音</option><option value="bilibili">哔哩哔哩</option></select></label>';
  index = replace(index, sourceField, sourceField +
    '\n        <label>月份<select id="videoMonth"><option value="">全部月份</option></select></label>');
  index = replace(index, '      <p id="videoCount" class="sub" role="status"></p>', [
    '      <p class="sub" id="videoBiliCoverage" hidden>哔哩哔哩的最新清单暂不可用，现显示已核对的归档视频。</p>',
    '      <p class="sub" id="videoDouyinCoverage">抖音官号最新清单暂未公开，现显示已核对的归档视频。</p>',
    '      <p id="videoCount" class="sub" role="status"></p>',
  ].join('\n'));
  return replace(index, '          <button class="action" type="button" id="videoSwitch" hidden></button>\n', '');
}

const licensedPublishers = new Set(['F1', 'Sky Sports', 'Motorsport.com']);
const fullText = paragraphs => Array.isArray(paragraphs) && paragraphs.length > 0 &&
  paragraphs.every(paragraph => typeof paragraph === 'string' && paragraph.trim());

export function licensedNews(articles, now = Date.now()) {
  const notes = Object.create(null);
  if (!Array.isArray(articles)) throw new Error('The licensed news archive must be a list of articles.');
  const items = articles.map(article => {
    const { id, source, published, titleZh, titleEn, fullTextZh, fullTextEn } = article;
    const stamp = Date.parse(published);
    const key = `licensed-${id}`;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(id) || notes[key] ||
        !licensedPublishers.has(source) || !Number.isFinite(stamp) || stamp > now ||
        !han(titleZh) || typeof titleEn !== 'string' || !titleEn.trim() ||
        !fullText(fullTextZh) || !fullText(fullTextEn)) {
      throw new Error(`Invalid licensed news article: ${key}`);
    }
    notes[key] = { title: titleZh, fullTextZh, fullTextEn };
    return [key, new Date(stamp).toISOString(), titleEn, '', 'news', '', { title: titleZh }, { source }];
  });
  return { items, notes };
}

export async function installContent({ root, site, cacheDir, replaceOnce }) {
  const notes = await json(join(root, 'content', 'news-notes.json'), {});
  const licensed = licensedNews(await readFile(join(root, 'content', 'licensed-news.json'), 'utf8')
    .then(JSON.parse, error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    }));
  const douyin = await json(join(root, 'content', 'douyin-2026.json'), null);
  if (!douyin || !/^https:\/\/www\.douyin\.com\/user\/[\w-]+$/.test(douyin.profile)) {
    throw new Error('The official Douyin account is missing from the archive.');
  }
  const sectors = JSON.parse(await readFile(join(root, 'content', 'circuit-sectors-2026.json'), 'utf8'));
  await mkdir(cacheDir, { recursive: true });
  const window = Math.floor(Date.now() / (3 * 3600_000));
  const saved = await json(join(cacheDir, 'edition.json'), {});
  const edition = saved.window === window ? saved : null;
  const douyinPath = join(cacheDir, 'douyin-public.json');
  const previous = await json(douyinPath, { items: [] });
  const refreshVideos = previous.window !== window;
  const [media, videos, discovered] = await Promise.all([
    circuitMedia(site, cacheDir),
    buildVideos({ root, site, cacheDir, window }),
    refreshVideos ? recentDouyin(douyin.profile).catch(() => []) : previous.items,
  ]);
  const douyinStatus = refreshVideos ? discovered.length > 0 ? 'public-list' : 'archive' : previous.status;
  if (refreshVideos) await writeJson(douyinPath, {
    window, status: douyinStatus, checked: Date.now(),
    items: [...new Map([...previous.items, ...discovered].map(item => [item.id, item])).values()],
  });
  const publicItems = (await json(douyinPath, previous)).items;
  douyin.status = douyinStatus;
  douyin.items = [...new Map([...douyin.items, ...publicItems].filter(item => /^\d{19}$/.test(item.id) &&
    Number.isFinite(Date.parse(item.stamp)) && typeof item.title === 'string').map(item => [item.id, item])).values()]
    .sort((a, b) => Date.parse(b.stamp) - Date.parse(a.stamp));
  const externalNews = await buildNews(site, cacheDir, notes, edition);
  const editorial = await writeReports(site, media);
  Object.assign(notes, editorial.notes, licensed.notes);
  const originalItems = [...editorial.items, ...licensed.items, ...externalNews.items].map(row => {
    const note = notes[row[0]];
    const onSite = Boolean((note?.fullTextZh?.length || note?.body?.length) &&
      (note?.fullTextEn?.length || note?.bodyEn?.length));
    return [...row.slice(0, 7), { ...row[7], onSite }];
  }).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  const feed = { ...externalNews, items: originalItems, leadId: originalItems.find(row => row[7].onSite)?.[0] };
  await writeJson(join(site, 'api', 'news', 'latest.json'), feed);
  await writeJson(join(site, 'api', 'videos', 'mainland.json'), { ...videos, douyin: douyin.items, douyinStatus });
  const patch = async (asset, transform) => {
    const path = join(site, asset);
    const original = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    await writeFile(path, transform(original, (str, from, to) => replaceOnce(str, from, to, asset)));
  };
  await Promise.all([
    patch('app.js', (js, replace) => patchHeroPhoto(patchNews(js, replace))),
    patch('video.js', patchVideo),
    patch('index.html', (html, replace) => patchIndex(html, replace)),
    writeFile(join(site, 'content-data.js'), 'window.F1_CONTENT_EXTRAS=' + JSON.stringify({ douyin, biliItems: videos.items, biliStatus: videos.status, feed, notes, sectors, galleries: Object.fromEntries(Object.entries(media).map(([key, item]) => [key, item.photos])) }) + ';\n'),
  ]);
  console.log('Content ready: ' + feed.items.length + ' recent news items, ' + douyin.items.length + ' verified Douyin videos.');
  return feed;
}
