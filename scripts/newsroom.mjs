import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const names = {
  australia: '澳大利亚', china: '中国', japan: '日本', miami: '迈阿密', canada: '加拿大', monaco: '摩纳哥',
  'barcelona-catalunya': '巴塞罗那－加泰罗尼亚', austria: '奥地利', 'great-britain': '英国',
  belgium: '比利时', hungary: '匈牙利', netherlands: '荷兰', italy: '意大利', spain: '西班牙',
  azerbaijan: '阿塞拜疆', bahrain: '巴林', singapore: '新加坡', 'united-states': '美国',
  mexico: '墨西哥城', brazil: '圣保罗', 'las-vegas': '拉斯维加斯', qatar: '卡塔尔', 'abu-dhabi': '阿布扎比',
};
const englishNames = { 'great-britain': 'British', brazil: 'São Paulo', mexico: 'Mexico City' };
const sessionNames = {
  fp1: ['第一次练习赛', 'Practice 1'], fp2: ['第二次练习赛', 'Practice 2'],
  fp3: ['第三次练习赛', 'Practice 3'], sq: ['冲刺排位赛', 'Sprint Qualifying'],
  sprint: ['冲刺赛', 'Sprint'], q: ['排位赛', 'Qualifying'], race: ['正赛', 'Race'],
};
const chineseDrivers = {
  ALB: '阿尔本', ALO: '阿隆索', ANT: '安东内利', ARO: '阿隆', BEA: '贝尔曼', BEG: '贝加诺维奇',
  BOR: '博托莱托', BOT: '博塔斯', BRO: '布朗宁', CAM: '卡马拉', COL: '科拉平托', CRA: '克劳福德',
  FOR: '福纳罗利', GAS: '加斯利', HAD: '哈贾尔', HAM: '汉密尔顿', HER: '赫塔', HIR: '平川亮',
  HUL: '霍肯伯格', IWA: '岩佐步梦', LAW: '劳森', LEC: '勒克莱尔', LIN: '林德布拉德', MIN: '米尼',
  NOR: '诺里斯', OCO: '奥康', PER: '佩雷兹', PIA: '皮亚斯特里', RUS: '拉塞尔', SAI: '塞恩斯',
  SLA: '斯莱特', STR: '斯托尔', TSO: '措洛夫', TSU: '角田裕毅', VER: '维斯塔潘', VES: '韦斯蒂',
};
const chineseTeams = {
  'Aston Martin': '阿斯顿·马丁', 'Haas F1 Team': '哈斯', 'Racing Bulls': '红牛二队', 'Red Bull Racing': '红牛',
  Alpine: 'Alpine', Audi: '奥迪', Cadillac: '凯迪拉克', Ferrari: '法拉利', McLaren: '迈凯伦',
  Mercedes: '梅赛德斯', Williams: '威廉姆斯',
};
const statuses = { DNF: '退赛', DNS: '未出发', DSQ: '取消资格', DQ: '取消资格', NC: '未获名次' };
const driver = (row, en) => (en ? '' : chineseDrivers[row[2].match(/\s([A-Z]{3})$/)?.[1]]) ||
  row[2].replace(/\s+[A-Z]{3}$/, '').trim();
const team = (row, en) => (en ? '' : chineseTeams[row[3]]) || row[3];
const result = (value, en) => (en ? '' : statuses[value]) || value || '—';
const numeric = value => /^\d+$/.test(value || '');
const timed = value => /^\d+:\d{2}\.\d+$/.test(value || '');
const local = (en, zh, english) => en ? english : zh;

function classification(rows, kind, en) {
  const race = kind === 'race' || kind === 'sprint';
  const qualifying = kind === 'q' || kind === 'sq';
  const segments = kind === 'sq' ? ['SQ1', 'SQ2', 'SQ3'] : ['Q1', 'Q2', 'Q3'];
  const header = en ? ['Pos.', 'No.', 'Driver', 'Team'] : ['名次', '车号', '车手', '车队'];
  if (race) header.push(...(en ? ['Laps', 'Time / status', 'Points'] : ['圈数', '用时 / 状态', '积分']));
  else if (qualifying) header.push(...segments, en ? 'Laps' : '圈数');
  else header.push(...(en ? ['Time / gap', 'Laps'] : ['用时 / 差距', '圈数']));
  return {
    header,
    rows: rows.map(row => [result(row[0], en), row[1], driver(row, en), team(row, en),
      ...row.slice(4, race ? 7 : qualifying ? 8 : 6).map(value => result(value, en))]),
  };
}

