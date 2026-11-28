(() => {
  'use strict';

  const source = 'https://f1-fachexian.briskrhubarb8.chatgpt.site/api/';
  const limit = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  const wrap = (value, length) => ((value % length) + length) % length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function courseGeometry(layout) {
    const angle = (Number(layout.rotation) || 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = (x, y) => [x * cos - y * sin, -x * sin - y * cos];
    const points = layout.x.map((x, index) => rotate(x, layout.y[index]));
    points.push(points[0]);
    const distance = [0];
    for (let index = 1; index < points.length; index++) {
      const [x, y] = points[index];
      const [beforeX, beforeY] = points[index - 1];
      distance.push(distance[index - 1] + Math.hypot(x - beforeX, y - beforeY));
    }
    const length = distance.at(-1);
    if (!Number.isFinite(length) || length < 1) return null;
    const x = points.map(point => point[0]);
    const y = points.map(point => point[1]);
    return {
      points, distance, length, mini: layout.mini ?? [],
      bounds: [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)],
      corners: (layout.corners ?? []).map(corner => ({ point: rotate(corner.x, corner.y), label: corner.label })),
    };
  }

  function trackPoint(course, travelled) {
    const distance = wrap(travelled, course.length);
    let left = 0;
    let right = course.distance.length - 1;
    while (right - left > 1) {
      const centre = Math.floor((left + right) / 2);
      if (course.distance[centre] <= distance) left = centre;
      else right = centre;
    }
    const a = course.points[left];
    const b = course.points[right];
    const ratio = (distance - course.distance[left]) / (course.distance[right] - course.distance[left] || 1);
    return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
  }

  function carDistance(car, at) {
    const elapsed = Math.max(0, at - car.at);
    const transition = Math.min(1, elapsed / 650);
    const destination = Math.min(car.limit, car.confirmed + car.speed * Math.min(elapsed, 4300));
    return reduced.matches ? car.confirmed : car.from + (destination - car.from) * transition;
  }

  function updateCars(rows, course, previous, at, stopped) {
    const cars = new Map();
    for (const row of rows) {
      const sectors = row.measuredLap?.sectors.flatMap(sector => sector.segments) ?? [];
      const segment = sectors.findLastIndex(value => value > 0 && value !== 2064);
      const { driver } = row;
      if (row.inPit || row.retired || segment < 0) continue;

      const segmentEnd = index => course.mini.length === sectors.length
        ? course.distance[course.mini[index]] : (index + 1) / sectors.length * course.length;
      const raw = segmentEnd(segment);
      const next = segment + 1 < sectors.length ? segmentEnd(segment + 1) : segmentEnd(0) + course.length;
      const past = previous.get(driver.number);
      const nominal = course.length / (limit(row.best || 105, 60, 240) * 1000);
      const previousPoint = past ? carDistance(past, at) : raw;

      let confirmed = raw;
      let speed = nominal;
      let confirmedAt = at;
      let from = raw;
      if (past && at - past.at < 8000) {
        const delta = wrap(raw - past.raw + course.length / 2, course.length) - course.length / 2;
        if (Math.abs(delta) <= course.length * .17) {
          confirmed = past.confirmed + delta;
          from = previousPoint;
          if (delta > 0) {
            const measured = delta / Math.max(450, at - past.confirmedAt);
            speed = limit((past.speed || nominal) * .55 + measured * .45, nominal * .35, nominal * 1.5);
          } else {
            speed = past.speed || nominal;
            confirmedAt = past.confirmedAt;
          }
        }
      }
      // Keep the estimate inside the next mini-sector and let confirmed corrections settle without a jump.
      const ceiling = Math.max(from, confirmed + Math.max(0, next - raw) * .84);
      if (stopped) {
        cars.set(driver.number, { driver, raw, from: previousPoint, confirmed: previousPoint,
          limit: previousPoint, speed: 0, at, confirmedAt });
      } else if (past && raw === past.raw && past.speed > 0) {
        cars.set(driver.number, { ...past, driver });
      } else {
        cars.set(driver.number, { driver, raw, from, confirmed,
          limit: ceiling, speed, at, confirmedAt });
      }
    }
    return cars;
  }

  function painter(canvas) {
    const context = canvas.getContext('2d');
    const background = document.createElement('canvas');
    const base = background.getContext('2d');
    let course;
    let layout;
    let project;
    let pixelRatio = 1;
    let cars = new Map();
    let raf;

    function resize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height || !course || !base) return;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = background.width = Math.round(width * pixelRatio);
      canvas.height = background.height = Math.round(height * pixelRatio);

      const [left, right, top, bottom] = course.bounds;
      const margin = width < 480 ? 44 : 76;
      const scale = Math.min((width - margin) / (right - left || 1), (height - margin) / (bottom - top || 1));
      project = ([x, y]) => [(x - (left + right) / 2) * scale + width / 2, (y - (top + bottom) / 2) * scale + height / 2];
      base.scale(pixelRatio, pixelRatio);
      base.lineJoin = base.lineCap = 'round';
      base.beginPath();
      course.points.forEach((point, index) => {
        if (index === 0) base.moveTo(...project(point));
        else base.lineTo(...project(point));
      });
      base.closePath();
      for (const [color, thickness] of [['#203541', 15], ['#495b65', 8], ['#c6d3da', 2.5]]) {
        base.strokeStyle = color;
        base.lineWidth = thickness;
        base.stroke();
      }
      base.font = '600 10px ui-monospace, monospace';
      base.textBaseline = 'middle';
      base.textAlign = 'center';
      for (const corner of course.corners) {
        const [x, y] = project(corner.point);
        const dx = x - width / 2;
        const dy = y - height / 2;
        const length = Math.hypot(dx, dy) || 1;
        base.fillStyle = '#6f8c9c';
        base.beginPath();
        base.arc(x, y, 2.8, 0, 2 * Math.PI);
        base.fill();
        base.fillStyle = '#a4b9c7';
        base.fillText(corner.label, x + dx / length * 12, y + dy / length * 12);
      }
      draw(performance.now());
    }

    function draw(at) {
      if (!project || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(background, 0, 0);
      context.save();
      context.scale(pixelRatio, pixelRatio);
      context.textBaseline = 'middle';
      context.textAlign = 'center';
      for (const car of cars.values()) {
        const [x, y] = project(trackPoint(course, carDistance(car, at)));
        const { driver } = car;
        const color = /^#[0-9a-f]{6}$/i.test(driver.color) ? driver.color : '#a2b2c4';
        context.beginPath();
        context.arc(x, y, 7, 0, 2 * Math.PI);
        context.fillStyle = '#101720';
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.stroke();
        context.font = '700 8px ui-monospace, monospace';
        context.fillStyle = '#f4f7fa';
        context.fillText(driver.number, x, y + .5);
      }
      context.restore();
    }

    function frame(at) {
      raf = undefined;
      draw(at);
      if (!document.hidden && !reduced.matches && [...cars.values()].some(car => car.speed && at - car.at < 4300)) {
        raf = requestAnimationFrame(frame);
      }
    }

    new ResizeObserver(resize).observe(canvas);
    reduced.addEventListener('change', () => draw(performance.now()));
    return {
      layout(next) {
        if (next === layout) return;
        layout = next;
        course = next?.x?.length > 2 ? courseGeometry(next) : null;
        cars.clear();
        project = undefined;
        resize();
      },
      drawPositions(packet) {
        if (!course) return;
        const paused = packet && (packet.status !== 'Started' || packet.flag === '5');
        cars = packet ? updateCars(packet.rows, course, cars, performance.now(), paused) : new Map();
        if (raf === undefined) raf = requestAnimationFrame(frame);
      },
    };
  }

  function follow(onUpdate) {
    let active;
    let pending;
    let timer;
    let failures = 0;
    let lastPacket;
    let layout;
    let layoutKey;
    const geometries = new Map();

    async function json(path, signal) {
      const response = await fetch(new URL(path, source), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5200)]), credentials: 'omit',
      });
      if (!response.ok) throw new Error('Live data unavailable');
      return response.json();
    }

    const matches = (packet, session) => Boolean(packet && Array.isArray(packet.rows) && packet.rows.length &&
      Number.isFinite(packet.at) && Date.now() - packet.at < 15_000 && packet.at <= Date.now() + 4000 &&
      Math.abs(packet.startsAt - session.startsAt) <= 15 * 60_000 &&
      typeof packet.name === 'string' && packet.name.replace('Shootout', 'Qualifying') === session.name.replace('Shootout', 'Qualifying'));

    async function poll() {
      const session = active;
      if (!session || pending || document.hidden) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const packet = await json('live-race', controller.signal);
        if (!matches(packet, session)) throw new Error('Session mismatch or stale data');
        if (controller.signal.aborted) return;
        failures = 0;
        if (packet.at !== lastPacket?.at) {
          lastPacket = packet;
          onUpdate(packet, layout);
        }
        const key = `${packet.year}-${packet.circuit}`;
        if (layoutKey !== key) {
          if (!geometries.has(key)) {
            const query = new URLSearchParams({ year: packet.year, circuit: packet.circuit });
            const course = await json('live-circuit?' + query, controller.signal).catch(() => null);
            if (course) geometries.set(key, course);
          }
          if (controller.signal.aborted) return;
          if (geometries.has(key)) {
            layout = geometries.get(key);
            layoutKey = key;
            onUpdate(packet, layout);
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        if (lastPacket && Date.now() - lastPacket.at >= 12_000) {
          lastPacket = undefined;
          onUpdate(null, layout, true);
        } else if (failures === 2 && !lastPacket) onUpdate(null, layout, true);
      } finally {
        if (pending === controller) {
          pending = null;
          timer = setTimeout(poll, Math.min(4500, 1000 + failures * 600));
        }
      }
    }

    return next => {
      if (next?.startsAt === active?.startsAt && next?.name === active?.name) return;
      pending?.abort();
      pending = null;
      clearTimeout(timer);
      active = next;
      failures = 0;
      lastPacket = layout = layoutKey = undefined;
      if (next) poll();
    };
  }

  window.F1_LIVE_POSITIONS = { painter, follow };
})();
