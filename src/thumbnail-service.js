const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { nativeImage } = require('electron');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.tif', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rtf', '.html']);
const OFFICE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.pages', '.key', '.numbers']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const QUICK_LOOK_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...PDF_EXTENSIONS, ...TEXT_EXTENSIONS, ...OFFICE_EXTENSIONS]);

function naturalCompare(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
function containedSize(image, maximum = 512) {
  const { width, height } = image.getSize();
  if (!width || !height || Math.max(width, height) <= maximum) return null;
  return width >= height ? { width: maximum } : { height: maximum };
}
function xmlText(value) { return String(value).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
function cardSvg(title, body, accent = '#52677f') {
  const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const lines = String(body || '无法读取文档内容').slice(0, 900).match(/.{1,42}/g) || ['无法读取文档内容'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620"><rect width="900" height="620" fill="#f8fafc"/><rect width="900" height="94" fill="${accent}"/><text x="42" y="61" fill="white" font-family="-apple-system,Arial" font-size="34" font-weight="700">${esc(title)}</text>${lines.slice(0, 18).map((line, index) => `<text x="48" y="${150 + index * 25}" fill="#263241" font-family="-apple-system,Arial" font-size="22">${esc(line)}</text>`).join('')}</svg>`;
}

class ThumbnailService {
  constructor({ cacheDirectory, concurrency = 2, timeout = 8000, maxSourceSize = 1024 * 1024 * 1024 } = {}) {
    this.cacheDirectory = cacheDirectory; this.concurrency = concurrency; this.timeout = timeout; this.maxSourceSize = maxSourceSize;
    this.active = 0; this.queue = []; this.inflight = new Map();
  }
  async findFolderCover(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isFile() && (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || QUICK_LOOK_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))).sort((a, b) => naturalCompare(a.name, b.name));
    for (const entry of candidates.slice(0, 200)) {
      const candidate = path.join(directory, entry.name);
      return candidate;
    }
    return null;
  }
  async describe(source) {
    const stat = await fsp.stat(source); let previewSource = source; let folderCover = false; let children = [];
    if (stat.isDirectory()) {
      const names = await fsp.readdir(source).catch(() => []);
      children = names.sort(naturalCompare).slice(0, 5);
      previewSource = await this.findFolderCover(source); folderCover = Boolean(previewSource);
    }
    const result = previewSource ? await this.get(previewSource) : null;
    return { thumbnail: result?.key || null, previewKind: result?.kind || null, previewText: result?.text || null, folderCover, children, error: previewSource && !result ? 'UNAVAILABLE' : null };
  }
  async get(source) {
    const stat = await fsp.stat(source); if (!stat.isFile() || stat.size > this.maxSourceSize) return null;
    const extension = path.extname(source).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) && !QUICK_LOOK_EXTENSIONS.has(extension)) return null;
    if (TEXT_EXTENSIONS.has(extension)) return { key: null, kind: 'content', text: (await fsp.readFile(source, 'utf8')).slice(0, 1800) };
    if (OFFICE_EXTENSIONS.has(extension) && /^(\.docx|\.pptx|\.xlsx)$/.test(extension)) {
      const member = extension === '.docx' ? 'word/document.xml' : extension === '.pptx' ? 'ppt/slides/slide1.xml' : 'xl/sharedStrings.xml';
      return { key: null, kind: 'content', text: xmlText(await this.zipText(source, member)).slice(0, 1800) };
    }
    const key = crypto.createHash('sha256').update(`${path.resolve(source)}\0${stat.mtimeMs}\0${stat.size}`).digest('hex');
    const destination = path.join(this.cacheDirectory, `${key}.png`);
    if (fs.existsSync(destination)) return { key, kind: IMAGE_EXTENSIONS.has(extension) ? 'image' : TEXT_EXTENSIONS.has(extension) || OFFICE_EXTENSIONS.has(extension) ? 'content' : PDF_EXTENSIONS.has(extension) ? 'page' : 'frame' };
    if (!this.inflight.has(key)) this.inflight.set(key, this.enqueue(() => this.generate(source, destination, extension)).finally(() => this.inflight.delete(key)));
    const result = await this.inflight.get(key); return result ? { key, ...result } : null;
  }
  enqueue(task) { return new Promise((resolve) => { this.queue.push({ task, resolve }); this.drain(); }); }
  drain() { while (this.active < this.concurrency && this.queue.length) { const item = this.queue.shift(); this.active += 1; item.task().catch(() => null).then(item.resolve).finally(() => { this.active -= 1; this.drain(); }); } }
  async writeCard(destination, title, body) {
    const image = nativeImage.createFromBuffer(Buffer.from(cardSvg(title, body)));
    if (image.isEmpty()) return null;
    const size = containedSize(image);
    await fsp.writeFile(destination, (size ? image.resize({ ...size, quality: 'good' }) : image).toPNG()); return { kind: 'content', text: body };
  }
  async zipText(source, member) {
    return new Promise((resolve) => execFile('/usr/bin/unzip', ['-p', source, member], { timeout: this.timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout)));
  }
  async quickLook(source, destination, kind) {
    if (process.platform !== 'darwin') return null;
    const temporary = await fsp.mkdtemp(path.join(this.cacheDirectory, 'ql-'));
    try {
      await new Promise((resolve, reject) => execFile('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', temporary, source], { timeout: this.timeout }, (error) => {
        if (error) { error.previewCode = error.killed ? 'QUICK_LOOK_TIMEOUT' : 'QUICK_LOOK_FAILED'; reject(error); } else resolve();
      }));
      const output = (await fsp.readdir(temporary)).find((file) => file.toLowerCase().endsWith('.png'));
      if (!output) return null;
      const outputPath = path.join(temporary, output);
      const image = nativeImage.createFromPath(outputPath); if (image.isEmpty()) return null;
      await fsp.copyFile(outputPath, destination); return { kind };
    } finally { await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
  }
  async sips(source, destination) {
    if (process.platform !== 'darwin') return null;
    return new Promise((resolve) => execFile('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '512', source, '--out', destination], { timeout: this.timeout }, (error) => resolve(error ? null : { kind: 'image' })));
  }
  async generate(source, destination, extension) {
    await fsp.mkdir(this.cacheDirectory, { recursive: true });
    if (IMAGE_EXTENSIONS.has(extension)) {
      const image = nativeImage.createFromPath(source);
      if (!image.isEmpty()) {
        const size = containedSize(image);
        await fsp.writeFile(destination, (size ? image.resize({ ...size, quality: 'good' }) : image).toPNG()); return { kind: 'image' };
      }
      return (await this.sips(source, destination)) || this.quickLook(source, destination, 'image').catch(() => null);
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      const quickLook = await this.quickLook(source, destination, 'content').catch(() => null); if (quickLook) return quickLook;
      const text = (await fsp.readFile(source, 'utf8')).slice(0, 1800); return this.writeCard(destination, extension === '.md' || extension === '.markdown' ? 'Markdown' : 'Text', text);
    }
    if (OFFICE_EXTENSIONS.has(extension) && /^(\.docx|\.pptx|\.xlsx)$/.test(extension)) {
      const quickLook = await this.quickLook(source, destination, 'content').catch(() => null); if (quickLook) return quickLook;
      const member = extension === '.docx' ? 'word/document.xml' : extension === '.pptx' ? 'ppt/slides/slide1.xml' : 'xl/sharedStrings.xml';
      const raw = await this.zipText(source, member); const text = xmlText(raw).slice(0, 1800);
      return this.writeCard(destination, extension.slice(1).toUpperCase(), text || 'Office Open XML 文件，但没有可提取的文字内容');
    }
    if (process.platform !== 'darwin') return null;
    return this.quickLook(source, destination, PDF_EXTENSIONS.has(extension) ? 'page' : 'frame').catch(() => null);
  }
  pathForKey(key) { if (!/^[a-f0-9]{64}$/.test(String(key))) return null; const filePath = path.join(this.cacheDirectory, `${key}.png`); return fs.existsSync(filePath) ? filePath : null; }
  invalidate() { return fsp.rm(this.cacheDirectory, { recursive: true, force: true }).catch(() => {}); }
}
module.exports = { ThumbnailService, IMAGE_EXTENSIONS, QUICK_LOOK_EXTENSIONS, TEXT_EXTENSIONS, OFFICE_EXTENSIONS, containedSize };
