import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { request } from './feeds.mjs';

const run = promisify(execFile);
const key = clip => clip.originalUrl || clip.url;
const read = (path, fallback) => readFile(path, 'utf8').then(JSON.parse).catch(() => fallback);

async function speechPython(cacheDir) {
  if (process.env.F1_RADIO_PYTHON) return process.env.F1_RADIO_PYTHON;
  if (!process.env.GITHUB_ACTIONS) return null;
  const environment = join(cacheDir, 'radio-runtime');
  const python = join(environment, 'bin', 'python');
  try {
    await access(join(environment, 'f1-ready'));
  } catch {
    await run('python3', ['-m', 'venv', environment], { timeout: 30_000 });
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'faster-whisper==1.2.1'], { timeout: 90_000 });
    await writeFile(join(environment, 'f1-ready'), '1');
  }
  return python;
}

async function translate(entry) {
  if (entry.language === 'zh') return entry.text;
  const chunks = entry.text.match(/.{1,140}(?:\s|$)|.{1,140}/gu) || [];
  const translated = [];
  for (const text of chunks) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.search = new URLSearchParams({ q: text, langpair: `${entry.language}|zh-CN` });
    const response = await request(url, { signal: AbortSignal.timeout(5000) }).then(value => value.json());
    const result = response.responseData?.translatedText;
    if (Number(response.responseStatus) !== 200 || response.quotaFinished || !/\p{Script=Han}/u.test(result || '')) return '';
    translated.push(result);
  }
  return translated.join(' ');
}

export async function populateRadioText({ clips, cacheDir, root }) {
  const file = join(cacheDir, 'radio-text.json');
  const entries = await read(file, {});
  const unique = [...new Map(clips.map(clip => [key(clip), clip])).values()];
  const now = Date.now();
  const pending = unique.filter(clip => {
    const saved = entries[key(clip)];
    return !saved?.text && (saved?.source !== clip.url || now - saved?.attempted > 6 * 3600_000);
  }).sort((first, second) => Number(Boolean(second.originalUrl)) - Number(Boolean(first.originalUrl))).slice(0, 48);
  if (pending.length) {
    try {
      const python = await speechPython(cacheDir);
      if (python) {
        const queue = join(cacheDir, 'radio-queue.json');
        const output = join(cacheDir, 'radio-text.ndjson');
        await writeFile(output, '');
        await writeFile(queue, JSON.stringify(pending.map(clip => ({ key: key(clip), url: clip.url }))));
        await run(python, [join(root, 'scripts', 'transcribe-radio.py'), queue, output, join(cacheDir, 'radio-models')],
          { timeout: 185_000 }).catch(error => console.warn(`Radio transcription: ${error.message.slice(0, 240)}`));
        for (const line of (await readFile(output, 'utf8')).trim().split('\n').filter(Boolean)) {
          const { url, source, text, language } = JSON.parse(line);
          entries[url] = text && language ? { text, language } : { source, attempted: now };
        }
      }
    } catch (error) {
      console.warn(`Radio transcription unavailable: ${error.message.slice(0, 240)}`);
    }
  }
  const translations = unique.map(clip => entries[key(clip)]).filter(entry => entry?.text && !entry.zh).slice(0, 48);
  for (let start = 0; start < translations.length; start += 8) {
    await Promise.allSettled(translations.slice(start, start + 8).map(async entry => {
      const zh = await translate(entry);
      if (zh) entry.zh = zh;
    }));
  }
  if (unique.length) await writeFile(file, JSON.stringify(entries));
  return clip => {
    const transcript = entries[key(clip)];
    return transcript?.text ? { ...clip, transcript } : clip;
  };
}
