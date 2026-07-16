const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { nativeImage } = require('electron');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.tif', '.tiff']);
const QUICK_LOOK_EXTENSIONS = new Set(['.pdf', '.mov', '.mp4', '.m4v', '.avi', '.txt', '.rtf', '.md', '.html', '.pages', '.key', '.numbers', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

class ThumbnailService {
  constructor({ cacheDirectory, concurrency = 2, timeout = 8000, maxSourceSize = 1024 * 1024 * 1024 } = {}) {
    this.cacheDirectory = cacheDirectory;
    this.concurrency = concurrency;
    this.timeout = timeout;
    this.maxSourceSize = maxSourceSize;
    this.active = 0;
    this.queue = [];
    this.inflight = new Map();
  }

  async findFolderCover(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, 200).map((entry) => path.join(directory, entry.name))[0] || null;
  }

  async describe(source) {
    const stat = await fsp.stat(source);
    let previewSource = source;
    let folderCover = false;
    let children = [];
    if (stat.isDirectory()) {
      const names = await fsp.readdir(source).catch(() => []);
      children = names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).slice(0, 5);
      previewSource = await this.findFolderCover(source);
      folderCover = Boolean(previewSource);
    }
    const thumbnail = previewSource ? await this.get(previewSource) : null;
    return { thumbnail, folderCover, children };
  }

  async get(source) {
    const stat = await fsp.stat(source);
    if (!stat.isFile() || stat.size > this.maxSourceSize) return null;
    const extension = path.extname(source).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) && !QUICK_LOOK_EXTENSIONS.has(extension)) return null;
    const key = crypto.createHash('sha256').update(`${path.resolve(source)}\0${stat.mtimeMs}\0${stat.size}`).digest('hex');
    const destination = path.join(this.cacheDirectory, `${key}.png`);
    if (fs.existsSync(destination)) return key;
    if (!this.inflight.has(key)) this.inflight.set(key, this.enqueue(() => this.generate(source, destination, extension)).finally(() => this.inflight.delete(key)));
    return (await this.inflight.get(key)) ? key : null;
  }

  enqueue(task) {
    return new Promise((resolve) => { this.queue.push({ task, resolve }); this.drain(); });
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      this.active += 1;
      item.task().catch(() => false).then(item.resolve).finally(() => { this.active -= 1; this.drain(); });
    }
  }

  async generate(source, destination, extension) {
    await fsp.mkdir(this.cacheDirectory, { recursive: true });
    if (IMAGE_EXTENSIONS.has(extension)) {
      const image = nativeImage.createFromPath(source);
      if (image.isEmpty()) return false;
      await fsp.writeFile(destination, image.resize({ width: 512, height: 512, quality: 'good' }).toPNG());
      return true;
    }
    if (process.platform !== 'darwin') return false;
    const temporary = await fsp.mkdtemp(path.join(this.cacheDirectory, 'ql-'));
    try {
      await new Promise((resolve, reject) => execFile('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', temporary, source], { timeout: this.timeout }, (error) => error ? reject(error) : resolve()));
      const files = await fsp.readdir(temporary);
      const output = files.find((file) => file.endsWith('.png'));
      if (!output) return false;
      await fsp.rename(path.join(temporary, output), destination);
      return true;
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }

  pathForKey(key) {
    if (!/^[a-f0-9]{64}$/.test(String(key))) return null;
    const filePath = path.join(this.cacheDirectory, `${key}.png`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  invalidate() { return fsp.rm(this.cacheDirectory, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { ThumbnailService, IMAGE_EXTENSIONS, QUICK_LOOK_EXTENSIONS };
