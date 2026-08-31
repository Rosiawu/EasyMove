const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ariaShortcutForCommand,
  commandForShortcut,
  isPrimaryModifier,
  shortcutForCommand
} = require('../src/context-menu-utils');

test('Command and Ctrl both remain valid primary shortcut modifiers', () => {
  assert.equal(isPrimaryModifier({ metaKey: true, ctrlKey: false }), true);
  assert.equal(isPrimaryModifier({ metaKey: false, ctrlKey: true }), true);
  assert.equal(isPrimaryModifier({ metaKey: false, ctrlKey: false }), false);
});

test('all toolbar file actions have discoverable macOS and Windows shortcuts', () => {
  const commands = ['new-folder', 'copy', 'cut', 'paste', 'rename', 'trash'];
  assert.deepEqual(commands.map((command) => shortcutForCommand(command, 'darwin')), ['⌘⇧N', '⌘C', '⌘X', '⌘V', 'Return', '⌫']);
  assert.deepEqual(commands.map((command) => shortcutForCommand(command, 'win32')), ['Ctrl+Shift+N', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'F2', 'Delete']);
  assert.equal(ariaShortcutForCommand('trash', 'darwin'), 'Backspace');
  assert.equal(ariaShortcutForCommand('trash', 'win32'), 'Delete');
});

test('shortcut commands cover create, clipboard, rename, selection, and trash', () => {
  assert.equal(commandForShortcut({ key: 'n', metaKey: true, shiftKey: true }, 'darwin'), 'new-folder');
  assert.equal(commandForShortcut({ key: 'c', metaKey: true }, 'darwin'), 'copy');
  assert.equal(commandForShortcut({ key: 'x', ctrlKey: true }, 'win32'), 'cut');
  assert.equal(commandForShortcut({ key: 'v', ctrlKey: true }, 'win32'), 'paste');
  assert.equal(commandForShortcut({ key: 'Enter' }, 'darwin'), 'rename');
  assert.equal(commandForShortcut({ key: 'F2' }, 'win32'), 'rename');
  assert.equal(commandForShortcut({ key: 'r', metaKey: true, ctrlKey: true }, 'darwin'), 'batch-rename');
  assert.equal(commandForShortcut({ key: 'r', ctrlKey: true, shiftKey: true }, 'win32'), 'batch-rename');
  assert.equal(shortcutForCommand('batch-rename', 'darwin'), '⌃⌘R');
  assert.equal(shortcutForCommand('batch-rename', 'win32'), 'Ctrl+Shift+R');
  assert.equal(ariaShortcutForCommand('batch-rename', 'darwin'), 'Control+Meta+R');
  assert.equal(commandForShortcut({ key: 'a', metaKey: true }, 'darwin'), 'select-all');
  assert.equal(commandForShortcut({ key: 'z', metaKey: true }, 'darwin'), 'undo');
  assert.equal(commandForShortcut({ key: 'z', ctrlKey: true }, 'win32'), 'undo');
  assert.equal(commandForShortcut({ key: ' ' }, 'darwin'), 'quick-look');
  assert.equal(commandForShortcut({ key: 'Spacebar' }, 'darwin'), 'quick-look');
  assert.equal(commandForShortcut({ key: ' ' }, 'win32'), null);
  assert.equal(commandForShortcut({ key: '.', metaKey: true, shiftKey: true }, 'darwin'), 'toggle-hidden');
  assert.equal(commandForShortcut({ key: 'h', ctrlKey: true }, 'win32'), 'toggle-hidden');
  assert.equal(shortcutForCommand('toggle-hidden', 'darwin'), '⌘⇧.');
  assert.equal(shortcutForCommand('toggle-hidden', 'win32'), 'Ctrl+H');
  assert.equal(ariaShortcutForCommand('toggle-hidden', 'darwin'), 'Meta+Shift+Period');
});

test('trash accepts bare macOS Delete/Backspace, Command variants, and Windows Delete without repeat', () => {
  assert.equal(commandForShortcut({ key: 'Backspace', metaKey: true }, 'darwin'), 'trash');
  assert.equal(commandForShortcut({ key: 'Delete', metaKey: true }, 'darwin'), 'trash');
  assert.equal(commandForShortcut({ key: 'Backspace' }, 'darwin'), 'trash');
  assert.equal(commandForShortcut({ key: 'Delete' }, 'darwin'), 'trash');
  assert.equal(commandForShortcut({ key: 'Delete' }, 'win32'), 'trash');
  assert.equal(commandForShortcut({ key: 'Delete', repeat: true }, 'win32'), null);
});