function raceReport({ event, rows, top, grid, qualifying, en, sprint }) {
  const [winner, second, third] = top;
  const body = [];
  body.push(local(en,
    `${driver(winner, en)}驾驶${team(winner, en)}赛车赢得${event}。${team(second, en)}的${driver(second, en)}拿到第二，${team(third, en)}的${driver(third, en)}位列第三。`,
    `${driver(winner, en)} won the ${event} for ${team(winner, en)}. ${driver(second, en)} finished second for ${team(second, en)}, with ${driver(third, en)} third for ${team(third, en)}.`));
  body.push(local(en,
    `冠军完成 ${winner[4]} 圈，用时 ${winner[5]}。第二、第三名在成绩表上的差距分别为 ${second[5]} 和 ${third[5]}。`,
    `The winner covered ${winner[4]} laps in ${winner[5]}. The recorded gaps for second and third place were ${second[5]} and ${third[5]}, respectively.`));
  if (qualifying?.[0]?.[2]) {
    const pole = qualifying[0];
    const same = pole[1] === winner[1];
    const label = local(en, sprint ? '冲刺排位赛' : '排位赛', sprint ? 'Sprint Qualifying' : 'Qualifying');
    body.push(local(en,
      `${label}榜首是${driver(pole, en)}。${same ? '这名车手随后拿到了比赛胜利。' : `最终夺冠的是${driver(winner, en)}。`}`,
      `${driver(pole, en)} led ${label}. ${same ? 'The same driver went on to win the race.' : `${driver(winner, en)} took the race victory.`}`));
  }
  const starters = new Map(grid.filter(row => numeric(row[0])).map(row => [row[1], Number(row[0])]));
  const gains = rows.filter(row => numeric(row[0]) && starters.get(row[1]) > Number(row[0]))
    .map(row => ({ row, from: starters.get(row[1]), to: Number(row[0]) }))
    .sort((a, b) => (b.from - b.to) - (a.from - a.to));
  if (gains.length) {
    const { row, from, to } = gains[0];
    body.push(local(en, `${driver(row, en)}从第 ${from} 位发车，最终拿到第 ${to} 名，净升 ${from - to} 位。`,
      `${driver(row, en)} started from P${from} on the grid and finished in P${to}, a gain of ${from - to} positions.`));
  }
  const scorers = rows.filter(row => Number(row[6]) > 0);
  if (scorers.length) body.push(local(en,
    `共有 ${scorers.length} 名车手得分，前三名分别拿到 ${winner[6]}、${second[6]} 和 ${third[6]} 分。`,
    `${scorers.length} drivers scored points. The first three earned ${winner[6]}, ${second[6]} and ${third[6]} points respectively.`));
  const outside = rows.filter(row => statuses[row[0]] || statuses[row[5]]);
  if (outside.length) {
    const entries = outside.map(row => `${driver(row, en)}（${result(statuses[row[5]] ? row[5] : row[0], en)}）`);
    body.push(local(en, `成绩表共列出 ${rows.length} 名车手，特殊状态为${entries.join('、')}。`,
      `The ${rows.length}-driver results list recorded the following statuses: ${entries.map(s=>s.replace('（', ' (').replace('）', ')')).join(', ')}.`));
  }
  return body;
}

function qualifyingReport({ event, rows, top, earlier, en, sprint }) {
  const [first, second, third] = top;
  if (!top.every(row => timed(row[6]))) return [];
  const label = sprint ? 'SQ3' : 'Q3';
  const body = [
    local(en,
      `${driver(first, en)}驾驶${team(first, en)}赛车在${event}排名第一，以 ${first[6]} 拿到 ${label} 最快成绩。`,
      `${driver(first, en)} topped ${event} for ${team(first, en)} with a ${first[6]} in ${label}.`),
    local(en,
      `${team(second, en)}的${driver(second, en)}以 ${second[6]} 位居第二，${team(third, en)}的${driver(third, en)}以 ${third[6]} 位居第三。`,
      `${driver(second, en)} was second for ${team(second, en)} in ${second[6]}. ${driver(third, en)} put ${team(third, en)} third in ${third[6]}.`),
  ];
  for (const [column, segment] of [[4, sprint ? 'SQ1' : 'Q1'], [5, sprint ? 'SQ2' : 'Q2']]) {
    const fastest = rows.filter(row => timed(row[column])).reduce((best, row) =>
      !best || lapSeconds(row[column]) < lapSeconds(best[column]) ? row : best, null);
    if (fastest) body.push(local(en,
      `${segment}最快的是${driver(fastest, en)}，用时 ${fastest[column]}。`,
      `${driver(fastest, en)} set the fastest time in ${segment}, a ${fastest[column]}.`));
  }
  if (earlier?.[2] && timed(earlier[4])) body.push(local(en,
    `上一场练习由${driver(earlier, en)}领跑，圈速为 ${earlier[4]}。`,
    `${driver(earlier, en)} had led the preceding practice session with a ${earlier[4]}.`));
  return body;
}

function lapSeconds(value) {
  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
}

