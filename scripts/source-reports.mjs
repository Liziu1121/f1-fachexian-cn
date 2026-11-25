import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { recentFiaDocuments, request } from './feeds.mjs';
import { readPdfText } from './pdf-text.mjs';

const events = {
  'Qatar Grand Prix': ['卡塔尔大奖赛', 'qatar'],
  'Las Vegas Grand Prix': ['拉斯维加斯大奖赛', 'las-vegas'],
  'São Paulo Grand Prix': ['圣保罗大奖赛', 'brazil'],
  'Abu Dhabi Grand Prix': ['阿布扎比大奖赛', 'abu-dhabi'],
  'Mexico City Grand Prix': ['墨西哥城大奖赛', 'mexico'],
  'United States Grand Prix': ['美国大奖赛', 'united-states'],
  'Singapore Grand Prix': ['新加坡大奖赛', 'singapore'],
  'Bahrain Grand Prix': ['巴林大奖赛', 'bahrain'],
  'Azerbaijan Grand Prix': ['阿塞拜疆大奖赛', 'azerbaijan'],
  'Spanish Grand Prix': ['西班牙大奖赛', 'spain'],
  'Italian Grand Prix': ['意大利大奖赛', 'italy'],
  'Dutch Grand Prix': ['荷兰大奖赛', 'netherlands'],
  'Hungarian Grand Prix': ['匈牙利大奖赛', 'hungary'],
  'Belgian Grand Prix': ['比利时大奖赛', 'belgium'],
  'British Grand Prix': ['英国大奖赛', 'great-britain'],
  'Austrian Grand Prix': ['奥地利大奖赛', 'austria'],
  'Barcelona-Catalunya Grand Prix': ['巴塞罗那大奖赛', 'barcelona-catalunya'],
  'Monaco Grand Prix': ['摩纳哥大奖赛', 'monaco'],
  'Canadian Grand Prix': ['加拿大大奖赛', 'canada'],
  'Miami Grand Prix': ['迈阿密大奖赛', 'miami'],
  'Japanese Grand Prix': ['日本大奖赛', 'japan'],
  'Chinese Grand Prix': ['中国大奖赛', 'china'],
  'Australian Grand Prix': ['澳大利亚大奖赛', 'australia'],
};
const sessionNames = {
  'Race': '正赛', 'Sprint': '冲刺赛', 'Qualifying': '排位赛', 'Sprint Qualifying': '冲刺排位赛',
  'Practice 1': '第一次练习赛', 'Practice 2': '第二次练习赛', 'Practice 3': '第三次练习赛',
  'Free Practice 1': '第一次练习赛', 'Free Practice 2': '第二次练习赛', 'Free Practice 3': '第三次练习赛',
};
const topics = [
  [/causing a collision|incident between car|contact with car/i, '车辆接触', 'on-track contact'],
  [/leaving the track.*advantage|lasting advantage/i, '驶离赛道并获利', 'leaving the track and gaining an advantage'],
  [/yellow flag/i, '黄旗程序', 'yellow flag procedures'],
  [/driving unnecessarily slowly|minimum time|maximum time/i, '车速或最低行驶时间', 'speed or minimum-time requirements'],
  [/erratic driving|driving erratically/i, '驾驶行为', 'driving conduct'],
  [/imped/i, '阻挡', 'impeding'],
  [/power unit|pu element|gearbox/i, '动力单元或变速箱更换', 'power unit or gearbox changes'],
  [/practice start/i, '练习发车程序', 'practice start procedures'],
  [/pit lane|pitlane|unsafe release/i, '维修区操作', 'pit-lane conduct'],
  [/track limit|deleted lap/i, '赛道限制', 'track limits'],
];
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const squash = value => value.trim().replace(/\s+/g, ' ');
const field = (text, label, stops) => {
  const match = text.match(new RegExp(`^[ \\t]*${label}[ \\t]+([\\s\\S]*?)(?=\\n[ \\t]*(?:${stops})\\b|(?![\\s\\S]))`, 'im'));
  return match ? squash(match[1]) : '';
};

