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
  const mapFrame = byId('liveMapFrame');
  const driverFrame = byId('liveDriverFrame');
  const controlFrame = byId('liveControlFrame');
  const circuitCanvas = byId('liveCircuit');
  const mapSourceSize = 420;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width) mapFrame.style.zoom = String(Math.min(entry.contentRect.width, 330) / mapSourceSize);
  }).observe(byId('liveMapWindow'));
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width) driverFrame.style.zoom = String(Math.min(entry.contentRect.width, 330) / 360);
  }).observe(byId('liveDriverWindow'));
  const content = window.F1_CONTENT;
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const officialHosts = new Set(['livetiming.formula1.com', 'www.formula1.com', 'www.motorsport.com', 'www.autosport.com', 'www.fia.com', 'f1archive.org']);
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
  let circuit;
  let timelineFilter = 'all';
  const archiveDelay = 30 * 60_000;
  const compounds = { SOFT: ['S', '软胎'], MEDIUM: ['M', '中性胎'], HARD: ['H', '硬胎'], INTERMEDIATE: ['I', '半雨胎'], WET: ['W', '全雨胎'] };
  new ResizeObserver(paintCircuit).observe(circuitCanvas);

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

  function drawTimeline(details, isLive) {
    const events = (details?.events ?? []).map(item => ({ ...item, kind: 'control' }));
    const clips = (details?.radio ?? []).filter(clip => link(clip.url)).map(item => ({ ...item, kind: 'radio' }));
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
        `<button type="button" class="action outline live-play" data-recording="${html(item.url)}" aria-label="播放车队电台 · ${html(driverName(item.driver))}">播放</button>`
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

  function paintCircuit() {
    const width = circuitCanvas.clientWidth;
    const height = circuitCanvas.clientHeight;
    if (!circuit || !width || !height) return;
    const scaleFactor = Math.min(window.devicePixelRatio || 1, 2);
    circuitCanvas.width = Math.round(width * scaleFactor);
    circuitCanvas.height = Math.round(height * scaleFactor);
    const context = circuitCanvas.getContext('2d');
    if (!context) return;
    context.scale(scaleFactor, scaleFactor);
    const angle = circuit.rotation * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = (x, y) => [x * cos - y * sin, -(x * sin + y * cos)];
    const points = circuit.x.map((x, i) => rotate(x, circuit.y[i]));
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    const scale = Math.min((width - 46) / Math.max(right - left, 1), (height - 52) / Math.max(bottom - top, 1));
    const project = ([x, y]) => [(x - (left + right) / 2) * scale + width / 2, (y - (top + bottom) / 2) * scale + height / 2];
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    points.forEach((point, i) => {
      const [x, y] = project(point);
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    for (const [lineWidth, color] of [[11, '#25394a'], [6, '#57616b'], [3, '#f3c172']]) {
      context.lineWidth = lineWidth;
      context.strokeStyle = color;
      context.stroke();
    }
    context.font = '600 10px ui-monospace, monospace';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    for (const corner of circuit.corners ?? []) {
      const [x, y] = project(rotate(corner.x, corner.y));
      const dx = x - width / 2;
      const dy = y - height / 2;
      const length = Math.hypot(dx, dy) || 1;
      context.beginPath();
      context.fillStyle = '#a7eee0';
      context.arc(x, y, 2.3, 0, 2 * Math.PI);
      context.fill();
      context.fillStyle = '#d5e3f1';
      context.fillText(corner.label, x + dx / length * 11, y + dy / length * 11);
    }
  }

  function drawMap(showPublic, session, layout) {
    const showCircuit = !showPublic && Boolean(layout?.x.length);
    const circuitChanged = circuit !== layout;
    circuit = layout;
    byId('liveCircuitFrame').hidden = !showCircuit;
    if (showCircuit && circuitChanged) paintCircuit();
    const map = byId('liveTrackLayout');
    const course = sessionCircuit(session)?.[0];
    const season = new Date(session?.startsAt).getUTCFullYear();
    const sectors = season === 2026 ? window.F1_CIRCUIT_SECTORS.render(course) : '';
    setMarkup('liveCircuitSectors', sectors);
    byId('liveCircuitSectors').hidden = !sectors;
    const code = course && content.circuit[course]?.[3];
    const url = !showPublic && !showCircuit && code ? `https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026track${code}detailed.webp` : '';
    byId('liveMapWindow').hidden = !showPublic;
    showFrame(mapFrame, showPublic);
    if (url && map.getAttribute('src') !== url) {
      map.hidden = false;
      map.src = url;
    } else if (!url) {
      map.hidden = true;
      map.removeAttribute('src');
    }
    byId('liveMapStatus').hidden = showPublic || showCircuit || !map.hidden;
    setText('liveMapCaption', showPublic ? '车位按分段进度估算。' : showCircuit ? '轮廓与弯角' : map.hidden ? '' : '官方赛道布局');
  }

  function draw() {
    const { session, mode, details, news, bulletins, layout, generatedAt, scheduleUnavailable, archiveUnavailable } = snapshot ?? {};
    const isLive = mode === 'live' || mode === 'settling';
    drawLiveFrames(isLive);
    drawMap(isLive, session, layout);
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
    const circuitKey = session?.circuitKey ?? saved?.details.session.circuitKey;
    const layout = circuitKey && index.layouts?.[`${new Date(session.startsAt).getUTCFullYear()}-${circuitKey}`];
    return {
      index, session, mode, saved, details: saved?.details, layout, pollMs,
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
    clearTimeout(timer);
    request?.abort();
    request = null;
    refreshButton.removeAttribute('aria-busy');
    drawLiveFrames(false);
    showFrame(mapFrame, false);
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
    if (event.key !== 'Escape' || !screen.hasAttribute('data-focus')) return;
    screen.removeAttribute('data-focus');
    updateFullscreen();
    fullscreen.focus({ preventScroll: true });
  });
  byId('liveTrackLayout').addEventListener('error', event => {
    event.target.hidden = true;
    byId('liveMapStatus').hidden = false;
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
    recording = snapshot?.details?.radio.find(clip => clip.url === play.dataset.recording);
    if (!recording) return;
    setText('liveRecording', [driverName(recording.driver), clock(recording.date), recording.source].filter(Boolean).join(' · '));
    const player = byId('livePlayer');
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
    if (recording) setText('liveRecording', [driverName(recording.driver), clock(recording.date), recording.source].filter(Boolean).join(' · '));
  });

  window.F1_LIVE = { show, hide };
})();
