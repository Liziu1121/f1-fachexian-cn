(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const page = byId('live');
  const screen = byId('liveScreen');
  const raceData = byId('liveRaceData');
  const gallery = byId('liveGallery');
  const photoslots = [...gallery.querySelectorAll('[data-live-slide]')];
  const header = document.querySelector('body > header');
  if (header) new ResizeObserver(() => {
    gallery.style.setProperty('--live-header-height', header.offsetHeight + 'px');
  }).observe(header);
  const fullscreen = byId('liveFullscreen');
  const audio = byId('liveAudio');
  const refreshButton = byId('liveRefresh');
  const timingFrame = byId('liveTimingFrame');
  const trackFrame = byId('liveTrackFrame');
  const sectorFrame = byId('liveSectorFrame');
  const trackCanvas = byId('liveTrackCanvas');
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
  let driverZoom;
  new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    const zoom = Math.min(width, 330) / 360;
    if (!width || zoom === driverZoom) return;
    driverZoom = zoom;
    requestAnimationFrame(() => { driverFrame.style.zoom = String(driverZoom); });
  }).observe(byId('liveDriverWindow'));
  const content = window.F1_CONTENT;
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const officialHosts = new Set(['livetiming.formula1.com', 'www.formula1.com', 'www.skysports.com', 'www.motorsport.com', 'www.autosport.com', 'www.fia.com', 'f1archive.org']);
  const cachedMarkup = new WeakMap();
  const sessionNames = new Map([
    ['Practice 1', '一练'], ['Practice 2', '二练'], ['Practice 3', '三练'], ['Qualifying', '排位赛'],
    ['Sprint Qualifying', '冲刺排位赛'], ['Sprint Shootout', '冲刺排位赛'], ['Sprint', '冲刺赛'], ['Race', '正赛'],
  ]);
  const sessionCodes = {
    fp1: 'Practice 1', fp2: 'Practice 2', fp3: 'Practice 3', q: 'Qualifying',
    sq: 'Sprint Qualifying', sprint: 'Sprint', race: 'Race',
  };
  const previewLead = 10 * 60_000;
  const reviewDuration = 20 * 60_000;
  const english = () => window.F1_LOCALE.english();
  let visible = false;
  let timer;
  let request;
  let snapshot;
  let recording;
  let timelineFilter = 'all';
  let galleryCourse, galleryIndex = 0, galleryTimer, countdownTimer;
  let photoRequest, photoTransition, activePhoto = 0;
  let galleryPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let archiveRequest, showRecent = false;
  let telemetryRequest, telemetry, telemetrySession = '', telemetryRetry = 0, telemetryTimer;
  const archives = new Map();
  const language = (zh, en) => english() ? en : zh;

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

  const measurement = (value, unit, digits = 0) => Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : '—';

  function upcomingSession(now = Date.now()) {
    const schedule = snapshot?.index?.schedule ?? [];
    const next = schedule.reduce((nearest, session) =>
      sessionNames.has(session.name) && session.startsAt > now &&
        (!nearest || session.startsAt < nearest.startsAt) ? session : nearest, null);
    if (next) {
      const paired = sessionCircuit(next) || schedule.filter(session => next.meeting != null && session.meeting === next.meeting)
        .map(sessionCircuit).find(Boolean);
      return { course: paired?.[0], place: next.location || next.circuit, start: next.startsAt, name: next.name };
    }
    return Object.entries(window.F1_DATA.races).flatMap(([course, race]) =>
      Object.entries(race.sessions).map(([code, stamp]) => ({ course, start: Date.parse(stamp), name: sessionCodes[code] })))
      .filter(session => session.name && session.start > now).sort((a, b) => a.start - b.start)[0];
  }

  function setGalleryControls(available) {
    byId('liveGalleryPrevious').disabled = available < 2;
    byId('liveGalleryNext').disabled = available < 2;
    const pause = byId('liveGalleryPause');
    pause.disabled = available < 2;
    pause.setAttribute('aria-pressed', String(galleryPaused));
    setText('liveGalleryPause', galleryPaused ? '继续播放' : '暂停播放');
  }

  async function displayGallery(step = 0) {
    if (!visible || gallery.hidden || document.hidden) return;
    const photos = window.F1_CONTENT_EXTRAS.galleries?.[galleryCourse] ?? [];
    setGalleryControls(photos.length);
    const sourceLink = byId('liveGallerySource');
    sourceLink.hidden = !photos.length;
    byId('liveGalleryNumber').hidden = !photos.length;
    if (!photos.length) return;

    galleryIndex = (galleryIndex + step + photos.length) % photos.length;
    const { image, source } = photos[galleryIndex];
    const current = photoslots[activePhoto];
    if (image === photoRequest?.image) return;
    if (current.src === image) { photoRequest = null; return; }
    const request = { image };
    photoRequest = request;
    const incoming = new Image();
    incoming.src = image;
    try { await incoming.decode(); }
    catch { if (photoRequest === request) photoRequest = null; return; }
    if (photoRequest !== request || gallery.hidden || !visible) return;
    photoRequest = null;

    const nextSlot = photoslots[1 - activePhoto];
    clearTimeout(photoTransition);
    nextSlot.removeAttribute('data-previous');
    nextSlot.src = image;
    if (current.hasAttribute('data-active')) current.setAttribute('data-previous', '');
    current.removeAttribute('data-active');
    nextSlot.setAttribute('data-active', '');
    photoTransition = setTimeout(() => current.removeAttribute('data-previous'), 900);
    activePhoto = 1 - activePhoto;
    sourceLink.href = source;
    setText('liveGalleryNumber', `${galleryIndex + 1} / ${photos.length}`);
    if (photos.length > 1 && !galleryPaused) {
      const preload = new Image();
      preload.src = photos[(galleryIndex + 1) % photos.length].image;
    }
  }

  function updateCountdown(next = upcomingSession(), now = Date.now()) {
    if (!visible || gallery.hidden) return;
    const label = byId('liveGallerySession');
    label.hidden = !next;
    if (!next) return setText('liveGalleryCountdown', language('下一场赛程待公布', 'Next session schedule pending'));
    const minutes = Math.max(0, Math.ceil((next.start - now) / 60_000));
    const name = content.circuit[next.course]?.[english() ? 1 : 0] || next.place || '';
    const type = english() ? next.name : sessionNames.get(next.name);
    setText(label.id, language(`下一场 · ${type}`, `Next session · ${type}`));
    setText('liveGalleryCountdown', language(
      `${name} · 北京时间 ${dateTime(next.start)} · 距开始 ${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes / 60) % 24} 小时 ${minutes % 60} 分钟`,
      `${name} · ${dateTime(next.start)} Beijing time · Starts in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`));
  }

  function drawGallery() {
    const now = Date.now();
    const next = upcomingSession(now);
    const latest = Object.entries(window.F1_DATA.races).reduce((recent, [course, race]) => {
      const date = Date.parse(race.sessions.race);
      return date <= now && date > (recent?.date ?? 0) ? { course, date } : recent;
    }, null);
    const course = next?.course || latest?.course;
    if (galleryCourse !== course) { galleryCourse = course; galleryIndex = 0; }
    setText('liveGalleryTitle', content.circuit[course]?.[english() ? 1 : 0] || next?.place || language('比赛实况', 'Live Centre'));
    displayGallery();
    updateCountdown(next, now);
  }

  for (const [id, step] of [['liveGalleryPrevious', -1], ['liveGalleryNext', 1]]) {
    byId(id).addEventListener('click', () => displayGallery(step));
  }
  byId('liveGalleryPause').addEventListener('click', () => {
    galleryPaused = !galleryPaused;
    displayGallery();
  });

  const cleanColor = color => /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  const selectedArchive = () => archives.get(snapshot?.session?.key);
  const liveSample = () => telemetrySession === sessionIdentity(snapshot?.session) && snapshot?.phase === 'live' &&
    telemetry && Date.now() - telemetry.at <= 25_000 ? telemetry : null;

  function sessionIdentity(session) {
    return session ? session.name + ':' + session.startsAt : '';
  }

  function roster() {
    const archive = selectedArchive();
    const source = snapshot?.phase === 'archive' || snapshot?.phase === 'post'
      ? archive?.details.rows.map(row => row.driver) : liveSample()?.drivers;
    const drivers = source?.length ? source : snapshot?.index?.pitwall?.drivers ?? [];
    return [...new Map(drivers.filter(driver => Number.isInteger(driver.number))
      .map(driver => [driver.number, driver])).values()];
  }

  function driverBadge(driver) {
    const name = driverName(driver);
    const color = cleanColor(driver.color);
    return '<span class="live-driver-chip" role="img"' + (color ? ' style="--team-color:' + color + '"' : '') +
      ' aria-label="' + html(name + ' #' + driver.number) + '" title="' + html(name + ' #' + driver.number) + '"><i aria-hidden="true">' + html(driver.number) +
      '</i><span>' + html(driver.code || name) + '</span></span>';
  }

  function setOptions(select, options, preferred) {
    const old = select.value || String(preferred ?? '');
    const markup = options.map(([value, label]) => '<option value="' + html(value) + '">' + html(label) + '</option>').join('');
    if (cachedMarkup.get(select) !== markup) {
      select.innerHTML = markup;
      cachedMarkup.set(select, markup);
      if (options.some(([value]) => String(value) === old)) select.value = old;
    }
  }

  function tyreAge(stint) {
    if (![stint?.start, stint?.end, stint?.ageAtStart].every(Number.isInteger) || stint.end < stint.start) return '—';
    return (stint.ageAtStart + stint.end - stint.start + 1) + language(' 圈', ' laps');
  }

  function compound(value) {
    return (!english() ? { SOFT: '软胎', MEDIUM: '中性胎', HARD: '硬胎', INTERMEDIATE: '半雨胎', WET: '全雨胎' }[value] : value) || value || '—';
  }

  function drawComparisonRows() {
    const panel = byId('liveComparePanel');
    const open = ['pre', 'live'].includes(snapshot?.phase);
    panel.hidden = !open;
    if (!open) return;
    const rows = roster();
    const first = byId('liveCompareFirst'), second = byId('liveCompareSecond');
    const options = rows.map(driver => [driver.number, driverName(driver) + ' · #' + driver.number]);
    setOptions(first, options, options[0]?.[0]);
    setOptions(second, options, options[1]?.[0]);
    first.disabled = second.disabled = options.length < 2;
    if (first.value === second.value && options.length > 1) second.value = options.find(([number]) => String(number) !== first.value)[0];
    for (const option of second.options) option.disabled = option.value === first.value;
    for (const option of first.options) option.disabled = option.value === second.value;
    const selected = [first, second].map(select => rows.find(driver => String(driver.number) === select.value));
    const sample = liveSample();
    const status = sample ? language('本场遥测 · ', 'Current session telemetry · ') + clock(sample.at)
      : snapshot?.phase === 'pre' ? language('等待本场遥测。', 'Waiting for this session’s telemetry.')
        : language('本场实时遥测暂不可用。', 'Live telemetry is unavailable for this session.');
    setText('liveCompareStatus', status + ' ' + language('轮胎以已用圈数显示。', 'Tyres are shown by laps used.'));
    if (!selected.every(Boolean)) return setMarkup('liveCompareResult', empty(language('等待本场车手名单。', 'Waiting for the session driver list.')));
    const entries = [
      [language('瞬时车速', 'Speed'), number => measurement(sample?.speeds[number], 'km/h')],
      [language('当前轮胎', 'Compound'), number => compound(sample?.tyres[number]?.compound)],
      [language('轮胎已用', 'Tyre age'), number => tyreAge(sample?.tyres[number])],
      [language('最近计时圈', 'Last timed lap'), number => lapTime(sample?.laps[number]?.lap_duration)],
      ...[1, 2, 3].map(i => ['S' + i, number => measurement(sample?.laps[number]?.['duration_sector_' + i], 's', 3)]),
      [language('测速点', 'Speed trap'), number => measurement(sample?.laps[number]?.st_speed, 'km/h')],
    ];
    setMarkup('liveCompareResult', '<table class="live-compare-table"><thead><tr><th scope="col">' +
      language('项目', 'Metric') + '</th>' + selected.map(driver => '<th scope="col">' + driverBadge(driver) + ' ' + html(driverName(driver)) + '</th>').join('') +
      '</tr></thead><tbody>' + entries.map(([label, value]) => '<tr><th scope="row">' + label + '</th>' +
        selected.map(driver => '<td>' + html(value(driver.number)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
  }

  byId('liveCompareFirst').addEventListener('change', drawComparisonRows);
  byId('liveCompareSecond').addEventListener('change', drawComparisonRows);

  async function readArchive(view) {
    const key = view?.session?.key;
    if (!['post', 'archive'].includes(view?.phase) || !key || archives.has(key) || archiveRequest === key ||
      !view.index.archives.some(session => session.key === key)) return;
    archiveRequest = key;
    try {
      const data = await readSnapshot(key, AbortSignal.timeout(8000));
      if (data.details?.session.key === key) archives.set(key, data);
    } catch { /* A later refresh can retry. */ }
    finally {
      if (archiveRequest === key) archiveRequest = null;
    }
    if (visible && snapshot?.session?.key === key && archives.has(key)) draw();
  }

  function resetTelemetry() {
    telemetryRequest?.abort();
    telemetryRequest = null;
    telemetrySession = '';
    telemetry = null;
    telemetryRetry = 0;
  }

  async function pollTelemetry() {
    if (!visible || document.hidden || snapshot?.phase !== 'live' || telemetryRequest || Date.now() < telemetryRetry) return;
    const session = snapshot.session;
    const id = sessionIdentity(session);
    const pending = new AbortController();
    telemetryRequest = pending;
    try {
      const data = await window.F1_PITWALL.fetchTelemetry(session, AbortSignal.any([pending.signal, AbortSignal.timeout(8000)]), telemetry?.drivers);
      if (telemetryRequest !== pending) return;
      telemetry = data;
      telemetrySession = id;
      telemetryRetry = Date.now() + (data ? 0 : 25_000);
    } catch {
      if (telemetryRequest !== pending) return;
      telemetry = null;
      telemetryRetry = Date.now() + 90_000;
    } finally {
      if (telemetryRequest === pending) {
        telemetryRequest = null;
        if (visible && snapshot?.phase === 'live' && sessionIdentity(snapshot.session) === id) {
          drawComparisonRows();
          drawTrackStage();
          drawSectorPanel();
        }
      }
    }
  }

  const radioClips = view => ['post', 'archive'].includes(view?.phase)
    ? archives.get(view.session?.key)?.details.radio ?? view.radio ?? [] : view?.radio ?? [];
  function radioTranscript(clip) {
    const transcript = clip?.transcript;
    if (!transcript?.text) return language('转写暂不可用', 'Transcript unavailable');
    const translated = !english() && transcript.language !== 'zh';
    const name = new Intl.DisplayNames([english() ? 'en' : 'zh-CN'], { type: 'language', fallback: 'code' }).of(transcript.language);
    if (translated && !transcript.zh) return `${name} · ${transcript.text}（中文译文暂不可用）`;
    return `${name} · ${translated ? transcript.zh : transcript.text}`;
  }

  function drawTimeline() {
    const clips = radioClips(snapshot).filter(clip => link(clip.url));
    const archive = ['post', 'archive'].includes(snapshot?.phase) ? selectedArchive()?.details : null;
    const events = timelineFilter === 'radio' ? [] : archive?.events ?? [];
    const shown = [...(timelineFilter === 'control' ? [] : clips), ...events].sort((a, b) => b.date - a.date);
    const showControl = timelineFilter !== 'radio' && (snapshot?.phase === 'live' || (snapshot?.phase === 'post' && !archive));
    showFrame(controlFrame, showControl);
    byId('livePublicControl').hidden = !showControl;
    setText('liveTimelineCount', shown.length ? `${shown.length} 条` : '');
    const list = shown.map(item => {
      if (item.message) return `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><article><span class="live-feed-tag">赛会消息</span><p>${html(item.message)}</p></article></li>`;
      const driver = driverName(item.driver);
      return `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><article>` +
        `<span class="live-feed-tag" data-kind="radio">车队电台</span><p>${html(driver)}</p><small>${html(teamName(item.driver.team))}</small>` +
        `<button type="button" class="action outline live-play" data-recording="${html(item.url)}" aria-label="播放车队电台 · ${html(driver)}">播放</button>` +
        `<p class="live-radio-text">${html(radioTranscript(item))}</p></article></li>`;
    }).join('');
    const message = !showControl ? empty('本场电台与文字转写的入口见底部备注。') : '';
    setMarkup('liveTimeline', list ? `<ul class="live-feed">${list}</ul>` : message);
  }

  function drawBulletins(news, bulletins) {
    const items = news?.items?.filter(item => item.onSite && item.id) ?? [];
    setMarkup('liveHeadlines', items.length ? `<ul class="live-feed live-articles">${items.map(item => {
      const translated = !english() && item.titleZh;
      return `<li><div><button type="button" class="live-news-button" data-news-entry="${html(item.id || '')}" lang="${translated ? 'zh-CN' : 'en'}">${html(translated || item.title)}</button><small>${html(item.source)} · <time datetime="${new Date(item.date).toISOString()}">${dateTime(item.date)}</time></small></div></li>`;
    }).join('')}</ul>` : empty(news?.scope === 'unavailable' ? '新闻来源暂不可用' : '暂无最新报道'));
    const scope = items.length ? news.scope === 'session' ? '本站相关报道' : '近期 F1 报道' : '';
    setText('liveNewsScope', scope);
    byId('liveNewsScope').hidden = !scope;

    const coverage = link(news?.coverage);
    byId('liveOfficialCoverage').dataset.newsEntry = items.find(item => item.url === coverage)?.id ?? '';
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
    byId('livePublicStatus').hidden = !isLive;
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
    mapOpen.disabled = false;
    if (visible && snapshot?.session) drawTrackStage();
  });
  map.addEventListener('error', () => {
    mapOpen.hidden = true;
    map.removeAttribute('src');
    setText('liveMapStatus', '官方赛道图暂不可用');
    if (visible && snapshot?.session) drawTrackStage();
  });

  function layoutFor(view) {
    const session = view?.session;
    if (!session) return null;
    const match = session.meeting == null ? null : view.index.archives.find(item => String(item.meeting) === String(session.meeting));
    const key = session.circuitKey ?? match?.circuitKey;
    return view.index.pitwall?.layouts?.[new Date(session.startsAt).getUTCFullYear() + '-' + key] ?? null;
  }

  function drawTrackStage() {
    const view = snapshot;
    const layout = layoutFor(view);
    const archive = ['post', 'archive'].includes(view?.phase) ? selectedArchive()?.details.telemetry : null;
    const data = liveSample() ?? archive;
    const withPositions = Boolean(layout && Object.keys(data?.positions ?? {}).length);
    const widget = Boolean(view?.session && (view.phase === 'live' || (view.phase === 'post' && !selectedArchive())) && !withPositions);
    const native = Boolean(layout && !widget);
    trackFrame.hidden = !widget;
    showFrame(trackFrame, widget);
    trackCanvas.hidden = !native;
    const official = !widget && !native && map.complete && map.naturalWidth > 0;
    map.hidden = !official;
    byId('liveMapStatus').hidden = widget || native || official;
    if (native) window.F1_PITWALL.paint(trackCanvas, layout, roster(), data?.positions);
    setText('liveMapCaption', withPositions ? (archive
      ? language('位置回放快照 · ', 'Position snapshot · ') + clock(archive.at)
      : language('本场实时车位', 'Live positions'))
      : widget ? language('实时车位估算', 'Estimated live positions')
        : language('赛道轮廓', 'Circuit layout'));
    const drivers = roster();
    setMarkup('liveMapRoster', drivers.map(driverBadge).join(''));
  }

  new ResizeObserver(() => {
    if (!trackCanvas.hidden) drawTrackStage();
  }).observe(trackCanvas);

  const dataTable = (headers, rows) => '<table class="live-data-table"><thead><tr>' +
    headers.map(label => '<th scope="col">' + html(label) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map((cell, i) => i === 0 ? '<th scope="row">' + cell + '</th>' : '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table>';

  function drawSectorPanel() {
    const archive = ['archive', 'post'].includes(snapshot?.phase) ? selectedArchive()?.details : null;
    const live = liveSample();
    const rows = archive?.rows ?? [];
    const liveLaps = live?.laps ?? {};
    const hasLaps = Object.values(liveLaps).some(lap => lap?.duration_sector_1 || lap?.duration_sector_2 || lap?.duration_sector_3);
    const worker = snapshot?.phase === 'live' && !hasLaps;
    showFrame(sectorFrame, worker);
    byId('livePublicSectors').hidden = !worker;
    byId('liveSectorData').hidden = worker;
    const title = archive ? language('最快圈 · 测速点', 'Best laps · Speed traps')
      : hasLaps ? language('最近计时圈 · 测速点', 'Last timed laps · Speed traps')
        : worker ? language('实时分段与小段', 'Live sectors and mini-sectors') : '';
    setText('liveSectorCaption', title);
    const entries = archive ? rows.map(row => [row.driver, row.measuredLap?.sectors.map(sector => sector.time) ?? [],
      row.measuredLap?.speedTraps ?? [null, null, row.measuredLap?.speed]]) :
      roster().filter(driver => liveLaps[driver.number]).map(driver => {
        const lap = liveLaps[driver.number];
        return [driver, [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3], [lap.i1_speed, lap.i2_speed, lap.st_speed]];
      });
    const headers = [language('车手', 'Driver'), 'S1 (s)', 'S2 (s)', 'S3 (s)', 'I1 km/h', 'I2 km/h', 'ST km/h'];
    setMarkup('liveSectorData', entries.length ? dataTable(headers, entries.map(([driver, times, traps]) => [
      driverBadge(driver), ...[0, 1, 2].map(i => Number.isFinite(times[i]) ? times[i].toFixed(3) : '—'),
      ...[0, 1, 2].map(i => Number.isFinite(traps[i]) ? String(traps[i]) : '—'),
    ])) : empty(language('等待本场分段数据。', 'Waiting for session splits.')));
  }

  function drawStandings() {
    const archive = ['archive', 'post'].includes(snapshot?.phase) ? selectedArchive()?.details : null;
    const rows = archive?.rows ?? [];
    const live = snapshot?.phase === 'live' || (snapshot?.phase === 'post' && !archive);
    byId('livePublicTiming').hidden = !live;
    byId('liveNativeTiming').hidden = live;
    showFrame(timingFrame, live);
    showFrame(driverFrame, live);
    byId('liveDriverWindow').hidden = !live;
    byId('liveNativeLeader').hidden = live;
    const headers = [language('排名', 'Pos.'), language('车手', 'Driver'), language('领先差', 'Gap'), language('距前车', 'Interval'),
      language('最快圈', 'Best'), language('上一圈', 'Last'), language('轮胎', 'Tyre'), language('进站', 'Pits')];
    setMarkup('liveNativeTiming', rows.length ? dataTable(headers, rows.map(row => [
      html(row.finish ?? row.position ?? '—'), driverBadge(row.driver), html(gap(row.gap)), html(gap(row.interval)),
      lapTime(row.best), lapTime(row.last), html(compound(row.tyreStints?.at(-1)?.compound)), html(row.pitCount ?? '—'),
    ])) : empty(language('等待本场排名。', 'Waiting for session standings.')));
    const leader = rows.find(row => row.position === 1) || rows[0];
    const stats = leader ? [
      [language('最快圈', 'Best lap'), lapTime(leader.best)],
      [language('测速点', 'Speed trap'), measurement(leader.measuredLap?.speed, 'km/h')],
      [language('轮胎已用', 'Tyre age'), tyreAge(leader.tyreStints?.at(-1))],
      [language('进站', 'Pit stops'), leader.pitCount ?? '—'],
    ] : [];
    setMarkup('liveNativeLeader', leader ? '<div class="live-leader"><h3>' + driverBadge(leader.driver) + ' ' +
      html(driverName(leader.driver)) + '</h3><dl>' + stats.map(([name, value]) => '<div><dt>' + name +
        '</dt><dd>' + html(value) + '</dd></div>').join('') + '</dl></div>' :
      empty(language('等待本场领先车手。', 'Waiting for the session leader.')));
  }

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

  function draw() {
    const { session, phase, news, bulletins, generatedAt, scheduleUnavailable } = snapshot ?? {};
    const isLive = Boolean(session);
    byId('liveGalleryData').hidden = !snapshot?.index?.archives?.length;
    byId('liveBackGallery').hidden = phase !== 'archive';
    const focus = document.activeElement;
    const focusMoves = isLive ? gallery.contains(focus) : raceData.contains(focus);
    if (!isLive && gallery.hidden) leaveScreenFocus();
    raceData.hidden = !isLive;
    gallery.hidden = isLive;
    if (isLive) photoRequest = null;
    byId('liveSourceNotes').hidden = !isLive;
    drawLiveFrames(phase === 'live' || (phase === 'post' && !selectedArchive()));

    if (!isLive) {
      showFrame(driverFrame, false);
      showFrame(controlFrame, false);
      showFrame(timingFrame, false);
      showFrame(trackFrame, false);
      showFrame(sectorFrame, false);
      if (mapDialog.open) mapDialog.close();
      if (recording) stopAudio();
      drawGallery();
      if (focusMoves) byId('liveGalleryTitle').focus({ preventScroll: true });
      return;
    }

    drawMap(session);
    drawTrackStage();
    drawStandings();
    drawSectorPanel();
    byId('liveQualifyingDetails').hidden = !/qualifying|shootout/i.test(session.name);
    const states = { pre: language('赛前准备', 'Pre-session'), live: language('赛中实况', 'Live'),
      post: language('赛后回顾', 'Post-session'), archive: language('最近一场 · 已结束', 'Latest session · Ended') };
    setText('liveState', states[phase]);
    byId('liveState').dataset.state = phase;
    setText('liveRound', sessionLabel(session));
    setText('liveSchedule', `计划开赛 · ${dateTime(session.startsAt)} · 北京时区`);
    setText('liveNotice', scheduleUnavailable ? '赛程更新暂不可用，按上次加载的赛程显示。' : '');
    byId('liveNotice').hidden = !scheduleUnavailable;

    setText('liveTimingCaption', phase === 'live' ? language('实时计时', 'Live timing') : '');
    drawTimeline();
    const archive = selectedArchive();
    drawBulletins(archive?.news ?? news, archive?.bulletins ?? bulletins);
    drawComparisonRows();
    readArchive(snapshot);
    const timestamp = byId('liveSnapshotAt');
    timestamp.hidden = !news?.items?.length || !Number.isFinite(generatedAt);
    if (!timestamp.hidden) setText('liveSnapshotAt', `资讯快照发布于 · ${dateTime(generatedAt)} · 北京时区`);
    if (focusMoves) raceData.querySelector('h1').focus({ preventScroll: true });
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

  function sessionWindow(schedule, now) {
    let pre, post;
    for (const session of schedule) {
      if (!sessionNames.has(session.name)) continue;
      const { startsAt, endsAt } = session;
      if (now >= startsAt && now < endsAt) return { session, phase: 'live' };
      if (now >= startsAt - previewLead && now < startsAt) pre ??= { session, phase: 'pre' };
      if (now >= endsAt && now < endsAt + reviewDuration) post ??= { session, phase: 'post' };
    }
    return pre || post || {};
  }

  function scheduledView(index, scheduleUnavailable) {
    let { session, phase } = sessionWindow(index?.schedule ?? [], Date.now());
    if (!session && showRecent && index?.archives?.[0]) {
      session = index.archives[0];
      phase = 'archive';
    }
    if (!session) return { index, scheduleUnavailable };
    const context = [...index.schedule, ...index.archives].find(candidate => candidate.startsAt === index.contextStartsAt);
    const sameContext = sameSession(context, session);
    const sameWeekend = sameContext || (session.meeting != null && session.meeting === context?.meeting);
    return {
      index, session, phase, scheduleUnavailable,
      radio: sameSession(index.activeRadio?.session, session) ? index.activeRadio.clips : [],
      generatedAt: index.generatedAt,
      news: sameWeekend ? { ...index.news, coverage: sameContext ? index.news?.coverage : undefined } : undefined,
      bulletins: sameWeekend ? index.bulletins : undefined,
    };
  }

  function applyView(view) {
    const changed = sessionIdentity(snapshot?.session) !== sessionIdentity(view.session);
    if (changed || snapshot?.phase !== view.phase) resetTelemetry();
    if (changed) {
      if (recording) stopAudio();
      setTimelineFilter('all');
    }
    snapshot = view;
    draw();
    pollTelemetry();
  }

  function syncSessionWindow() {
    if (!visible || document.hidden || !snapshot?.index) return;
    const view = scheduledView(snapshot.index, snapshot.scheduleUnavailable);
    if (sessionIdentity(view.session) !== sessionIdentity(snapshot.session) || view.phase !== snapshot.phase) {
      applyView(view);
    }
  }

  async function refresh() {
    if (!visible || request || document.hidden) return;
    clearTimeout(timer);
    const pending = new AbortController();
    request = pending;
    refreshButton.setAttribute('aria-busy', 'true');
    let loaded;
    try {
      loaded = await readSnapshot('index', AbortSignal.any([pending.signal, AbortSignal.timeout(15_000)]));
    } catch {
      // Keep using the last published schedule while retrying.
    } finally {
      if (request === pending) {
        request = null;
        refreshButton.removeAttribute('aria-busy');
        applyView(scheduledView(loaded ?? snapshot?.index, !loaded));
        schedule(loaded ? 60_000 : 15_000);
      }
    }
  }

  function leaveScreenFocus() {
    if (document.fullscreenElement === screen) document.exitFullscreen().catch(() => {});
    if (screen.hasAttribute('data-focus')) {
      screen.removeAttribute('data-focus');
      updateFullscreen();
    }
  }

  function hide() {
    visible = false;
    photoRequest = null;
    clearInterval(galleryTimer);
    clearInterval(countdownTimer);
    clearInterval(telemetryTimer);
    resetTelemetry();
    clearTimeout(timer);
    request?.abort();
    request = null;
    refreshButton.removeAttribute('aria-busy');
    drawLiveFrames(false);
    showFrame(timingFrame, false);
    showFrame(trackFrame, false);
    showFrame(sectorFrame, false);
    if (mapDialog.open) mapDialog.close();
    leaveScreenFocus();
    showFrame(controlFrame, false);
    showFrame(driverFrame, false);
    stopAudio();
  }

  function show() {
    if (visible) return;
    snapshot = null;
    showRecent = false;
    visible = true;
    galleryTimer = setInterval(() => { if (!galleryPaused) displayGallery(1); }, 7000);
    countdownTimer = setInterval(() => {
      syncSessionWindow();
      updateCountdown();
    }, 1000);
    telemetryTimer = setInterval(pollTelemetry, 10_000);
    draw();
    refresh();
  }

  refreshButton.addEventListener('click', refresh);
  for (const [id, open] of [['liveGalleryData', true], ['liveBackGallery', false]]) {
    byId(id).addEventListener('click', () => {
      showRecent = open;
      applyView(scheduledView(snapshot?.index, snapshot?.scheduleUnavailable));
    });
  }
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
      drawTimeline();
      byId('liveTimeline').scrollTop = 0;
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
    else {
      syncSessionWindow();
      refresh();
    }
  });
  window.addEventListener('f1:language', () => {
    if (visible) draw();
    if (recording) setText('liveRadioText', radioTranscript(recording));
    if (recording) setText('liveRecording', [driverName(recording.driver), clock(recording.date), recording.source].filter(Boolean).join(' · '));
  });

  window.F1_LIVE = { show, hide };
})();
