import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execute = promisify(execFile);
let pdfRuntime;
async function pdfPython(directory) {
  if (process.env.F1_PDF_PYTHON) return process.env.F1_PDF_PYTHON;
  if (!process.env.GITHUB_ACTIONS) return 'python3';
  const environment = join(directory, 'pdf-runtime');
  const python = join(environment, 'bin', 'python');
  try {
    await execute(python, ['-c', 'import pypdfium2']);
  } catch {
    await execute('python3', ['-m', 'venv', environment], { timeout: 30_000 });
    await execute(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'pypdfium2'], { timeout: 60_000 });
  }
  return python;
}

export async function readPdfText(file, directory) {
  let pages;
  try {
    ({ stdout: pages } = await execute('pdftotext', ['-layout', file, '-'], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    pdfRuntime ??= pdfPython(directory);
    ({ stdout: pages } = await execute(await pdfRuntime, ['-c',
      'import sys, pypdfium2 as pdf; print("\\f".join(page.get_textpage().get_text_range() for page in pdf.PdfDocument(sys.argv[1])))', file], { maxBuffer: 16 * 1024 * 1024 }));
  }
  return pages;
}
