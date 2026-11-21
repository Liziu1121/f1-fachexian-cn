(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const page = byId('live');
  const screen = byId('liveScreen');
  const fullscreen = byId('liveFullscreen');
  const audio = byId('liveAudio');
  const refreshButton = byId('liveRefresh');
  const timingFrame = byId('liveTimingFrame');
  const mapFrame = byId('liveMapFrame');
  const controlFrame = byId('liveControlFrame');
  const mapSourceSize = 420;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width) mapFrame.style.zoom = String(Math.min(entry.contentRect.width, 330) / mapSourceSize);
  }).observe(byId('liveMapWindow'));
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
  const archiveDelay = 30 * 60_000;

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

  function controlText(value) {
    if (english()) return value;
    const sector = value.match(/^(DOUBLE YELLOW|YELLOW|RED|GREEN) IN TRACK SECTOR (\d+)$/);
    const flags = { 'DOUBLE YELLOW': '双黄旗', YELLOW: '赛道黄旗', RED: '赛道红旗', GREEN: '赛道绿旗' };
    if (sector) return `${flags[sector[1]]} · 第 ${sector[2]} 区段`;
    return {
      'SESSION STARTED': '场次进行中', 'SESSION FINISHED': '场次结束', 'SESSION ABORTED': '场次暂停',
      'SAFETY CAR DEPLOYED': '安全车出动', 'VIRTUAL SAFETY CAR DEPLOYED': '虚拟安全车',
      'GREEN': '赛道绿旗', 'YELLOW': '赛道黄旗', 'RED': '赛道红旗', 'CHEQUERED': '方格旗',
    }[value] ?? value;
  }

  function drawTiming(details, mode) {
    if (!details?.rows.length) {
      const status = mode === 'recent' ? '最近场次的计时快照正在同步。' : '暂无计时数据';
      return setMarkup('liveTiming', empty(status));
    }
    const race = details.session.type === 'Race';
    const rows = details.rows.map(row => {
      const driver = row.driver;
      const color = /^#[\da-f]{6}$/i.test(driver.color) ? ` style="--team-color:${driver.color}"` : '';
      return `<tr><td>${html(row.finish ?? row.position ?? '—')}</td><th scope="row"${color}><span>${html(driverName(driver))}</span><small>${html([driver.code, teamName(driver.team)].filter(Boolean).join(' · '))}</small></th>` +
        (race ? `<td>${html(gap(row.gap))}</td>` : '') +
        `<td>${lapTime(row.best)}</td><td class="live-last">${lapTime(row.last)}</td><td>${html(row.laps ?? '—')}</td></tr>`;
    }).join('');
    setMarkup('liveTiming', `<table class="live-table"><thead><tr><th scope="col">排名</th><th scope="col">车手</th>` +
      (race ? '<th scope="col">领先差</th>' : '') +
      `<th scope="col">最快圈</th><th scope="col" class="live-last">上一圈</th><th scope="col">圈数</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function drawFeeds(details, news, bulletins, publicRadio) {
    const events = details?.events ?? [];
    setMarkup('liveControlMessages', events.length ? `<ul class="live-feed">${events.map(item =>
      `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><div>${html(controlText(item.message))}${item.lap ? `<small>${html(item.lap)} 圈</small>` : ''}</div></li>`).join('')}</ul>` : empty(details && !details.controlAvailable ? '赛会消息暂不可用' : '暂无赛会消息'));

    const clips = (details?.radio ?? []).filter(clip => link(clip.url));
    const radioNotice = publicRadio ? '本场电台与文字转写的入口见底部备注。'
      : details && !details.radioAvailable ? '电台数据暂不可用' : '暂无已发布的电台录音';
    setMarkup('liveClips', clips.length ? `<ul class="live-feed">${clips.map(item =>
      `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><div>${html(driverName(item.driver))}<small>${html(teamName(item.driver.team))}</small></div><button type="button" class="action outline live-play" data-recording="${html(item.url)}" aria-label="播放车队电台 · ${html(driverName(item.driver))}">播放</button></li>`).join('')}</ul>` : empty(radioNotice));

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
    byId('livePublicControl').hidden = !isLive;
    byId('liveControlMessages').hidden = isLive;
    showFrame(timingFrame, isLive);
    showFrame(controlFrame, isLive);
  }

  function drawMap(showPublic, session) {
    const map = byId('liveTrackLayout');
    const circuit = sessionCircuit(session)?.[0];
    const code = circuit && content.circuit[circuit]?.[3];
    const url = !showPublic && code ? `https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/2026track${code}detailed.webp` : '';
    byId('liveMapWindow').hidden = !showPublic;
    showFrame(mapFrame, showPublic);
    if (url && map.getAttribute('src') !== url) {
      map.hidden = false;
      map.src = url;
    } else if (!url) {
      map.hidden = true;
      map.removeAttribute('src');
    }
    byId('liveMapStatus').hidden = showPublic || !map.hidden;
    setText('liveMapCaption', showPublic ? '车位按分段进度估算。' : map.hidden ? '' : '官方赛道布局');
  }

  function draw() {
    const { session, mode, details, news, bulletins, generatedAt, scheduleUnavailable, archiveUnavailable } = snapshot ?? {};
    const isLive = mode === 'live' || mode === 'settling';
    drawLiveFrames(isLive);
    drawMap(isLive, session);
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

    if (!isLive) drawTiming(details, mode);
    drawFeeds(details, news, bulletins, isLive);
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
      if (recording && !sameSession(snapshot?.session, view.session)) stopAudio();
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
  page.addEventListener('click', event => {
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
