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
const driver = row => row[2].replace(/\s+[A-Z]{3}$/, '').trim();
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
  function add(id, stamp, titles, fullTextZh, fullTextEn, key, kind) {
    const cover = media[key]?.photos?.[0]?.image || '';
    notes[id] = { title: titles[0], fullTextZh, fullTextEn };
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
    if (end > now) continue;
    let rows = data.results[key]?.race;
    try {
      const snapshot = JSON.parse(await readFile(join(site, 'api', 'results', key, 'race.json'), 'utf8'));
      if (snapshot.rows?.length >= 3) rows = snapshot.rows;
    } catch { /* Older rounds are bundled in the calendar snapshot. */ }
    const podium = ['1', '2', '3'].map(place => rows?.find(row => String(row[0]) === place));
    if (podium.some(row => !row || typeof row[2] !== 'string')) continue;
    const [winner, second, third] = podium;
    const away = rows.filter(row => ['DNF', 'DNS', 'DSQ', 'NC'].includes(String(row[0]))).length;
    add('report-' + key, end, [`${zh}赛报 · ${driver(winner)} 夺冠`, `${driver(winner)} wins the ${en}`], [
      `${driver(winner)} 驾驶 ${winner[3]} 赛车赢得${zh}。 ${driver(second)} 和 ${driver(third)} 分别代表 ${second[3]} 和 ${third[3]} 拿到第二名和第三名。`,
      `冠军完成 ${winner[4]} 圈，总用时为 ${winner[5]}。第二和第三名的官方成绩差距分别为 ${second[5]} 和 ${third[5]}。`,
      `前三名分别获得 ${winner[6]}、${second[6]} 和 ${third[6]} 分。成绩表共列出 ${rows.length} 名车手，其中 ${away} 名未完赛、未出发、被取消资格或未获名次。`,
    ], [
      `${driver(winner)} won the ${en} for ${winner[3]}. ${driver(second)} and ${driver(third)} took second and third for ${second[3]} and ${third[3]} respectively.`,
      `The winner completed ${winner[4]} laps in ${winner[5]}. The official results record gaps of ${second[5]} and ${third[5]} for the other two podium finishers.`,
      `The top three earned ${winner[6]}, ${second[6]} and ${third[6]} points respectively. The results list ${rows.length} drivers, including ${away} recorded as retired, non-starting, disqualified or unclassified.`,
    ], key, '分站赛报');
  }
  return { items, notes };
}