function penalty(decision) {
  const grid = decision.match(/\b(\d+)\s+(?:grid\s+)?(?:positions?|places?)\b|\b(\d+)[- ]place grid\b/i);
  if (grid) {
    const places = grid[1] || grid[2];
    return [`发车位罚退 ${places} 位`, `a ${places}-place grid penalty`];
  }
  const seconds = decision.match(/\b(\d+)[ -]second\b/i)?.[1];
  if (seconds && /penalty/i.test(decision)) return [`罚时 ${seconds} 秒`, `a ${seconds}-second time penalty`];
  const fine = decision.match(/(?:EUR\s*|€\s*)([\d,. ]+)/i)?.[1].trim();
  if (fine && /fine/i.test(decision)) return [`罚款 ${fine} 欧元`, `a €${fine} fine`];
  if (/\bno further action\b|\bno action\b/i.test(decision)) return ['不采取进一步行动', 'no further action'];
  if (/\bdisqualif/i.test(decision)) return ['取消资格', 'disqualification'];
  if (/\breprimand/i.test(decision)) return ['训诫', 'a reprimand'];
  if (/\bwarning/i.test(decision)) return ['警告', 'a warning'];
  if (/\bstart\b.*\bpit lane\b/i.test(decision)) return ['从维修区发车', 'a pit-lane start'];
  return null;
}

export function fiaCase(document, pdf) {
  const pdfText = pdf.replace(/\r\n?/g, '\n').replace(/[\u00A0\u202F]/g, ' ');
  const doc = document.title.match(/^Doc\s+(\d+)/i)?.[1];
  const year = /\/20(\d{2})_/.exec(document.url)?.[1];
  const event = events[document.event];
  const car = pdfText.match(/^\s*No\s*\/\s*Driver\s+(\d{1,3})\s*[-–]\s*([^\n]+)/im);
  const session = pdfText.match(/^\s*Session[ \t]+([^\n]+)/im)?.[1].trim();
  const incident = field(pdfText, 'Fact', 'Infringement|Offence|Decision|Reason');
  const decision = field(pdfText, 'Decision', 'Reason|Competitors|The Stewards');
  const reason = field(pdfText, 'Reason', 'Competitors|Decisions of|The Stewards$');
  const outcome = penalty(decision);
  const topic = topics.find(([pattern]) => pattern.test(document.title) || pattern.test(incident));
  if (!event || !car || !doc || !year || !outcome || !topic || !sessionNames[session]) return null;
  const [eventZh, round] = event;
  const [, topicZh, topicEn] = topic;
  const [, carNumber, driver] = car;
  const [outcomeZh, outcomeEn] = outcome;
  const nextRace = /next race/i.test(decision) && /grid/i.test(decision);
  const applicationZh = nextRace ? '这项罚退将在车手下一次参加正赛时执行。' : '';
  const applicationEn = nextRace ? 'The grid penalty applies at the next race in which the driver takes part.' : '';
  const turn = incident.match(/\bturn\s+(\d{1,2})\b/i)?.[1];
  const otherCars = [...new Set([...incident.matchAll(/\bcar\s+(\d{1,3})\b/gi)].map(match => match[1]))].filter(n => n !== carNumber);
  const trackZh = [turn && `事发位置是 ${turn} 号弯`, otherCars.length && `裁决的事由部分还提到 ${otherCars.join('、')} 号车`].filter(Boolean).join('，');
  const trackEn = [turn && `The fact section locates the incident at Turn ${turn}.`,
    otherCars.length && `It also identifies car ${otherCars.join(' and car ')}.`].filter(Boolean).join(' ');
  const evidence = [
    [/\bonboard\b|in-car video/i, '车载录像', 'onboard footage'],
    [/\btiming\b/i, '计时记录', 'timing records'],
    [/\bheard from\b/i, '当事人陈述', 'testimony'],
    [/\btelemetry\b/i, '遥测数据', 'telemetry'],
  ].filter(([pattern]) => pattern.test(reason));
  const points = decision.match(/\b(\d+)\s+penalty points?\b/i)?.[1];
  return {
    id: 'fia-' + hash(document.url), date: new Date(document.date).toISOString(), round, source: 'FIA',
    titleZh: `${eventZh}裁决 · ${carNumber} 号车：${outcomeZh}`,
    titleEn: `${document.event} ruling · Car ${carNumber}: ${outcomeEn}`,
    fullTextZh: [
      `${driver.trim()} 驾驶的 ${carNumber} 号车在${sessionNames[session]}涉及${topicZh}。赛事干事对这一事件作出的决定是${outcomeZh}${points ? `，并记 ${points} 个处罚积分` : ''}。`,
      trackZh && trackZh + '。',
      applicationZh,
      evidence.length && `裁决理由列出的材料包括${evidence.map(entry => entry[1]).join('、')}。`,
      `这项决定刊载于 20${year} 年${eventZh} FIA 第 ${doc} 号文件，针对该场次的这一件事件。`,
    ].filter(Boolean),
    fullTextEn: [
      `The stewards examined ${topicEn} involving ${driver.trim()} in car ${carNumber} during the ${session.toLowerCase()}. The outcome was ${outcomeEn}${points ? `, plus ${points} penalty points` : ''}.`,
      trackEn,
      applicationEn,
      evidence.length && `The stewards’ reasons refer to ${evidence.map(entry => entry[2]).join(', ')}.`,
      `The decision is recorded in document ${doc} of the 20${year} ${document.event} and applies to this specific incident.`,
    ].filter(Boolean),
  };
}

