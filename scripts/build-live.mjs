import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeRadio, archiveDelay, archiveDetails, dashboardArchiveVersion, mirrorCalendar, openCalendar } from './live-data.mjs';
import { fiaBulletins, liveNews } from './feeds.mjs';
import { withArchiveAudio } from './radio-archive.mjs';
import { populateRadioText } from './radio-text.mjs';
import { installPdfReader } from './pdf-runtime.mjs';
import { regulations } from './edition.mjs';
import { installContent, translateLiveHeadlines } from './build-content.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = join(root, 'public');
const sources = join(root, 'live');
const cacheDir = join(root, '.live-cache');
const snapshots = join(site, 'api', 'live');
const now = Date.now();
const order = (a, b) => b.startsAt - a.startsAt;
const readText = async path => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
const writeJson = (path, data) => writeFile(path, `${JSON.stringify(data)}\n`);

function replaceOnce(text, original, replacement, asset) {
  const first = text.indexOf(original);
  if (first === -1 || first !== text.lastIndexOf(original)) {
    throw new Error(`The mirror's ${asset} integration point changed: ${original}`);
  }
  return text.slice(0, first) + replacement + text.slice(first + original.length);
}

async function installDashboard() {
  const [index, app, locale, dashboard, translations] = await Promise.all([
    ...['index.html', 'app.js', 'locale.js'].map(file => readText(join(site, file))),
    ...['dashboard.html', 'translations.txt'].map(file => readText(join(sources, file))),
  ]);
  if (index.includes('id="live"') || app.includes('window.F1_LIVE')) {
    throw new Error('The mirror already contains a live page. Rebuild the mirror before applying the dashboard.');
  }

  let html = index;
  const addBefore = (anchor, insertion) => { html = replaceOnce(html, anchor, insertion + anchor, 'index.html'); };
  const addAfter = (anchor, insertion) => { html = replaceOnce(html, anchor, anchor + insertion, 'index.html'); };
  addAfter('  <link rel="stylesheet" href="./style.css">', '\n  <link rel="stylesheet" href="./live.css">');
  addAfter('  <link rel="stylesheet" href="./live.css">', '\n  <link rel="stylesheet" href="./circuit-sectors.css">');
  addAfter('  <link rel="stylesheet" href="./circuit-sectors.css">', '\n  <link rel="stylesheet" href="./home.css">');
  addBefore('  <script defer src="./app.js"></script>',
    '  <script defer src="./circuit-sectors.js"></script>\n  <script defer src="./live.js"></script>\n  <script defer src="./regulations.js"></script>\n');
  addBefore('      <a href="#/weekend" data-nav="weekend" class="nav-weekend">',
    '      <a href="#/live" data-nav="live" class="nav-live">比赛实况</a>\n');
  addAfter('        <a class="menu-group-title" href="#/trackside" data-nav="trackside">赛道上</a>',
    '\n        <a href="#/live" data-nav="live">比赛实况</a>');
  addBefore('          <a class="action hero-secondary" href="#/trackside">',
    '          <a class="action hero-secondary" href="#/live">比赛实况</a>\n');
  addAfter('<button class="action follow-button" id="weekendFollow" type="button"></button>',
    '<a class="action outline" href="#/live">比赛实况</a>');
  addBefore('  <section class="frame section page" id="weekend" data-page="weekend" hidden>', dashboard);

  html = html.replaceAll('规则速查', '规则查询')
    .replace('竞赛程序、积分和处罚条款', '检索 FIA 全套规则和附录')
    .replace(/<a id="fiaLink"[^>]*>[^<]*<\/a>/, '')
    .replace('placeholder="搜索安全车、轮胎、积分……"', 'placeholder="英文关键词、编号或常用中文术语"')
    .replace(/^.*<label class="news-body-filter".*\n/m, '');
  let routes = replaceOnce(app, 'weekend:"比赛周末",form:', 'weekend:"比赛周末",live:"比赛实况",form:', 'app.js');
  routes = replaceOnce(routes, 'weekend:"race",form:', 'weekend:"race",live:"trackside",form:', 'app.js');
  const routeSetup = '    selectedFromCalendar=undefined;\n';
  routes = replaceOnce(routes, routeSetup, `${routeSetup}    if (previous==="live" && changed) window.F1_LIVE.hide();\n`, 'app.js');
  routes = replaceOnce(routes, '      case "form":', '      case "live":\n        window.F1_LIVE.show();\n        break;\n      case "form":', 'app.js');
  const trackLink = '">查看本站场次</a></div></div>\'';
  routes = replaceOnce(routes, trackLink + ';',
    trackLink + ' + window.F1_CIRCUIT_SECTORS.render(k,{diagram:true});', 'app.js');
  routes = routes.replaceAll('规则速查', '规则查询');
  const ruleStart = routes.indexOf('  function drawRules(');
  const ruleEnd = routes.indexOf('\n  const newsReports=', ruleStart);
  if (ruleStart < 0 || ruleEnd < 0) throw new Error('Rules integration point unavailable');
  routes = routes.slice(0, ruleStart) + '  function drawRules() { window.F1_REGULATIONS.open(); }\n' + routes.slice(ruleEnd);
  routes = routes.replace('  qs("#ruleFilter").addEventListener("input",()=>drawRules());', '')
    .replace('  qs("#fiaLink").href=content.fia;', '');
  const localeAnchor = '比赛周末|Race Weekend\n';
  const labels = replaceOnce(locale, localeAnchor, localeAnchor + translations, 'locale.js').replaceAll('规则速查|', '规则查询|');

  await Promise.all([
    ...[['index.html', html], ['app.js', routes], ['locale.js', labels]].map(([file, content]) => writeFile(join(site, file), content)),
    ...['live.js', 'regulations.js', 'live.css', 'circuit-sectors.js', 'circuit-sectors.css'].map(file => copyFile(join(sources, file), join(site, file))),
    copyFile(join(root, 'home', 'hero.css'), join(site, 'home.css')),
  ]);
}

