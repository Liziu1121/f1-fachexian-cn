(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const page = byId('live');
  const audio = byId('liveAudio');
  const select = byId('liveSelect');
  const refreshButton = byId('liveRefresh');
  const timingToggle = byId('liveTimingToggle');
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
    live: '实况更新中', scheduled: '赛程间歇', off: '赛程间歇', waiting: '等待计时信号',
    stale: '计时更新延迟', ended: '该场次已结束', unavailable: '计时源暂不可用', subscription: '现场计时未接入',
  };
  const english = () => window.F1_LOCALE.english();
  let visible = false;
  let selected = '';
  let timer;
  let request;
  let snapshot;
  let loadFailed = false;
  let recording;
  let publicTimingChoice;
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

  function sessionLabel(session) {
    const known = Object.entries(window.F1_DATA.races).find(([, race]) => Object.values(race.sessions).some(
      stamp => Math.abs(Date.parse(stamp) - session.startsAt) <= 15 * 60_000));
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

  function drawTiming(details, archive) {
    if (!details?.rows.length) return setMarkup('liveTiming', empty('暂无计时数据'));
    const race = details.session.type === 'Race';
    const rows = details.rows.map(row => {
      const driver = row.driver;
      const color = /^#[\da-f]{6}$/i.test(driver.color) ? ` style="--team-color:${driver.color}"` : '';
      return `<tr><td>${html(row.finish ?? row.position ?? '—')}</td><th scope="row"${color}><span>${html(driverName(driver))}</span><small>${html([driver.code, teamName(driver.team)].filter(Boolean).join(' · '))}</small></th>` +
        (race ? `<td>${html(gap(row.gap))}</td>${archive ? '' : `<td class="live-interval">${html(gap(row.interval))}</td>`}` : '') +
        `<td>${lapTime(row.best)}</td><td class="live-last">${lapTime(row.last)}</td><td>${html(row.laps ?? '—')}</td></tr>`;
    }).join('');
    setMarkup('liveTiming', `<table class="live-table"><thead><tr><th scope="col">排名</th><th scope="col">车手</th>` +
      (race ? `<th scope="col">领先差</th>${archive ? '' : '<th class="live-interval" scope="col">距前车</th>'}` : '') +
      `<th scope="col">最快圈</th><th scope="col" class="live-last">上一圈</th><th scope="col">圈数</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  function drawFeeds(details, news, bulletins, publicRadio) {
    const events = details?.events ?? [];
    setMarkup('liveControlMessages', events.length ? `<ul class="live-feed">${events.map(item =>
      `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><div>${html(controlText(item.message))}${item.lap ? `<small>${html(item.lap)} 圈</small>` : ''}</div></li>`).join('')}</ul>` : empty(details && !details.controlAvailable ? '赛会消息暂不可用' : '暂无赛会消息'));

    const clips = (details?.radio ?? []).filter(clip => link(clip.url));
    const radioNotice = publicRadio ? '可在 Paddock Live 查看本场电台的文字转写。'
      : details && !details.radioAvailable ? '电台数据暂不可用' : '暂无已发布的电台录音';
    setMarkup('liveClips', clips.length ? `<ul class="live-feed">${clips.map(item =>
      `<li><time datetime="${new Date(item.date).toISOString()}">${clock(item.date)}</time><div>${html(driverName(item.driver))}<small>${html(teamName(item.driver.team))}</small></div><button type="button" class="action outline live-play" data-recording="${html(item.url)}" aria-label="播放车队电台 · ${html(driverName(item.driver))}">播放</button></li>`).join('')}</ul>` : empty(radioNotice));

    const items = news?.items?.filter(item => link(item.url)) ?? [];
    setMarkup('liveHeadlines', items.length ? `<ul class="live-feed live-articles">${items.map(item =>
      `<li><div><a href="${html(item.url)}" target="_blank" rel="noopener" lang="en">${html(item.title)}</a><small>${html(item.source)} · <time datetime="${new Date(item.date).toISOString()}">${dateTime(item.date)}</time></small></div></li>`).join('')}</ul>` : empty(news?.scope === 'unavailable' ? '新闻来源暂不可用' : '暂无最新报道'));
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

  function updatePublicControl() {
    const usePublic = visible && !byId('livePublicTiming').hidden;
    byId('livePublicControl').hidden = !usePublic;
    byId('liveControlMessages').hidden = usePublic;
    showFrame(controlFrame, usePublic && !byId('liveControl').hidden);
  }

  function drawTimingSource(showPublic) {
    timingToggle.hidden = Boolean(selected);
    timingToggle.setAttribute('aria-expanded', String(showPublic));
    setText('liveTimingToggle', showPublic ? '返回本站计时' : '免费实时计时');
    setText('liveTimingTitle', showPublic ? '计时与分段' : '计时榜');
    byId('livePublicTiming').hidden = !showPublic;
    byId('liveTiming').hidden = showPublic;
    showFrame(timingFrame, showPublic);
    const showMap = visible && !selected && (showPublic || Boolean(snapshot?.active));
    byId('liveMapPanel').hidden = !showMap;
    showFrame(mapFrame, showMap);
    updatePublicControl();
  }

  function draw() {
    const view = snapshot ?? {};
    const upstream = loadFailed ? 'unavailable' : view.status;
    const preferPublic = upstream === 'unavailable' || Boolean(view.active && ['subscription', 'stale'].includes(upstream));
    const showPublic = !selected && (publicTimingChoice ?? preferPublic);
    drawTimingSource(showPublic);
    byId('liveQualifyingDetails').hidden = !/qualifying|shootout/i.test(view.active?.name ?? '');
    const details = showPublic && view.archiveView && view.active ? null : view.details;
    const status = showPublic ? '公开计时' : details && view.archiveView ? '已完成场次' : states[upstream] || '正在读取实况';
    setText('liveState', status);
    byId('liveState').dataset.state = showPublic ? 'public' : view.archiveView ? 'archive' : upstream ?? 'loading';
    const relevant = details?.session ?? view.active ?? view.next;
    const title = showPublic && !view.active ? 'TELOS 免费实时计时' : relevant ? sessionLabel(relevant) : '计时与赛况';
    setText('liveRound', title);
    const schedule = view.active ? `计划开赛 · ${sessionLabel(view.active)} · ${dateTime(view.active.startsAt)}`
      : view.next ? `下一场 · ${sessionLabel(view.next)} · ${dateTime(view.next.startsAt)}` : '';
    setText('liveSchedule', schedule ? `${schedule} · 北京时区` : '');
    const meta = [];
    if (!showPublic && details?.updatedAt) meta.push(`数据更新 ${dateTime(details.updatedAt)} · 北京时区`);
    if (!showPublic && upstream === 'live' && details?.flag) meta.push(controlText(details.flag));
    if (!showPublic && upstream === 'live' && details?.session.type === 'Race' && details.rows[0]?.laps) meta.push(`${details.rows[0].laps} 圈`);
    setText('liveMeta', meta.join(' / '));
    const notice = showPublic ? '' : upstream === 'subscription' && !selected ? '当前场次可用 TELOS 免费计时。'
      : upstream === 'stale' && details ? '计时更新延迟。已保留上次成功加载的数据。'
      : upstream === 'unavailable' ? `计时源暂不可用。${loadFailed && details ? '已保留上次成功加载的数据。' : ''}` : '';
    setText('liveNotice', notice);
    byId('liveNotice').hidden = !notice;

    const archives = [...(view.archives ?? [])];
    if (selected && details && !archives.some(session => session.key === selected)) archives.unshift(details.session);
    const optionList = '<option value="">当前 / 最近场次</option>' + archives.map(session =>
      `<option value="${html(session.key)}">${dateTime(session.startsAt)} · ${html(sessionLabel(session))}</option>`).join('');
    if (document.activeElement !== select || [...select.options].every(option => option.value !== selected)) setMarkup('liveSelect', optionList);
    select.value = selected;
    drawTiming(details, view.archiveView);
    const publicRadio = !selected && Boolean(view.active) && (view.archiveView || !details?.radioAvailable);
    drawFeeds(details, view.news, view.bulletins, publicRadio);
    const timestamp = byId('liveSnapshotAt');
    timestamp.hidden = !Number.isFinite(view.generatedAt);
    if (!timestamp.hidden) setText('liveSnapshotAt', `资讯快照发布于 · ${dateTime(view.generatedAt)} · 北京时区`);
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

  async function readView(key, signal) {
    const data = await readSnapshot('index', signal);
    const now = Date.now();
    const active = data.schedule.find(session => session.startsAt <= now && session.endsAt + archiveDelay > now);
    const next = data.schedule.findLast(session => session.startsAt > now);
    const archive = key ? data.archives.find(session => session.key === key) : data.archives[0];
    const saved = archive && await readSnapshot(archive.key, signal).catch(() => null);
    const snapshotNews = data.contextStartsAt === active?.startsAt || !active
      ? data.news : { ...data.news, coverage: undefined };
    const status = key ? saved ? 'off' : 'unavailable' : active ? 'subscription' : next ? 'scheduled' : 'off';
    return { active, next, status, archives: data.archives, details: saved?.details, archiveView: Boolean(saved?.details),
      generatedAt: data.generatedAt, news: (key && saved?.news) || snapshotNews,
      bulletins: (key && saved?.bulletins) || data.bulletins,
      pollMs: key ? 60_000 : Math.max(1_000, Math.min(60_000, (next?.startsAt ?? Infinity) - now)) };
  }

  async function refresh() {
    if (!visible || request || document.hidden) return;
    clearTimeout(timer);
    const pending = new AbortController();
    request = pending;
    refreshButton.setAttribute('aria-busy', 'true');
    let pollMs = 60_000;
    try {
      const view = await readView(selected, AbortSignal.any([pending.signal, AbortSignal.timeout(30_000)]));
      if (request !== pending) return;
      if (snapshot?.details && snapshot.details.session.key !== view.details?.session.key) stopAudio();
      snapshot = view;
      loadFailed = false;
      pollMs = view.pollMs;
    } catch {
      if (request !== pending) return;
      loadFailed = true;
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
    drawTimingSource(false);
    stopAudio();
  }

  function show(key) {
    const next = /^\d{1,8}$/.test(key ?? '') ? key : '';
    if (visible && next === selected) return;
    hide();
    selected = next;
    snapshot = null;
    loadFailed = false;
    publicTimingChoice = undefined;
    visible = true;
    draw();
    refresh();
  }

  select.addEventListener('change', () => { location.hash = select.value ? `#/live/${select.value}` : '#/live'; });
  refreshButton.addEventListener('click', refresh);
  timingToggle.addEventListener('click', () => {
    publicTimingChoice = byId('livePublicTiming').hidden;
    if (publicTimingChoice && snapshot?.active && snapshot.archiveView) stopAudio();
    draw();
  });
  page.addEventListener('click', event => {
    const tab = event.target.closest('[data-live-panel]');
    if (tab) {
      page.querySelectorAll('[data-live-panel]').forEach(button => {
        button.setAttribute('aria-pressed', String(button === tab));
        byId(button.getAttribute('aria-controls')).hidden = button !== tab;
      });
      updatePublicControl();
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