async function readDecision(doc, cacheDir) {
  const bytes = Buffer.from(await request(doc.url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/pdf' } }).then(response => response.arrayBuffer()));
  if (bytes.length > 4 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') return null;
  const file = join(cacheDir, hash(doc.url) + '.pdf');
  await writeFile(file, bytes);
  try { return fiaCase(doc, await readPdfText(file, cacheDir)); }
  finally { await rm(file, { force: true }); }
}

async function recentCases(cacheDir, now, seeded) {
  const path = join(cacheDir, 'fia-news-cases.json');
  const saved = { ...seeded, ...await readFile(path, 'utf8').then(JSON.parse).catch(() => ({})) };
  const year = new Date(now).getUTCFullYear();
  const cutoff = Date.UTC(year, 0, 1);
  const docs = await recentFiaDocuments(year).catch(error => {
    console.warn('FIA newsroom:', error.message);
    return [];
  });
  const pending = docs.filter(doc => events[doc.event] && doc.date <= now && doc.date >= cutoff &&
    /\b(?:infringement|decision)\b/i.test(doc.title) && /\bcar\s*\d+\b/i.test(doc.title) &&
    !Object.hasOwn(saved, doc.url)).sort((a, b) => b.date - a.date).slice(0, 30);
  for (let i = 0; i < pending.length; i += 5) {
    await Promise.all(pending.slice(i, i + 5).map(async doc => {
      try { saved[doc.url] = await readDecision(doc, cacheDir); }
      catch (error) { console.warn(`FIA decision ${doc.title}: ${error.message}`); }
    }));
  }
  if (pending.length) await writeFile(path, JSON.stringify(saved) + '\n');
  return Object.values(saved).filter(Boolean);
}

export async function sourceReports(root, cacheDir, media, now = Date.now()) {
  await mkdir(cacheDir, { recursive: true });
  const archive = await readFile(join(root, 'content', 'fia-news-archive.json'), 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const [briefings, cases] = await Promise.all([
    readFile(join(root, 'content', 'source-reports.json'), 'utf8').then(JSON.parse),
    recentCases(cacheDir, now, archive),
  ]);
  const notes = {};
  const items = [...briefings, ...cases].filter(report => Date.parse(report.date) <= now).map(report => {
    const { id, date, round, source, titleZh, titleEn, fullTextZh, fullTextEn } = report;
    notes[id] = { title: titleZh, fullTextZh, fullTextEn };
    return [id, new Date(date).toISOString(), titleEn, '', source === 'FIA' ? '赛事公告与裁决' : '车队与技术动态',
      media[round]?.photos?.[0]?.image || '', { title: titleZh }, { source, round, dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(date) }];
  });
  console.log(`Newsroom: ${briefings.length} source-based articles, ${cases.length} verified FIA decisions.`);
  return { items, notes };
}
