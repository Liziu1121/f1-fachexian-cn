(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const page = byId('live');
  const screen = byId('liveScreen');
  const fullscreen = byId('liveFullscreen');
  const audio = byId('liveAudio');
  const refreshButton = byId('liveRefresh');
  const timingFrame = byId('liveTimingFrame');
  const statusFrame = byId('liveStatusFrame');
  const driverFrame = byId('liveDriverFrame');
  const controlFrame = byId('liveControlFrame');
  const map = byId('liveTrackLayout');
  const mapOpen = byId('liveMapOpen');
  const mapDialog = byId('liveMapDialog');
  const mapViewer = byId('liveMapViewer');
  const zoomImage = byId('liveMapZoomImage');
  let mapZoom = 1;
  let mapDrag;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width) driverFrame.style.zoom = String(Math.min(entry.contentRect.width, 330) / 360);
  }).observe(byId('liveDriverWindow'));
  const content = window.F1_CONTENT;
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const officialHosts = new Set(['livetiming.formula1.com', 'www.formula1.com', 'www.skysports.com', 'www.motorsport.com', 'www.autosport.com', 'www.fia.com', 'f1archive.org']);
  const cachedMarkup = new WeakMap();
  const sessionNames = new Map([
    ['Practice 1', '一练'], ['Practice 2', '二练'], ['Practice 3', '三练'], ['Qualifying', '排位赛'],
    ['Sprint Qualifying', '冲刺排位赛'], ['Sprint Shootout', '冲刺排位赛'], ['Sprint', '冲刺赛'], ['Race', '正赛'],
  ]);
  const states = {
    live: '赛中实况', settling: '赛况确认中', recent: '最近一场 · 已结束',
    waiting: '等待开赛', unavailable: '计时源暂不可用',
  };
  const english = () => window.F1_LOCALE.english();
  let visible = false;
  let timer;
  let request;
  let snapshot;
  let recording;
  let driverFocus;
  let timelineFilter = 'all';
  let galleryCourse, galleryIndex = 0, galleryTimer, countdownTimer;
  let galleryPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let compareRequest, compareDetails;
  const comparison = new Map();
  const language = (zh, en) => english() ? en : zh;
  const archiveDelay = 30 * 60_000;
  const compounds = { SOFT: ['S', '软胎'], MEDIUM: ['M', '中性胎'], HARD: ['H', '硬胎'], INTERMEDIATE: ['I', '半雨胎'], WET: ['W', '全雨胎'] };

  function setMarkup(id, value) {
    const node = byId(id);
    if (cachedMarkup.get(node) === value) return;
    node.innerHTML = value;
    cachedMarkup.set(node, value);
  }

  function setText(id, value) {
    const node = byId(id);
    if (cachedMarkup.get(node) === value) return;
    node.textContent = value;
    cachedMarkup.set(node, value);
  }

  const empty = text => `<p class="live-empty sub">${html(text)}</p>`;
  const formatDate = (date, options) => new Intl.DateTimeFormat(english() ? 'en-GB' : 'zh-CN', {
    timeZone: 'Asia/Shanghai', hourCycle: 'h23', ...options,
  }).format(date);
  const dateTime = date => formatDate(date, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const clock = date => formatDate(date, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const timingLabel = (number, i) => number == null ? '—' : `+${number.toFixed(i)}s`;

  function link(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && officialHosts.has(url.hostname)) return url.href;
    } catch { /* invalid source link */ }
    return '';
  }

  function sessionCircuit(session) {
    return session && Object.entries(window.F1_DATA.races).find(([, race]) => Object.values(race.sessions).some(
      stamp => Math.abs(Date.parse(stamp) - session.startsAt) <= 15 * 60_000));
  }

  function sessionLabel(session) {
    const known = sessionCircuit(session);
    const name = !english() && known ? content.circuit[known[0]][0] : session.location || session.circuit || session.country;
    return [name, english() ? session.name : sessionNames.get(session.name) || session.name].filter(Boolean).join(' · ');
  }

  function driverName(driver) {
    const local = !english() && content.drivers[driver.code];
    return local || driver.name || driver.code || `#${driver.number}`;
  }

  function teamName(name) {
    if (!name) return '';
    return english() ? name : content.teamAliases.find(([key]) => name.startsWith(key))?.[1] || name;
  }

  function lapTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 60000)}:${(ms % 60000 / 1000).toFixed(3).padStart(6, '0')}`;
  }

  function gap(value) {
    if (typeof value === 'number') return timingLabel(value, 3);
    if (typeof value === 'string' && value) return english() ? value : value.replace(/\bLAPS?\b/i, '圈');
    return '—';
  }

  function tyre(stint) {
    const compound = stint?.compound;
    if (!Object.hasOwn(compounds, compound)) return '—';
    const [symbol, chinese] = compounds[compound];
    const label = english() ? compound : chinese;
    return `<span class="live-tyre" data-tyre="${compound}" aria-label="${label}" title="${label}">${symbol}</span>`;
  }

  function tyreAge(stint) {
    if (![stint?.ageAtStart, stint?.start, stint?.end].every(Number.isInteger) || stint.end < stint.start) return '—';
    return stint.ageAtStart + stint.end - stint.start + 1;
  }

  const measurement = (value, unit, digits = 0) => Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : '—';

  function bestRow(rows) {
    return rows.filter(row => Number.isFinite(row.best) && row.best > 0)
      .reduce((fastest, row) => !fastest || row.best < fastest.best ? row : fastest, null);
  }

  function metric(label, value, note = '') {
    return `<div><dt>${html(label)}</dt><dd>${html(value)}${note ? `<small>${html(note)}</small>` : ''}</dd></div>`;
  }

  function drawMetrics(details) {
    const rows = details?.rows ?? [];
    const weather = details?.weather;
    const leader = rows.find(row => row.position === 1 && !row.finish);
    const fastest = bestRow(rows);
    const items = [];
    if (leader) items.push(metric('排名第一', leader.driver.code ?? driverName(leader.driver), rows.length + ' 位车手'));
    if (fastest) items.push(metric('最快圈', lapTime(fastest.best), fastest.driver.code));
    if (weather) {
      const conditions = weather.rain === 1 ? '有降雨' : weather.rain === 0 ? '无降雨' : '';
      items.push(metric('赛道温度', measurement(weather.track, '°C', 1), conditions));
      items.push(metric('气温', measurement(weather.air, '°C', 1)));
      items.push(metric('湿度', measurement(weather.humidity, '%', 1)));
      items.push(metric('风速', measurement(weather.wind, 'm/s', 1)));
    }
    setMarkup('liveMetrics', items.join(''));
    byId('liveMetrics').hidden = !items.length;
  }

  function controlText(value) {
    if (english()) return value;
    const sector = value.match(/^(DOUBLE YELLOW|YELLOW|RED|GREEN) IN TRACK SECTOR (\d+)$/);
    const flags = { 'DOUBLE YELLOW': '双黄旗', YELLOW: '赛道黄旗', RED: '赛道红旗', GREEN: '赛道绿旗' };
    if (sector) return `${flags[sector[1]]} · 第 ${sector[2]} 区段`;
    return {
      'SESSION STARTED': '场次进行中', 'SESSION FINISHED': '场次结束', 'SESSION ABORTED': '场次暂停',
      'SAFETY CAR DEPLOYED': '安全车出动', 'VIRTUAL SAFETY CAR DEPLOYED': '虚拟安全车',
      'SAFETY CAR IN THIS LAP': '安全车本圈进站', 'VIRTUAL SAFETY CAR ENDING': '虚拟安全车即将结束',
      'PIT EXIT OPEN': '维修区出口开放', 'PIT EXIT CLOSED': '维修区出口关闭', 'DRS ENABLED': 'DRS 已启用', 'DRS DISABLED': 'DRS 已关闭',
      'GREEN': '赛道绿旗', 'YELLOW': '赛道黄旗', 'RED': '赛道红旗', 'CHEQUERED': '方格旗',
    }[value] ?? value;
  }

  function split(sector) {
    if (!Number.isFinite(sector?.time) || sector.time <= 0) return '<td class="live-split">—</td>';
    const segments = (sector.segments ?? []).map(value =>
      `<i data-segment="${Number.isInteger(value) ? value : 0}"></i>`).join('');
    return `<td class="live-split"><strong>${sector.time.toFixed(3)}</strong>${segments ? `<span class="live-mini" aria-hidden="true">${segments}</span>` : ''}</td>`;
  }

  function drawTiming(details, mode) {
    byId('liveSectorKey').hidden = !details?.rows.some(row => row.measuredLap?.sectors.some(sector => sector.segments.some(Boolean)));
    setText('liveTimingCaption', details?.rows.length ? '所列分段取自最快计时圈' : mode === 'live' || mode === 'settling' ? '实时计时与分段' : '');
    if (!details?.rows.length) {
      const status = mode === 'recent' ? '最近场次的计时快照正在同步。' : '暂无计时数据';
      return setMarkup('liveTiming', empty(status));
    }
    const race = details.session.type === 'Race';
    const fastest = bestRow(details.rows);
    const rows = details.rows.map(row => {
      const driver = row.driver;
      const color = /^#[\da-f]{6}$/i.test(driver.color) ? ` style="--team-color:${driver.color}"` : '';
      const active = driver.number === driverFocus;
      const label = driverName(driver);
      const button = `<button class="live-driver-button" type="button"${color} data-live-driver="${html(driver.number)}" aria-pressed="${active}" aria-label="${html(label)}" title="${html(label)}">${html(driver.code || label)}</button>`;
      const sectors = [0, 1, 2].map(i => split(row.measuredLap?.sectors[i])).join('');
      const stint = row.tyreStints?.at(-1);
      const age = tyreAge(stint);
      return `<tr${active ? ' data-focus-driver' : ''}><td>${html(row.finish ?? row.position ?? '—')}</td><th scope="row">${button}</th>` +
        `<td>${html(gap(row.gap))}</td>${race ? `<td>${html(gap(row.interval))}</td>` : ''}<td>${lapTime(row.last)}</td>` +
        `<td${row === fastest ? ' class="live-fastest"' : ''}>${lapTime(row.best)}</td>${sectors}` +
        `<td>${tyre(stint)}${stint && age !== '—' ? ` ${age}` : ''}</td><td>${html(row.pitCount ?? '—')}</td><td>${html(row.laps ?? '—')}</td></tr>`;
    }).join('');
    setMarkup('liveTiming', `<table class="live-table"><thead><tr><th scope="col">排名</th><th scope="col">车手</th>` +
      `<th scope="col">领先差</th>${race ? '<th scope="col">距前车</th>' : ''}<th scope="col">上一圈</th><th scope="col">最快圈</th>` +
      `<th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th><th scope="col">轮胎</th><th scope="col">进站</th><th scope="col">圈数</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function drawDriver(details, isLive) {
    byId('liveDriverWindow').hidden = !isLive;
    byId('liveDriverDetail').hidden = isLive;
    showFrame(driverFrame, isLive);
    const row = details?.rows.find(entry => entry.driver.number === driverFocus);
    setText('liveDriverCode', isLive ? '领先车手' : row?.driver.code ?? '');
    if (!row) return setMarkup('liveDriverDetail', empty('暂无车手分段和策略数据'));
    const { driver } = row;
    const stints = (row.tyreStints ?? []).filter(stint => Number.isInteger(stint.start) && Number.isInteger(stint.end));
    const lap = row.measuredLap;
    const measured = Number.isInteger(lap?.number) ? `L${lap.number}` : '';
    let stats = metric('最快圈', lapTime(row.best)) + metric('最快圈测速点', measurement(lap?.speed, 'km/h'), measured) +
      metric('轮胎使用圈数', String(tyreAge(stints.at(-1)))) + metric('进站次数', String(row.pitCount ?? '—'));
    if (Number.isInteger(row.lastPit?.lap)) stats += metric('最近进站', `L${row.lastPit.lap}`);
    if (Number.isFinite(row.lastPit?.stop)) stats += metric('停站用时', measurement(row.lastPit.stop, 's', 2));
    const strategy = stints.map(stint => `<li>${tyre(stint)}<span>L${stint.start}–${stint.end}</span></li>`).join('');
    setMarkup('liveDriverDetail', `<div class="live-driver-name"><strong>${html(driverName(driver))}</strong><small>${html(teamName(driver.team))}</small></div>` +
      `<dl class="live-driver-stats">${stats}</dl>${strategy ? `<p class="live-strategy-label">轮胎策略</p><ul class="live-strategy">${strategy}</ul>` : ''}`);
  }

  function upcomingRound(now = Date.now()) {
    return Object.entries(window.F1_DATA.races).map(([course, race]) => {
      const starts = Object.entries(race.sessions).filter(([key]) => key !== 'grid')
        .map(([, stamp]) => Date.parse(stamp)).filter(Number.isFinite).sort((a, b) => a - b);
      return { course, start: starts.find(stamp => stamp > now), race: Date.parse(race.sessions.race) };
    }).filter(round => round.race > now && round.start).sort((a, b) => a.start - b.start)[0];
  }

  function setGalleryControls(available) {
    byId('liveGalleryPrevious').disabled = available < 2;
    byId('liveGalleryNext').disabled = available < 2;
    const pause = byId('liveGalleryPause');
    pause.disabled = available < 2;
    pause.setAttribute('aria-pressed', String(galleryPaused));
    setText('liveGalleryPause', galleryPaused ? '继续播放' : '暂停播放');
  }

  function displayGallery(step = 0) {
    const gallery = byId('liveGallery');
    if (!visible || gallery.hidden || document.hidden) return;
    const photos = window.F1_CONTENT_EXTRAS.galleries?.[galleryCourse] ?? [];
    setGalleryControls(photos.length);
    if (!photos.length) return;
    galleryIndex = (galleryIndex + step + photos.length) % photos.length;
    const { image, source } = photos[galleryIndex];
    const picture = byId('liveGalleryImage');
    picture.hidden = false;
    if (picture.getAttribute('src') !== image) picture.src = image;
    byId('liveGallerySource').href = source;
    setText('liveGalleryNumber', `${galleryIndex + 1} / ${photos.length}`);
  }

  function updateCountdown() {
    const count = byId('liveGalleryCountdown');
    if (!visible || byId('liveGallery').hidden) return;
    const round = upcomingRound();
    if (!round) return setText(count.id, '下一站赛程待公布');
    const minutes = Math.max(0, Math.ceil((round.start - Date.now()) / 60_000));
    const name = content.circuit[round.course]?.[english() ? 1 : 0] || round.course;
    setText(count.id, language(
      `距下一站赛事 · ${name} · ${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes / 60) % 24} 小时 ${minutes % 60} 分钟`,
      `Next round · ${name} · ${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`));
  }

  function drawGallery(mode, session) {
    const gallery = byId('liveGallery');
    const course = upcomingRound()?.course || sessionCircuit(session)?.[0];
    const shown = ['recent', 'waiting', 'settling', 'unavailable'].includes(mode);
    gallery.hidden = !shown || !course || !window.F1_CONTENT_EXTRAS.galleries?.[course]?.length;
    if (gallery.hidden) return;
    if (galleryCourse !== course) { galleryCourse = course; galleryIndex = 0; }
    setText('liveGalleryTitle', content.circuit[course]?.[english() ? 1 : 0] || course);
    displayGallery();
    updateCountdown();
  }

  for (const [id, step] of [['liveGalleryPrevious', -1], ['liveGalleryNext', 1]]) {
    byId(id).addEventListener('click', () => displayGallery(step));
  }
  byId('liveGalleryPause').addEventListener('click', () => {
    galleryPaused = !galleryPaused;
    displayGallery();
  });
  byId('liveGalleryImage').addEventListener('error', event => { event.target.hidden = true; });

  function rowTable(first, second) {
    const entries = [
      ['排名', 'Position', row => row.finish || row.position],
      ['圈数', 'Laps', row => row.laps],
      ['最快圈', 'Best lap', row => lapTime(row.best)],
      ['上一圈', 'Last lap', row => lapTime(row.last)],
      ['领先差', 'Gap to leader', row => gap(row.gap)],
      ...[0, 1, 2].map(i => [`S${i + 1}`, `S${i + 1}`, row => measurement(row.measuredLap?.sectors[i]?.time, 's', 3)]),
      ['最快圈测速点', 'Speed trap on best lap', row => measurement(row.measuredLap?.speed, 'km/h')],
      ['进站次数', 'Pit stops', row => row.pitCount],
      ['轮胎策略', 'Tyre strategy', row => row.tyreStints?.map(stint => `${stint.compound} L${stint.start}–${stint.end}`).join(' · ') || '—'],
    ];
    return `<table class="live-compare-table"><thead><tr><th scope="col">${language('项目', 'Metric')}</th>${[first, second].map(row =>
      `<th scope="col">${html(driverName(row.driver))}</th>`).join('')}</tr></thead><tbody>${entries.map(([zh, en, value]) =>
      `<tr><th scope="row">${language(zh, en)}</th><td>${html(value(first) ?? '—')}</td><td>${html(value(second) ?? '—')}</td></tr>`).join('')}</tbody></table>`;
  }

  function setOptions(select, options, preferred) {
    const old = select.value || String(preferred ?? '');
    const markup = options.map(([value, label]) => `<option value="${html(value)}">${html(label)}</option>`).join('');
    if (cachedMarkup.get(select) === markup) return;
    select.innerHTML = markup;
    cachedMarkup.set(select, markup);
    if (options.some(([value]) => String(value) === old)) select.value = old;
  }

  function drawComparisonRows() {
    const rows = compareDetails?.rows || [];
    const first = byId('liveCompareFirst'), second = byId('liveCompareSecond');
    const options = rows.map(row => [row.driver.number, driverName(row.driver)]);
    setOptions(first, options, options[0]?.[0]);
    setOptions(second, options, options[1]?.[0]);
    first.disabled = second.disabled = rows.length < 2;
    if (first.value === second.value && rows.length > 1) second.value = options.find(([value]) => String(value) !== first.value)[0];
    for (const option of second.options) option.disabled = option.value === first.value;
    const selected = [first, second].map(select => rows.find(row => String(row.driver.number) === select.value));
    setMarkup('liveCompareResult', selected.every(Boolean) ?
      rowTable(...selected) : empty(language('该场次暂无足够的车手数据。', 'This session has insufficient data for comparison.')));
  }

  async function drawComparison(view) {
    const selector = byId('liveCompareSession');
    const sessions = view?.index?.archives || [];
    setOptions(selector, sessions.map(session => [session.key, sessionLabel(session)]), view?.session?.key);
    selector.disabled = !sessions.length;
    const key = selector.value;
    if (!key) { compareDetails = null; drawComparisonRows(); return; }
    if (view?.details?.session.key === key) comparison.set(key, view.details);
    if (comparison.has(key)) { compareDetails = comparison.get(key); drawComparisonRows(); return; }
    if (compareRequest === key) return;
    compareRequest = key;
    setMarkup('liveCompareResult', empty(language('正在读取场次数据…', 'Loading session data…')));
    try {
      const data = await readSnapshot(key, AbortSignal.timeout(8000));
      if (data.details?.session.key === key) comparison.set(key, data.details);
    } catch { /* A later refresh can retry. */ }
    if (compareRequest === key) compareRequest = null;
    if (selector.value === key) { compareDetails = comparison.get(key); drawComparisonRows(); }
  }
  byId('liveCompareSession').addEventListener('change', () => drawComparison(snapshot));
  byId('liveCompareFirst').addEventListener('change', drawComparisonRows);
  byId('liveCompareSecond').addEventListener('change', drawComparisonRows);

  const radioClips = view => view?.details?.radio ?? view?.radio ?? [];
  function radioTranscript(clip) {
    const transcript = clip?.transcript;
    if (!transcript?.text) return language('转写暂不可用', 'Transcript unavailable');
    const translated = !english() && transcript.language !== 'zh';
    const name = new Intl.DisplayNames([english() ? 'en' : 'zh-CN'], { type: 'language', fallback: 'code' }).of(transcript.language);
    if (translated && !transcript.zh) return `${name} · ${transcript.text}（中文译文暂不可用）`;
    return `${name} · ${translated ? transcript.zh : transcript.text}`;
  }

  function drawTimeline(details, isLive) {
    const events = (details?.events ?? []).map(item => ({ ...item, kind: 'control' }));
    const clips = radioClips(snapshot).filter(clip => link(clip.url)).map(item => ({ ...item, kind: 'radio' }));
    const shown = [...events, ...clips].filter(item => timelineFilter === 'all' || item.kind === timelineFilter).sort((a, b) => b.date - a.date);
    const showPublic = isLive && timelineFilter !== 'radio';
    showFrame(controlFrame, showPublic);
    byId('livePublicControl').hidden = !showPublic;
    setText('liveTimelineCount', shown.length ? `${shown.length} 条` : '');
    if (!shown.length) {
      const radioNotice = isLive ? '本场电台与文字转写的入口见底部备注。'
        : details && !details.radioAvailable ? '电台数据暂不可用' : '暂无已发布的电台录音';
      const controlNotice = details && !details.controlAvailable ? '赛会消息暂不可用' : '暂无赛会消息';
      return setMarkup('liveTimeline', timelineFilter === 'control' && showPublic ? '' : empty(timelineFilter === 'control' ? controlNotice : radioNotice));
    }
    const list = shown.map(item => {
      const radio = item.kind === 'radio';
      const flag = ['RED', 'GREEN', 'YELLOW', 'DOUBLE YELLOW', 'CHEQUERED'].includes(item.flag) ? item.flag : '';
      const heading = radio ? '车队电台' : flag ? '旗况' : '赛会消息';
      const body = radio ? `<p>${html(driverName(item.driver))}</p><small>${html(teamName(item.driver.team))}</small>` +
        `<button type="button" class="action outline live-play" data-recording="${html(item.url)}" aria-label="播放车队电台 · ${html(driverName(item.driver))}">播放</button>` +
        `<p class="live-radio-text">${html(radioTranscript(item))}</p>`
        : `<p>${html(controlText(item.message))}</p>${item.lap ? `<small>L${html(item.lap)}</small>` : ''}`;
      return `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><article>` +
        `<span class="live-feed-tag" data-kind="${item.kind}"${flag ? ` data-flag="${flag}"` : ''}>${heading}</span>${body}</article></li>`;
    }).join('');
    setMarkup('liveTimeline', `<ul class="live-feed">${list}</ul>`);
  }

  function drawBulletins(news, bulletins) {
    const items = news?.items?.filter(item => link(item.url)) ?? [];
    setMarkup('liveHeadlines', items.length ? `<ul class="live-feed live-articles">${items.map(item => {
      const translated = !english() && item.titleZh;
      return `<li><div><a href="${html(item.url)}" target="_blank" rel="noopener" lang="${translated ? 'zh-CN' : 'en'}">${html(translated || item.title)}</a><small>${html(item.source)} · <time datetime="${new Date(item.date).toISOString()}">${dateTime(item.date)}</time></small></div></li>`;
    }).join('')}</ul>` : empty(news?.scope === 'unavailable' ? '新闻来源暂不可用' : '暂无最新报道'));
    const scope = items.length ? news.scope === 'session' ? '本站相关报道' : '近期 F1 报道' : '';
    setText('liveNewsScope', scope);
    byId('liveNewsScope').hidden = !scope;

    const coverage = link(news?.coverage);
    byId('liveOfficialCoverage').href = coverage || 'https://www.formula1.com/en/latest';
    setText('liveOfficialCoverage', coverage ? 'F1 官方赛况报道' : 'F1 官方新闻');

    const fia = (bulletins?.items ?? []).filter(item => link(item.url));
    byId('liveFiaSource').href = link(bulletins?.source) || 'https://www.fia.com/documents/formula-1';
    setMarkup('liveBulletins', fia.length ? `<ul class="live-feed live-articles">${fia.map(item =>
      `<li><div><a href="${html(item.url)}" target="_blank" rel="noopener" lang="en">${html(item.title)}</a><small><time datetime="${new Date(item.date).toISOString()}">${dateTime(item.date)}</time></small></div></li>`).join('')}</ul>`
      : empty(bulletins?.unavailable ? 'FIA 公告暂不可用' : '暂无本站公告'));
  }

  function showFrame(frame, open) {
    if (open && !frame.hasAttribute('src')) frame.src = frame.dataset.src;
    if (!open && frame.hasAttribute('src')) frame.removeAttribute('src');
  }

  function drawLiveFrames(isLive) {
    byId('livePublicTiming').hidden = !isLive;
    byId('liveTiming').hidden = isLive;
    byId('livePublicStatus').hidden = !isLive;
    showFrame(timingFrame, isLive);
    showFrame(statusFrame, isLive);
  }

  function resizeMap(zoom = mapZoom, keepCenter = true) {
    if (!mapDialog.open || !zoomImage.naturalWidth) return;
    const width = mapViewer.clientWidth;
    const height = mapViewer.clientHeight;
    if (!width || !height) return;
    const viewport = mapViewer.getBoundingClientRect();
    const image = zoomImage.getBoundingClientRect();
    const centerX = (viewport.left + width / 2 - image.left) / (image.width || 1);
    const centerY = (viewport.top + height / 2 - image.top) / (image.height || 1);
    const fit = Math.min((width - 32) / zoomImage.naturalWidth, (height - 32) / zoomImage.naturalHeight, 1);
    mapZoom = Math.max(1, Math.min(4, zoom));
    zoomImage.style.width = `${Math.round(zoomImage.naturalWidth * fit * mapZoom)}px`;
    zoomImage.style.height = `${Math.round(zoomImage.naturalHeight * fit * mapZoom)}px`;
    mapViewer.scrollLeft = keepCenter ? centerX * zoomImage.width - width / 2 : 0;
    mapViewer.scrollTop = keepCenter ? centerY * zoomImage.height - height / 2 : 0;
    byId('liveMapZoomLevel').textContent = `${Math.round(mapZoom * 100)}%`;
    byId('liveMapZoomOut').disabled = mapZoom <= 1;
    byId('liveMapZoomIn').disabled = mapZoom >= 4;
  }

  new ResizeObserver(() => resizeMap()).observe(mapViewer);
  zoomImage.addEventListener('load', () => resizeMap(1, false));
  mapOpen.addEventListener('click', () => {
    if (!map.getAttribute('src') || !map.naturalWidth) return;
    zoomImage.src = map.src;
    zoomImage.alt = map.alt;
    mapDialog.showModal();
    resizeMap(1, false);
  });
  byId('liveMapClose').addEventListener('click', () => mapDialog.close());
  byId('liveMapZoomIn').addEventListener('click', () => resizeMap(mapZoom + .5));
  byId('liveMapZoomOut').addEventListener('click', () => resizeMap(mapZoom - .5));
  byId('liveMapFit').addEventListener('click', () => resizeMap(1, false));
  mapDialog.addEventListener('click', event => { if (event.target === mapDialog) mapDialog.close(); });
  mapViewer.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    mapDrag = { x: event.clientX, y: event.clientY, left: mapViewer.scrollLeft, top: mapViewer.scrollTop };
    mapViewer.setPointerCapture(event.pointerId);
    mapViewer.setAttribute('data-dragging', '');
    event.preventDefault();
  });
  mapViewer.addEventListener('pointermove', event => {
    if (!mapDrag) return;
    mapViewer.scrollLeft = mapDrag.left + mapDrag.x - event.clientX;
    mapViewer.scrollTop = mapDrag.top + mapDrag.y - event.clientY;
  });
  function stopMapDrag() {
    mapDrag = null;
    mapViewer.removeAttribute('data-dragging');
  }
  mapViewer.addEventListener('pointerup', stopMapDrag);
  mapViewer.addEventListener('pointercancel', stopMapDrag);
  mapDialog.addEventListener('close', stopMapDrag);
  map.addEventListener('load', () => {
    map.hidden = false;
    mapOpen.disabled = false;
    byId('liveMapStatus').hidden = true;
  });
  map.addEventListener('error', () => {
    mapOpen.hidden = true;
    map.removeAttribute('src');
    byId('liveMapStatus').hidden = false;
    setText('liveMapStatus', '官方赛道图暂不可用');
  });

  function drawMap(session) {
    const course = sessionCircuit(session)?.[0];
    const season = new Date(session?.startsAt).getUTCFullYear();
    const sectors = season === 2026 ? window.F1_CIRCUIT_SECTORS.render(course) : '';
    setMarkup('liveCircuitSectors', sectors);
    byId('liveCircuitSectors').hidden = !sectors;
    const code = course && content.circuit[course]?.[3];
    const url = code ? `https://media.formula1.com/image/upload/c_fit,w_2400/q_auto/common/f1/${season}/track/${season}track${code}detailed.webp` : '';
    setText('liveMapCaption', url ? 'F1 官方赛道图' : '');
    if (url) {
      map.alt = `${sessionLabel(session)} · ${english() ? 'F1 official circuit map' : 'F1 官方赛道图'}`;
      setText('liveMapDialogTitle', map.alt);
      zoomImage.alt = map.alt;
    }
    if (url && map.getAttribute('src') !== url) {
      map.hidden = true;
      mapOpen.hidden = false;
      mapOpen.disabled = true;
      byId('liveMapOriginal').href = url;
      byId('liveMapStatus').hidden = false;
      setText('liveMapStatus', '正在加载官方赛道图');
      map.src = url;
      if (mapDialog.open) zoomImage.src = url;
    } else if (!url) {
      mapOpen.hidden = true;
      map.removeAttribute('src');
      byId('liveMapOriginal').removeAttribute('href');
      if (mapDialog.open) mapDialog.close();
      byId('liveMapStatus').hidden = false;
      setText('liveMapStatus', session ? '官方赛道图暂不可用' : '等待赛道地图');
    }
  }

  function indexNextSession() {
    return snapshot?.index?.schedule.findLast(session => session.startsAt > Date.now());
  }

  function draw() {
    const { session, mode, details, news, bulletins, generatedAt, scheduleUnavailable, archiveUnavailable } = snapshot ?? {};
    const isLive = mode === 'live' || mode === 'settling';
    drawLiveFrames(isLive);
    drawGallery(mode, session);
    drawMap(isLive ? session : indexNextSession() ?? session);
    byId('liveQualifyingDetails').hidden = !isLive || !/qualifying|shootout/i.test(session.name);
    setText('liveState', states[mode] ?? '正在读取实况');
    byId('liveState').dataset.state = mode ?? 'loading';
    setText('liveRound', session ? sessionLabel(session) : '计时与赛况');
    setText('liveSchedule', session ? `计划开赛 · ${dateTime(session.startsAt)} · 北京时区` : '');
    setText('liveMeta', details?.updatedAt ? `数据更新 ${dateTime(details.updatedAt)} · 北京时区` : '');
    const notice = scheduleUnavailable && session ? '赛程更新暂不可用，按上次加载的赛程显示。'
      : archiveUnavailable && details ? '快照更新暂不可用，已保留本场上次加载的赛况。' : '';
    setText('liveNotice', notice);
    byId('liveNotice').hidden = !notice;

    if (!details?.rows.some(row => row.driver.number === driverFocus)) driverFocus = details?.rows[0]?.driver.number;
    drawMetrics(details);
    drawTiming(details, mode);
    drawDriver(details, isLive);
    drawTimeline(details, isLive);
    drawBulletins(news, bulletins);
    drawComparison(snapshot);
    const timestamp = byId('liveSnapshotAt');
    timestamp.hidden = !news?.items?.length || !Number.isFinite(generatedAt);
    if (!timestamp.hidden) setText('liveSnapshotAt', `资讯快照发布于 · ${dateTime(generatedAt)} · 北京时区`);
  }

  function stopAudio() {
    audio.pause();
    if (recording) {
      audio.removeAttribute('src');
      audio.load();
      recording = null;
    }
    byId('livePlayer').hidden = true;
  }

  function showAudioFailure() {
    if (!recording || byId('livePlayer').hidden) return;
    setText('liveAudioStatus', '这段录音暂时无法播放。');
    byId('liveAudioStatus').hidden = false;
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (visible && !document.hidden) timer = setTimeout(refresh, ms);
  }

  async function readSnapshot(path, signal) {
    const response = await fetch(`./api/live/${path}.json`, { signal, cache: 'no-cache' });
    if (!response.ok) throw new Error('Timing data unavailable');
    return response.json();
  }

  function sameSession(first, second) {
    if (!first || !second) return false;
    if (first.key && second.key) return first.key === second.key;
    return first.name === second.name && Math.abs(first.startsAt - second.startsAt) <= 15 * 60_000;
  }

  async function readView(signal) {
    const loaded = await readSnapshot('index', signal).catch(() => null);
    const index = loaded ?? snapshot?.index;
    if (!index) return { mode: 'unavailable', pollMs: 15_000 };

    const now = Date.now();
    const scheduled = index.schedule.find(session => session.startsAt <= now);
    const latestSaved = index.archives.find(session => session.startsAt <= now);
    const session = scheduled ?? latestSaved;
    const next = index.schedule.findLast(session => session.startsAt > now);
    const archive = index.archives.find(candidate => sameSession(candidate, session));
    const liveUntil = session ? session.endsAt + archiveDelay : Infinity;
    let mode = 'waiting';
    if (session) {
      if (archive || now >= liveUntil) mode = 'recent';
      else mode = now < session.endsAt ? 'live' : 'settling';
    }

    const nextChange = mode === 'live' ? session.endsAt : mode === 'settling' ? liveUntil : Infinity;
    const pollMs = Math.max(1_000, Math.min(loaded ? 60_000 : 15_000, (next?.startsAt ?? Infinity) - now, nextChange - now));
    const archivedData = archive ? await readSnapshot(archive.key, signal).catch(() => null) : null;
    const validArchive = sameSession(archivedData?.details?.session, session);
    const lastGood = sameSession(snapshot?.saved?.details?.session, session) ? snapshot.saved : null;
    const saved = mode === 'recent' ? validArchive ? archivedData : lastGood : null;

    const context = [...index.schedule, ...index.archives].find(candidate => candidate.startsAt === index.contextStartsAt);
    const sameContext = sameSession(context, session);
    const sameWeekend = sameContext || (session?.meeting != null && session.meeting === context?.meeting);
    return {
      index, session, mode, saved, details: saved?.details, pollMs,
      radio: sameSession(index.activeRadio?.session, session) ? index.activeRadio.clips : [],
      generatedAt: index.generatedAt,
      scheduleUnavailable: !loaded,
      archiveUnavailable: Boolean(archive && !validArchive),
      news: sameWeekend ? { ...index.news, coverage: sameContext ? index.news?.coverage : undefined } : saved?.news,
      bulletins: sameWeekend ? index.bulletins : saved?.bulletins,
    };
  }

  async function refresh() {
    if (!visible || request || document.hidden) return;
    clearTimeout(timer);
    const pending = new AbortController();
    request = pending;
    refreshButton.setAttribute('aria-busy', 'true');
    let pollMs = 60_000;
    try {
      const view = await readView(AbortSignal.any([pending.signal, AbortSignal.timeout(15_000)]));
      if (request !== pending) return;
      if (!sameSession(snapshot?.session, view.session)) {
        if (recording) stopAudio();
        driverFocus = undefined;
        setTimelineFilter('all');
      }
      snapshot = view;
      pollMs = view.pollMs;
    } catch {
      if (request !== pending) return;
      if (recording) stopAudio();
      snapshot = { mode: 'unavailable' };
      pollMs = 15_000;
    } finally {
      if (request === pending) {
        request = null;
        refreshButton.removeAttribute('aria-busy');
        draw();
        schedule(pollMs);
      }
    }
  }

  function hide() {
    visible = false;
    clearInterval(galleryTimer);
    clearInterval(countdownTimer);
    clearTimeout(timer);
    request?.abort();
    request = null;
    refreshButton.removeAttribute('aria-busy');
    drawLiveFrames(false);
    if (mapDialog.open) mapDialog.close();
    showFrame(controlFrame, false);
    showFrame(driverFrame, false);
    if (screen.hasAttribute('data-focus')) {
      screen.removeAttribute('data-focus');
      updateFullscreen();
    }
    stopAudio();
  }

  function show() {
    if (visible) return;
    snapshot = null;
    visible = true;
    galleryTimer = setInterval(() => { if (!galleryPaused) displayGallery(1); }, 7000);
    countdownTimer = setInterval(updateCountdown, 1000);
    draw();
    refresh();
  }

  refreshButton.addEventListener('click', refresh);
  function updateFullscreen() {
    const active = document.fullscreenElement === screen || screen.hasAttribute('data-focus');
    fullscreen.setAttribute('aria-pressed', String(active));
    setText('liveFullscreen', active ? '退出全屏' : '全屏显示');
  }
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement === screen) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (!screen.hasAttribute('data-focus') && document.fullscreenEnabled) {
      try {
        await screen.requestFullscreen();
        return;
      } catch { /* Fullscreen can be blocked when the site is embedded. */ }
    }
    screen.toggleAttribute('data-focus');
    updateFullscreen();
  });
  document.addEventListener('fullscreenchange', updateFullscreen);
  document.addEventListener('keydown', event => {
    if (mapDialog.open || event.key !== 'Escape' || !screen.hasAttribute('data-focus')) return;
    screen.removeAttribute('data-focus');
    updateFullscreen();
    fullscreen.focus({ preventScroll: true });
  });
  function setTimelineFilter(filter) {
    timelineFilter = filter;
    page.querySelectorAll('[data-live-filter]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.liveFilter === filter)));
  }
  page.addEventListener('click', event => {
    const filter = event.target.closest('[data-live-filter]');
    if (filter) {
      setTimelineFilter(filter.dataset.liveFilter);
      drawTimeline(snapshot?.details, ['live', 'settling'].includes(snapshot?.mode));
      byId('liveTimeline').scrollTop = 0;
      return;
    }
    const driver = event.target.closest('[data-live-driver]');
    if (driver) {
      driverFocus = Number(driver.dataset.liveDriver);
      byId('liveTiming').querySelectorAll('[data-live-driver]').forEach(button => {
        const selected = button === driver;
        button.setAttribute('aria-pressed', String(selected));
        button.closest('tr').toggleAttribute('data-focus-driver', selected);
      });
      drawDriver(snapshot?.details, false);
      return;
    }
    const play = event.target.closest('[data-recording]');
    if (!play || !link(play.dataset.recording)) return;
    recording = radioClips(snapshot).find(clip => clip.url === play.dataset.recording);
    if (!recording) return;
    setText('liveRecording', [driverName(recording.driver), clock(recording.date), recording.source].filter(Boolean).join(' · '));
    const player = byId('livePlayer');
    setText('liveRadioText', radioTranscript(recording));
    player.hidden = false;
    byId('liveAudioStatus').hidden = true;
    byId('liveRecordingLink').href = recording.originalUrl || recording.url;
    if (audio.src !== recording.url) audio.src = recording.url;
    const selectedRecording = recording;
    audio.play().catch(error => {
      if (error.name !== 'AbortError' && recording === selectedRecording) showAudioFailure();
    });
  });
  audio.addEventListener('error', showAudioFailure);
  audio.addEventListener('playing', () => { byId('liveAudioStatus').hidden = true; });
  document.addEventListener('visibilitychange', () => {
    if (!visible) return;
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  window.addEventListener('f1:language', () => {
    if (visible) draw();
    if (recording) setText('liveRadioText', radioTranscript(recording));
    if (recording) setText('liveRecording', [driverName(recording.driver), clock(recording.date), recording.source].filter(Boolean).join(' · '));
  });

  window.F1_LIVE = { show, hide };
})();
