function finderInfoAppleScriptLines() {
  return [
    'on run argv',
    'set targetItem to (POSIX file (item 1 of argv) as alias)',
    'tell application "Finder"',
    'activate',
    'set infoWindow to open information window of targetItem',
    'activate',
    'return name of infoWindow',
    'end tell',
    'end run'
  ];
}

async function showFinderInfo(itemPath, runAppleScript) {
  if (!itemPath) throw new Error('请先选择一个项目');
  if (typeof runAppleScript !== 'function') throw new TypeError('runAppleScript is required');
  return runAppleScript(finderInfoAppleScriptLines(), [itemPath]);
}

module.exports = { finderInfoAppleScriptLines, showFinderInfo };
