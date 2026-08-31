const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function copyVerificationError(message, code = 'EASYMOVE_COPY_VERIFICATION_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function captureTreeSnapshot(rootPath) {
  const entries = [];

  async function visit(itemPath, relativePath) {
    const before = await fsp.lstat(itemPath);
    if (before.isDirectory()) {
      const namesBefore = (await fsp.readdir(itemPath)).sort();
      entries.push({ path: relativePath, type: 'directory' });
      for (const name of namesBefore) await visit(path.join(itemPath, name), path.join(relativePath, name));
      const namesAfter = (await fsp.readdir(itemPath)).sort();
      if (namesBefore.length !== namesAfter.length || namesBefore.some((name, index) => name !== namesAfter[index])) {
        throw copyVerificationError('源文件夹在复制过程中发生了变化，请重试', 'EASYMOVE_SOURCE_CHANGED');
      }
      return;
    }
    if (before.isSymbolicLink()) {
      entries.push({ path: relativePath, type: 'symlink', target: await fsp.readlink(itemPath) });
      return;
    }
    if (!before.isFile()) throw copyVerificationError(`暂不支持复制这种项目：${path.basename(itemPath)}`);
    const digest = await hashFile(itemPath);
    const after = await fsp.lstat(itemPath);
    if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw copyVerificationError(`源文件在复制过程中发生了变化：${path.basename(itemPath)}`, 'EASYMOVE_SOURCE_CHANGED');
    }
    entries.push({ path: relativePath, type: 'file', size: before.size, hash: digest });
  }

  await visit(rootPath, '');
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function assertTreeMatchesSnapshot(rootPath, expected) {
  let actual;
  try {
    actual = await captureTreeSnapshot(rootPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw copyVerificationError('复制结果不存在，未生成副本');
    throw error;
  }
  if (actual.length !== expected.length) throw copyVerificationError('复制结果的项目数量与原文件夹不一致，未生成副本');
  for (let index = 0; index < expected.length; index += 1) {
    const source = expected[index];
    const destination = actual[index];
    if (source.path !== destination.path || source.type !== destination.type) {
      throw copyVerificationError('复制结果的目录结构与原文件夹不一致，未生成副本');
    }
    if (source.type === 'file' && (source.size !== destination.size || source.hash !== destination.hash)) {
      throw copyVerificationError(`复制结果内容校验失败：${path.basename(source.path) || path.basename(rootPath)}`);
    }
    if (source.type === 'symlink' && source.target !== destination.target) {
      throw copyVerificationError(`复制结果链接校验失败：${path.basename(source.path)}`);
    }
  }
}

function copyStagingPath(destination, operationId) {
  const token = crypto.createHash('sha256').update(`${operationId}\0${path.resolve(destination)}`).digest('hex').slice(0, 20);
  return path.join(path.dirname(destination), `.easymove-copy-${token}`);
}

async function verifiedAtomicCopy({ source, destination, staging, copyTree }) {
  const snapshot = await captureTreeSnapshot(source);
  const destinationExists = fs.existsSync(destination);
  const stagingExists = fs.existsSync(staging);

  if (destinationExists && !stagingExists) {
    await assertTreeMatchesSnapshot(destination, snapshot);
    return { recovered: true, snapshot };
  }
  if (destinationExists) throw copyVerificationError('目标位置在复制过程中被占用，未覆盖任何文件');

  try {
    await copyTree(source, staging);
    await assertTreeMatchesSnapshot(staging, snapshot);
    if (fs.existsSync(destination)) throw copyVerificationError('目标位置在复制过程中被占用，未覆盖任何文件');
    await fsp.rename(staging, destination);
    return { recovered: false, snapshot };
  } catch (error) {
    if (['EASYMOVE_COPY_VERIFICATION_FAILED', 'EASYMOVE_SOURCE_CHANGED'].includes(error.code)) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

module.exports = { captureTreeSnapshot, assertTreeMatchesSnapshot, copyStagingPath, verifiedAtomicCopy };