function practiceReport({ event, rows, top, earlier, en }) {
  const [first, second, third] = top;
  if (!timed(first[4]) || !second[4] || !third[4]) return [];
  const body = [
    local(en,
      `${driver(first, en)}驾驶${team(first, en)}赛车在${event}领跑，最快圈为 ${first[4]}，共完成 ${first[5]} 圈。`,
      `${driver(first, en)} led ${event} for ${team(first, en)}. The fastest lap was ${first[4]} in a ${first[5]}-lap session for the driver.`),
    local(en,
      `${driver(second, en)}和${driver(third, en)}分列第二、第三，成绩表记录的差距分别为 ${second[4]} 和 ${third[4]}。`,
      `${driver(second, en)} and ${driver(third, en)} placed second and third, with recorded gaps of ${second[4]} and ${third[4]} respectively.`),
  ];
  const measured = rows.filter(row => numeric(row[5]));
  if (measured.length) {
    const most = Math.max(...measured.map(row => Number(row[5])));
    const leaders = measured.filter(row => Number(row[5]) === most).map(row => driver(row, en));
    const total = measured.reduce((sum, row) => sum + Number(row[5]), 0);
    body.push(local(en,
      `成绩表共记录 ${total} 圈。完成圈数最多的是${leaders.join('、')}，各跑了 ${most} 圈。`,
      `The classification records ${total} laps. ${leaders.join(' and ')} completed the largest lap count, with ${most} each.`));
  }
  if (earlier?.[2] && timed(earlier[4])) body.push(local(en,
    `上一场练习的榜首是${driver(earlier, en)}，最快圈为 ${earlier[4]}。`,
    `${driver(earlier, en)} had led the preceding practice session with a ${earlier[4]}.`));
  return body;
}

