const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function defaultHelperPath() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'easymove-file-clipboard')
    : '';
  if (unpacked && fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, '..', 'assets', 'easymove-file-clipboard');
}

async function writeFilesToSystemClipboard(paths, options = {}) {
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const execute = options.execute || execFileAsync;
  const resolvedPaths = [...new Set((paths || [])
    .map((filePath) => path.resolve(String(filePath)))
    .filter((filePath) => exists(filePath)))];
  if (!resolvedPaths.length) throw new Error('没有可复制到系统剪贴板的文件');
  if (platform !== 'darwin') return { written: false, count: resolvedPaths.length, platform };
  const helperPath = options.helperPath || defaultHelperPath();
  if (!exists(helperPath)) throw new Error('系统文件剪贴板组件缺失，请重新安装 EasyMove');
  await execute(helperPath, ['--write', ...resolvedPaths], { timeout: 5000, maxBuffer: 1024 * 1024 });
  return { written: true, count: resolvedPaths.length, platform };
}

module.exports = { defaultHelperPath, writeFilesToSystemClipboard };
