import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from './feeds.mjs';

const releases = {
  'pdf.mjs': '43c67d941a73a2d65be72c97f5e68d9a7963df53b219cc1c0aa85f2b8bd1c9bd',
  'pdf.worker.mjs': '08ee175af31a8537ee0ddee910717db78c6751e2016c4ddc3f033d5047ed5aa0',
};
const valid = (file, hash) => file && createHash('sha256').update(file).digest('hex') === hash;

export async function installPdfReader(site, cacheDir) {
  const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/';
  const destination = join(site, 'pdf-reader');
  const cache = join(cacheDir, 'pdfjs-5.6.205');
  try {
    await Promise.all([mkdir(destination, { recursive: true }), mkdir(cache, { recursive: true })]);
    await Promise.all(Object.entries(releases).map(async ([name, hash]) => {
      const local = join(cache, name);
      let file = await readFile(local).catch(() => null);
      if (!valid(file, hash)) {
        file = Buffer.from(await request(base + 'build/' + name, { signal: AbortSignal.timeout(25_000) })
          .then(response => response.arrayBuffer()));
        if (!valid(file, hash)) throw new Error(`Invalid PDF.js asset: ${name}`);
        await writeFile(local, file);
      }
      await writeFile(join(destination, name), file);
    }));
    const license = await readFile(join(cache, 'LICENSE')).catch(async () => {
      const text = await request(base + 'LICENSE').then(response => response.text());
      await writeFile(join(cache, 'LICENSE'), text);
      return text;
    });
    await writeFile(join(destination, 'LICENSE'), license);
  } catch (error) {
    console.warn(`PDF translation runtime unavailable: ${error.message}`);
  }
}