async function resultsFor(site, round, kind, fallback = []) {
  try {
    const snapshot = JSON.parse(await readFile(join(site, 'api', 'results', round, kind + '.json'), 'utf8'));
    if (snapshot.rows?.length >= 3) return snapshot.rows;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read ${round} ${kind} result: ${error.message}`);
  }
  return fallback;
}
function time(stamp, en) {
  return new Intl.DateTimeFormat(en ? 'en-GB' : 'zh-CN', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Shanghai', hourCycle: 'h23',
  }).format(new Date(stamp));
}

export async function writeReports(site, media, now = Date.now()) {
  const script = await readFile(join(site, 'data.js'), 'utf8');
  const source = script.match(/window\.F1_DATA\s*=\s*(\{[^\r\n]+\});/)?.[1];
  if (!source) return { items: [], notes: {} };
  const data = JSON.parse(source);
  const items = [], notes = {};
  const races = Object.entries(data.races).filter(([key]) => names[key])
    .sort(([, a], [, b]) => Date.parse(a.sessions.race) - Date.parse(b.sessions.race));
  function add(id, stamp, titles, fullTextZh, fullTextEn, key, kind, classificationData) {
    const cover = media[key]?.photos?.[0]?.image || '';
    notes[id] = { title: titles[0], fullTextZh, fullTextEn, classification: classificationData };
    items.push([id, new Date(stamp).toISOString(), titles[1], '', kind, cover, { title: titles[0] }, { source: 'F1 发车线' }]);
  }

  for (const [key, race] of races) {
    const zh = names[key] + '大奖赛';
    const en = (englishNames[key] || key.replace(/(^|-)([a-z])/g, (_, separator, letter) =>
      (separator ? ' ' : '') + letter.toUpperCase())) + ' Grand Prix';
    const end = Date.parse(race.sessions.race);
    if (!Number.isFinite(end)) continue;
    const starts = Object.entries(race.sessions).filter(([kind, stamp]) => sessionNames[kind] && Number.isFinite(Date.parse(stamp)))
      .sort(([, a], [, b]) => Date.parse(a) - Date.parse(b));
    if (end >= now && end - now < 9 * 86400_000 && starts.length) {
      const opener = starts[0][1];
      const zhTimes = starts.map(([k, stamp]) => `${sessionNames[k][0]} ${time(stamp, false)}`).join('、');
      const enTimes = starts.map(([k, stamp]) => `${sessionNames[k][1]} at ${time(stamp, true)}`).join('; ');
      const raceDate = Math.min(Date.parse(opener) - 3 * 86400_000, now);
      add('preview-' + key, raceDate, [zh + '周末前瞻', en + ' weekend preview'], [
        `F1 将于北京时间 ${time(opener, false)} 开启${zh}周末，正赛定于 ${time(end, false)} 发车。正赛安排 ${race.laps} 圈，单圈长度为 ${race.length}。`,
        `赛程按北京时间排列：${zhTimes}。`,
        starts.some(([kind]) => kind === 'sprint') ? '本站设有冲刺赛。冲刺排位赛决定冲刺赛的发车顺序，正赛另有排位赛。' :
          '本站采用常规赛制。练习赛提供设置赛车和了解轮胎的机会，排位赛成绩是正赛发车顺序的基础，罚退等决定可能改变最终发车位。',
      ], [
        `The ${en} weekend opens at ${time(opener, true)} Beijing time, with the Grand Prix scheduled for ${time(end, true)}. The race is set for ${race.laps} laps of the ${race.length} circuit.`,
        `Schedule in Beijing time: ${enTimes}.`,
        starts.some(([kind]) => kind === 'sprint') ? 'This is a Sprint weekend. Sprint Qualifying sets the Sprint grid. The Grand Prix has its own qualifying session.' :
          'This is a conventional weekend. Practice allows teams to work on car setup and tyre behaviour. Qualifying determines the provisional race grid, subject to grid penalties and other decisions.',
      ], key, '赛事前瞻');
    }
    const completed = starts.filter(([, stamp]) => Date.parse(stamp) < now);
    const snapshots = await Promise.all([...completed.map(([kind]) => kind), 'grid'].map(async kind =>
      [kind, await resultsFor(site, key, kind, data.results[key]?.[kind])]));
    const byKind = Object.fromEntries(snapshots);
    const ranked = (rows, place) => rows?.find(row => String(row[0]) === place && typeof row[2] === 'string');
    let earlier;
    for (const [kind, stamp] of completed) {
      const rows = byKind[kind].filter(row => typeof row[2] === 'string' && row[2].trim() && row.length >= (kind === 'race' || kind === 'sprint' ? 7 : kind === 'q' || kind === 'sq' ? 8 : 6));
      const top = ['1', '2', '3'].map(place => ranked(rows, place));
      if (top.some(row => !row)) {
        // The FIA confirmed that rain prevented any timed classification in this session.
        if (key === 'las-vegas' && kind === 'fp1') {
          add('report-las-vegas-fp1', Date.parse(stamp), ['拉斯维加斯第一次练习赛因积水无计时成绩',
            'Standing water leaves Las Vegas first practice without a timed result'], [
            '拉斯维加斯大奖赛首场练习在湿滑的街道赛道上进行。尽管有车手短暂驶出维修区，FIA 确认全场没有有效计时圈，因此首练没有可用于比较的圈速排名。',
            '佩雷兹率先试跑。维斯塔潘、哈贾尔等车手随后也短暂驶上赛道检查路面，但这些尝试没有形成有效的计时圈。',
            '本站是常规赛制，第二场练习随后照常列入周末赛程。首练的出场顺序只能说明车手何时试跑，无法用来判断各队的速度差距。',
          ], [
            'The Las Vegas Grand Prix opened with first practice on a wet street circuit. Several drivers left the pits briefly, but the FIA confirmed there were no valid timed laps, so the session produced no ranking by lap time.',
            'Sergio Perez was the first to sample the circuit. Max Verstappen and Isack Hadjar were among those who later ventured out to assess conditions without recording a valid lap time.',
            'The weekend followed the regular format and second practice was next on the schedule. The order in which drivers went out in FP1 shows when they sampled the track and provides no measure of the teams’ relative pace.',
          ], key, '第一次练习赛报道');
        }
        continue;
      }
      const raceSession = kind === 'race' || kind === 'sprint';
      const qualifier = kind === 'q' || kind === 'sq';
      const sprint = kind === 'sprint' || kind === 'sq';
      const [zhSession, enSession] = sessionNames[kind];
      const category = kind === 'race' ? '分站赛报' : zhSession + '报道';
      const zhEvent = zh + zhSession;
      const enEvent = en + ' ' + enSession;
      const writeBody = raceSession ? raceReport : qualifier ? qualifyingReport : practiceReport;
      const report = { rows, top, earlier, sprint, grid: kind === 'race' ? byKind.grid : [],
        qualifying: byKind[sprint ? 'sq' : 'q'] };
      const zhText = writeBody({ ...report, en: false, event: zhEvent });
      const enText = writeBody({ ...report, en: true, event: enEvent });
      if (!raceSession && !qualifier) earlier = top[0];
      if (!zhText.length || !enText.length) continue;
      const zhResult = raceSession ? '夺冠' : qualifier ? '夺得头名' : '领跑';
      const enTitle = raceSession ? `${driver(top[0], true)} wins the ${kind === 'race' ? en : enEvent}` :
        `${driver(top[0], true)} leads ${enEvent}`;
      add(kind === 'race' ? 'report-' + key : `report-${key}-${kind}`, Date.parse(stamp),
        [`${zhEvent} · ${driver(top[0], false)}${zhResult}`, enTitle], zhText, enText, key, category,
        { zh: classification(rows, kind, false), en: classification(rows, kind, true) });
    }
  }
  return { items, notes };
}
