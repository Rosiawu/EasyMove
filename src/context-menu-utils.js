(function exposeContextMenuUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EasyMoveContextMenu = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  function isPrimaryModifier(event) {
    return Boolean(event?.metaKey || event?.ctrlKey);
  }

  function shortcutForCommand(command, platform) {
    const mac = platform === 'darwin';
    return ({
      'new-folder': mac ? '⌘⇧N' : 'Ctrl+Shift+N',
      copy: mac ? '⌘C' : 'Ctrl+C',
      cut: mac ? '⌘X' : 'Ctrl+X',
      paste: mac ? '⌘V' : 'Ctrl+V',
      rename: mac ? 'Return' : 'F2',
      'batch-rename': mac ? '⌃⌘R' : 'Ctrl+Shift+R',
      trash: mac ? '⌫' : 'Delete',
      'toggle-hidden': mac ? '⌘⇧.' : 'Ctrl+H'
    })[command] || '';
  }

  function ariaShortcutForCommand(command, platform) {
    const mac = platform === 'darwin';
    return ({
      'new-folder': mac ? 'Meta+Shift+N' : 'Control+Shift+N',
      copy: mac ? 'Meta+C' : 'Control+C',
      cut: mac ? 'Meta+X' : 'Control+X',
      paste: mac ? 'Meta+V' : 'Control+V',
      rename: mac ? 'Enter' : 'F2',
      'batch-rename': mac ? 'Control+Meta+R' : 'Control+Shift+R',
      trash: mac ? 'Backspace' : 'Delete',
      'toggle-hidden': mac ? 'Meta+Shift+Period' : 'Control+H'
    })[command] || '';
  }

  function commandForShortcut(event, platform) {
    if (!event || event.repeat || event.isComposing) return null;
    const key = String(event.key || '').toLowerCase();
    const primary = isPrimaryModifier(event);
    const shift = Boolean(event.shiftKey);
    const alt = Boolean(event.altKey);

    if (platform === 'darwin' && event.metaKey && event.ctrlKey && !shift && !alt && key === 'r') return 'batch-rename';
    if (platform === 'win32' && event.ctrlKey && !event.metaKey && shift && !alt && key === 'r') return 'batch-rename';
    if (primary && shift && !alt && key === 'n') return 'new-folder';
    if (platform === 'darwin' && primary && shift && !alt && key === '.') return 'toggle-hidden';
    if (platform === 'darwin' && primary && alt && !shift && key === 'v') return 'paste-move';
    if (platform === 'win32' && event.ctrlKey && !event.metaKey && !shift && !alt && key === 'h') return 'toggle-hidden';
    if (primary && !shift && !alt) {
      if (key === 'z') return 'undo';
      if (key === 'c') return 'copy';
      if (key === 'x') return 'cut';
      if (key === 'v') return 'paste';
      if (key === 'a') return 'select-all';
      if (platform === 'darwin' && (key === 'backspace' || key === 'delete')) return 'trash';
    }
    if (!primary && !shift && !alt) {
      if (platform === 'darwin' && (key === ' ' || key === 'spacebar')) return 'quick-look';
      if (key === 'f2') return 'rename';
      if (platform === 'darwin' && key === 'enter') return 'rename';
      if (platform === 'darwin' && key === 'backspace') return 'trash';
      if (key === 'delete') return 'trash';
    }
    return null;
  }

  return {
    ariaShortcutForCommand,
    commandForShortcut,
    isPrimaryModifier,
    shortcutForCommand
  };
});
