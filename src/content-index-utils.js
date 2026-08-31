const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.css', '.csv', '.json', '.xml', '.yaml', '.yml',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp',
  '.swift', '.sh', '.zsh', '.fish', '.sql', '.log', '.ini', '.toml', '.tex', '.rtf'
]);
const OOXML_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const MAX_CONTENT_BYTES = 256 * 1024;

function chineseBigrams(value) {
  const groups = String(value || '').match(/[\u3400-\u9fff]+/g) || [];
  const terms = [];
  for (const group of groups) {
    if (group.length === 1) terms.push(group);
    for (let index = 0; index < group.length - 1; index += 1) terms.push(group.slice(index, index + 2));
  }
  return [...new Set(terms)];
}

function indexedText(value) {
  const text = String(value || '').replace(/\0/g, ' ').slice(0, MAX_CONTENT_BYTES);
  const bigrams = chineseBigrams(text);
  return bigrams.length ? `${text}\n${bigrams.join(' ')}` : text;
}

function ftsQuery(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const chinese = chineseBigrams(input);
  const plain = input
    .replace(/[\u3400-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean);
  return [...chinese, ...plain].map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

function shouldSkipDirectory(name, fullPath) {
  const lower = String(name || '').toLocaleLowerCase();
  if (['.git', '.svn', '.hg', 'node_modules', '__pycache__', 'library'].includes(lower)) return true;
  if (lower.startsWith('.') && lower !== '.obsidian') return true;
  const normalized = String(fullPath || '').replaceAll('\\', '/').toLocaleLowerCase();
  return normalized.includes('/.git/') || normalized.includes('/node_modules/') || normalized.includes('/library/');
}

function xmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve) => execFile(command, args, { timeout: 8000, maxBuffer: MAX_CONTENT_BYTES * 2, ...options }, (error, stdout) => resolve(error ? '' : String(stdout || ''))));
}

async function extractOoxml(filePath, extension) {
  const patterns = extension === '.docx'
    ? ['word/document.xml']
    : extension === '.pptx'
      ? ['ppt/slides/*.xml']
      : ['xl/sharedStrings.xml', 'xl/worksheets/*.xml'];
  const chunks = [];
  for (const pattern of patterns) chunks.push(await execFileText('/usr/bin/unzip', ['-p', filePath, pattern]));
  return xmlText(chunks.join(' ')).slice(0, MAX_CONTENT_BYTES);
}

async function extractContent(filePath, stat) {
  const extension = path.extname(filePath).toLocaleLowerCase();
  if (!stat?.isFile() || stat.size > 32 * 1024 * 1024) return { content: '', truncated: false };
  try {
    if (TEXT_EXTENSIONS.has(extension)) {
      const handle = await fsp.open(filePath, 'r');
      try {
        const length = Math.min(stat.size, MAX_CONTENT_BYTES);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, 0);
        return { content: buffer.toString('utf8').replace(/\0/g, ' '), truncated: stat.size > length };
      } finally { await handle.close(); }
    }
    if (OOXML_EXTENSIONS.has(extension)) return { content: await extractOoxml(filePath, extension), truncated: stat.size > MAX_CONTENT_BYTES };
    if (extension === '.pdf' && process.platform === 'darwin') {
      const metadata = await execFileText('/usr/bin/mdls', ['-raw', '-name', 'kMDItemTextContent', filePath]);
      const content = metadata === '(null)' ? '' : metadata;
      return { content: content.slice(0, MAX_CONTENT_BYTES), truncated: content.length > MAX_CONTENT_BYTES };
    }
  } catch {}
  return { content: '', truncated: false };
}

module.exports = {
  MAX_CONTENT_BYTES,
  TEXT_EXTENSIONS,
  OOXML_EXTENSIONS,
  chineseBigrams,
  indexedText,
  ftsQuery,
  shouldSkipDirectory,
  xmlText,
  extractContent
};
