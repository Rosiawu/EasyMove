const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function comparableFilePath(filePath, platform = process.platform) {
  const resolved = path.resolve(String(filePath));
  return platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

async function performExactBatchRename(changes, platform = process.platform) {
  const normalized = changes.map((change) => ({ source: path.resolve(change.source), destination: path.resolve(change.destination) }));
  const sourceSet = new Set(normalized.map((item) => comparableFilePath(item.source, platform)));
  const destinationSet = new Set();
  for (const item of normalized) {
    if (!fs.existsSync(item.source)) throw new Error(`${path.basename(item.source)}：原项目已不存在`);
    const comparableDestination = comparableFilePath(item.destination, platform);
    if (destinationSet.has(comparableDestination)) throw new Error(`${path.basename(item.destination)}：新名称重复`);
    destinationSet.add(comparableDestination);
    if (fs.existsSync(item.destination) && !sourceSet.has(comparableDestination)) throw new Error(`${path.basename(item.destination)}：同名项目已经存在`);
  }
  const staged = normalized.map((item) => ({ ...item, temporary: path.join(path.dirname(item.source), `.easymove-rename-${randomUUID()}`), finalized: false }));
  try {
    for (const item of staged) await fsp.rename(item.source, item.temporary);
    for (const item of staged) {
      await fsp.rename(item.temporary, item.destination);
      item.finalized = true;
    }
  } catch (error) {
    for (const item of [...staged].reverse()) {
      const current = item.finalized ? item.destination : item.temporary;
      if (fs.existsSync(current) && !fs.existsSync(item.source)) await fsp.rename(current, item.source).catch(() => {});
    }
    throw error;
  }
  return normalized;
}

function archiveType(filePath) {
  const lower = String(filePath).toLocaleLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.gz')) return 'gz';
  return null;
}

function archiveBaseName(filePath) {
  return path.basename(filePath).replace(/\.(tar\.gz|tgz|zip|tar|gz)$/i, '') || '解压内容';
}

function safeArchiveEntry(entry) {
  const normalized = String(entry || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '..');
}

module.exports = { comparableFilePath, performExactBatchRename, archiveType, archiveBaseName, safeArchiveEntry };
