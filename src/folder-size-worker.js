const { parentPort } = require('node:worker_threads');
const fsp = require('node:fs/promises');
const path = require('node:path');

async function measureDirectory(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    try {
      const stat = await fsp.lstat(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const childSize = await measureDirectory(entryPath);
        if (childSize !== null) total += childSize;
      } else if (stat.isFile()) {
        total += stat.size;
      }
    } catch {
      // A changing or partially unreadable tree should not fail the batch.
    }
  }
  return total;
}

async function measureDirectories(paths) {
  return Promise.all(paths.map(async (directory) => ({
    path: directory,
    size: await measureDirectory(directory)
  })));
}

if (parentPort) {
  parentPort.on('message', async ({ id, paths }) => {
    try {
      parentPort.postMessage({ id, results: await measureDirectories(paths) });
    } catch (error) {
      parentPort.postMessage({ id, error: error.message || String(error) });
    }
  });
}

module.exports = { measureDirectory, measureDirectories };
