(() => {
  'use strict';

  function paint(canvas, layout, drivers, positions) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || !layout?.x?.length) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const theme = getComputedStyle(canvas);
    const panel = theme.getPropertyValue('--pit-panel').trim() || '#16161a';
    const edge = theme.getPropertyValue('--pit-edge').trim() || '#33333b';
    const ink = theme.getPropertyValue('--ink').trim() || '#f1f1f4';
    const angle = layout.rotation * Math.PI / 180;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const rotate = (x, y) => [x * cos - y * sin, -x * sin - y * cos];
    const points = layout.x.map((x, index) => rotate(x, layout.y[index]));
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((width - 70) / Math.max(maxX - minX, 1), (height - 58) / Math.max(maxY - minY, 1));
    const project = ([x, y]) => [(x - (minX + maxX) / 2) * scale + width / 2, (y - (minY + maxY) / 2) * scale + height / 2];

    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    for (const [index, point] of points.entries()) {
      const [x, y] = project(point);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    for (const [color, thickness] of [[edge, 14], ['#464952', 8], ['#e1b28d', 2]]) {
      context.strokeStyle = color;
      context.lineWidth = thickness;
      context.stroke();
    }
    const shown = [];
    for (const driver of drivers) {
      const point = positions?.[driver.number];
      if (!Array.isArray(point) || !point.every(Number.isFinite)) continue;
      const [x, y] = project(rotate(...point));
      if (x < 12 || y < 12 || x > width - 12 || y > height - 12) continue;
      const color = /^#[a-f0-9]{6}$/i.test(driver.color) ? driver.color : '#a4a4a8';
      shown.push({ driver, x, y, color });
    }
    const labels = [];
    for (const { driver, x, y, color } of shown) {
      const code = driver.code || ('#' + driver.number);
      context.font = '700 10px ui-monospace, monospace';
      const labelWidth = Math.ceil(context.measureText(code).width) + 10;
      const choices = [[18, -18], [18, 8], [-labelWidth - 18, -18], [-labelWidth - 18, 8],
        [13, -37], [-labelWidth - 13, 24], [28, -4], [-labelWidth - 28, -4]];
      const position = choices.map(([dx, dy]) => [x + dx, y + dy]).find(([ax, ay]) =>
        ax > 2 && ay > 2 && ax + labelWidth < width - 2 && ay + 17 < height - 2 &&
        !labels.some(label => ax < label.x + label.w && ax + labelWidth > label.x && ay < label.y + 18 && ay + 18 > label.y) &&
        !shown.some(car => car.x > ax - 7 && car.x < ax + labelWidth + 7 && car.y > ay - 7 && car.y < ay + 24));
      if (position) {
        const [ax, ay] = position;
        labels.push({ x: ax, y: ay, w: labelWidth });
        context.strokeStyle = color;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(ax + labelWidth / 2, ay + 8);
        context.stroke();
        context.fillStyle = panel;
        context.fillRect(ax, ay, labelWidth, 17);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = ink;
        context.fillText(code, ax + labelWidth / 2, ay + 9);
      }
    }
    for (const { driver, x, y, color } of shown) {
      context.beginPath();
      context.arc(x, y, 9.5, 0, 2 * Math.PI);
      context.fillStyle = panel;
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 2.5;
      context.stroke();
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = ink;
      context.font = '700 9px ui-monospace, monospace';
      context.fillText(driver.number, x, y + .5);
    }
  }

  async function fetchTelemetry(session, signal, knownDrivers) {
    const relay = document.querySelector('meta[name="f1-openf1-relay"]')?.content;
    const configured = relay && new URL(relay, document.baseURI);
    const base = configured?.origin === location.origin
      ? configured.href.replace(/\/?$/, '/') : 'https://api.openf1.org/v1/';
    let key = String(session.key ?? '');
    const now = Date.now();
    const iso = before => new Date(now - before).toISOString();
    const request = async (endpoint, params = {}) => {
      const url = new URL(endpoint, base);
      if (endpoint !== 'sessions') url.searchParams.set('session_key', key);
      for (const [field, value] of Object.entries(params)) url.searchParams.set(field, value);
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error('Telemetry unavailable');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid telemetry response');
      return endpoint === 'sessions' ? data : data.filter(row => String(row.session_key) === key);
    };
    if (!/^\d{1,8}$/.test(key)) {
      const params = { year: new Date(session.startsAt).getUTCFullYear(), session_name: session.name };
      const sessions = await request('sessions', params);
      const match = sessions.find(row => row.session_name === session.name &&
        Math.abs(Date.parse(row.date_start) - session.startsAt) <= 15 * 60_000);
      key = String(match?.session_key ?? '');
      if (!/^\d{1,8}$/.test(key)) return null;
    }
    // Check the selected session before issuing more requests to a gated feed.
    const packets = await request('car_data', { 'date>': iso(15_000) });
    const at = Math.max(...packets.map(packet => Date.parse(packet.date)).filter(Number.isFinite));
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 25_000) return null;
    const spaced = async (endpoint, params) => {
      await new Promise(resolve => setTimeout(resolve, 420));
      return signal.aborted ? [] : request(endpoint, params).catch(() => []);
    };
    const locationRows = await spaced('location', { 'date>': iso(15_000) });
    const tyreRows = await spaced('stints');
    const laps = await spaced('laps', { 'date_start>': iso(6 * 60_000) });
    const driverRows = knownDrivers?.length ? [] : await spaced('drivers');
    const fresh = rows => rows.filter(row => Math.abs(Date.parse(row.date) - at) < 7500)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const positions = Object.fromEntries(fresh(locationRows).filter(row => [row.x, row.y].every(Number.isFinite) && (row.x || row.y))
      .map(row => [row.driver_number, [row.x, row.y]]));
    const speeds = Object.fromEntries(fresh(packets).filter(row => Number.isFinite(row.speed)).map(row => [row.driver_number, row.speed]));
    const tyres = {};
    const lastLap = new Map();
    for (const lap of laps) {
      if (lap.lap_number >= (lastLap.get(lap.driver_number)?.lap_number ?? 0)) lastLap.set(lap.driver_number, lap);
    }
    for (const row of tyreRows.sort((a, b) => a.stint_number - b.stint_number)) {
      const lap = lastLap.get(row.driver_number);
      const completed = lap && Number.isInteger(lap.lap_number) ? lap.lap_number - (lap.lap_duration > 0 ? 0 : 1) : null;
      const end = Number.isInteger(row.lap_end) ? row.lap_end : completed;
      tyres[row.driver_number] = { compound: row.compound, start: row.lap_start, end, ageAtStart: row.tyre_age_at_start, stints: row.stint_number };
    }
    const drivers = knownDrivers?.length ? knownDrivers : driverRows.map(row => ({
      number: row.driver_number, code: row.name_acronym, name: row.full_name, team: row.team_name,
      color: /^[a-f0-9]{6}$/i.test(row.team_colour) ? '#' + row.team_colour : '',
    }));
    return { at, positions, speeds, tyres, drivers, laps: Object.fromEntries(lastLap) };
  }

  window.F1_PITWALL = { paint, fetchTelemetry };
})();