async function previousSnapshot() {
  try {
    return JSON.parse(await readFile(join(cacheDir, 'snapshots.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Live snapshot cache unavailable: ${error.message}`);
    return {};
  }
}

async function versionAssets() {
  const index = join(site, 'index.html');
  let page = await readText(index);
  for (const file of ['live.css', 'circuit-sectors.css', 'home.css', 'content-data.js', 'circuit-sectors.js', 'live.js', 'regulations.js', 'locale.js', 'video.js', 'app.js']) {
    const content = await readFile(join(site, file));
    if (file.endsWith('.js')) new Script(content.toString('utf8'), { filename: file });
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    page = replaceOnce(page, `"./${file}"`, `"./${file}?v=${hash}"`, 'index.html');
  }
  await writeFile(index, page);
}

async function buildSnapshots(newsFeed) {
  const previous = await previousSnapshot();
  const bundled = mirrorCalendar(await readText(join(site, 'data.js')));
  const year = new Date(now).getUTCFullYear();
  const years = new Date(now).getUTCMonth() < 2 ? [year, year - 1] : [year];
  const online = (await Promise.all(years.map(async value => {
    try { return await openCalendar(value); }
    catch (error) { console.warn(`OpenF1 calendar ${value}: ${error.message}`); return []; }
  }))).flat();
  const coveredYears = new Set(online.map(session => new Date(session.startsAt).getUTCFullYear()));
  const schedule = [...online, ...bundled.filter(session => !coveredYears.has(new Date(session.startsAt).getUTCFullYear()))].sort(order);

  const stored = new Map(Object.entries(previous.archives ?? {}));
  const knownSessions = new Map([...stored].map(([key, details]) => [key, details.session]));
  for (const session of online) knownSessions.set(session.key, session);
  const candidates = [...knownSessions.values()]
    .filter(session => /^\d{1,8}$/.test(session.key) && session.endsAt + archiveDelay <= now).sort(order).slice(0, 10);
  const onlineKeys = new Set(online.map(session => session.key));
  const toFetch = candidates.filter(session => {
    const saved = stored.get(session.key);
    return onlineKeys.has(session.key) && (!saved?.complete || saved.version !== dashboardArchiveVersion);
  }).slice(0, 4);
  for (const session of toFetch) {
    try {
      const details = await archiveDetails(session);
      const older = stored.get(session.key);
      if (details.complete || (!older && (details.rows.length || details.events.length || details.radio.length))) {
        stored.set(session.key, details);
      }
    } catch (error) {
      console.warn(`Archive ${session.key} unavailable: ${error.message}`);
    }
  }
  const archives = candidates.filter(session => stored.has(session.key));

  const context = schedule.find(session => session.startsAt <= now) ?? archives[0];
  const current = now < context?.endsAt + archiveDelay ? context : null;
  const clips = current ? await activeRadio(current) : [];
  await Promise.all(archives.map(async session => {
    const details = stored.get(session.key);
    if (!details.radio?.length || now - details.radioArchiveCheckedAt < 12 * 3600_000) return;
    details.radio = await withArchiveAudio(session, details.radio);
    details.radioArchiveCheckedAt = now;
  }));
  const radio = await populateRadioText({ clips: [...clips, ...archives.flatMap(session => stored.get(session.key).radio || [])], cacheDir, root });
  for (const session of archives) {
    const details = stored.get(session.key);
    details.radio = (details.radio || []).map(radio);
  }
  const [news, bulletins] = await Promise.all([
    liveNews(context, now, newsFeed).then(feed => translateLiveHeadlines(feed, cacheDir)),
    fiaBulletins(context, schedule),
  ]);
  const sameContext = context?.startsAt === previous.contextStartsAt;
  const index = {
    generatedAt: now, schedule, archives, activeRadio: current && { session: current, clips: clips.map(radio) }, contextStartsAt: context?.startsAt,
    news: sameContext && news.scope === 'unavailable' ? previous.news ?? news : news,
    bulletins: sameContext && bulletins.unavailable ? previous.bulletins ?? bulletins : bulletins,
  };
  await Promise.all([mkdir(snapshots, { recursive: true }), mkdir(cacheDir, { recursive: true })]);
  await Promise.all(archives.map(async session => {
    const [news, bulletins] = await Promise.all([liveNews(session, now, newsFeed), fiaBulletins(session, schedule)]);
    await writeJson(join(snapshots, `${session.key}.json`), { details: stored.get(session.key), news, bulletins });
  }));
  await writeJson(join(snapshots, 'index.json'), index);
  const latest = Object.fromEntries(archives.map(session => [session.key, stored.get(session.key)]));
  await writeJson(join(cacheDir, 'snapshots.json'), { ...index, archives: latest });
  console.log(`Live centre ready: ${schedule.length} calendar entries, ${archives.length} archives, ${index.news.items.length} news items.`);
}

await installDashboard();
const [newsFeed] = await Promise.all([
  installContent({ root, site, cacheDir, replaceOnce }),
  regulations(site, cacheDir, new Date(now).getUTCFullYear()),
  installPdfReader(site, cacheDir),
]);
await versionAssets();
await buildSnapshots(newsFeed);
