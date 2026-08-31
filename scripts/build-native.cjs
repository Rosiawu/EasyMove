const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') process.exit(0);

const projectRoot = path.join(__dirname, '..');
const clipboardSource = path.join(projectRoot, 'native', 'file-clipboard.m');
const clipboardOutput = path.join(projectRoot, 'assets', 'easymove-file-clipboard');

execFileSync('/usr/bin/clang', [
  '-O2',
  '-fobjc-arc',
  '-arch',
  'arm64',
  '-framework',
  'AppKit',
  '-framework',
  'Foundation',
  clipboardSource,
  '-o',
  clipboardOutput
], { stdio: 'inherit' });
fs.chmodSync(clipboardOutput, 0o755);
