function nativeContextMenuItems(context = {}) {
  const {
    itemContext = false,
    hasSelection = false,
    canPaste = false,
    platform = process.platform,
    selectionCount = 0,
    virtualContext = false,
    virtualMode = null,
    canExtract = false
  } = context;
  const mac = platform === 'darwin';
  const items = [];
  const command = (id, label, accelerator, enabled = true) => items.push({ id, label, command: id, accelerator, enabled });
  const native = (id, label, enabled = true) => items.push({ id, label, nativeAction: id, enabled });
  const separator = () => items.push({ separator: true });

  if (!itemContext) {
    if (virtualContext) {
      command('select-all', '全选', mac ? 'Command+A' : 'Control+A');
      return items;
    }
    command('new-folder', '新建文件夹', mac ? 'Command+Shift+N' : 'Control+Shift+N');
    command('paste', '粘贴', mac ? 'Command+V' : 'Control+V', canPaste);
    command('select-all', '全选', mac ? 'Command+A' : 'Control+A');
    if (mac) {
      separator();
      native('get-info', '显示简介');
      items.push({ id: 'services', role: 'services' });
    }
    return items;
  }

  native('open', selectionCount > 1 ? `打开 ${selectionCount} 个项目` : '打开', hasSelection);
  if (mac) {
    native('open-with', '打开方式…', hasSelection);
    native('quick-look', selectionCount > 1 ? `快速查看 ${selectionCount} 个项目` : '快速查看', hasSelection);
  }
  separator();
  command('cut', '剪切', mac ? 'Command+X' : 'Control+X', hasSelection);
  command('copy', '复制', mac ? 'Command+C' : 'Control+C', hasSelection);
  if (virtualMode === 'basket') command('basket-remove', '从临时文件篮移除', undefined, hasSelection);
  else command('basket-add', '放入临时文件篮', undefined, hasSelection);
  command('paste', '粘贴到此处', mac ? 'Command+V' : 'Control+V', canPaste);
  if (selectionCount > 1) command('batch-rename', `批量重命名 ${selectionCount} 个项目…`, mac ? 'Control+Command+R' : 'Control+Shift+R', hasSelection);
  else command('rename', '重新命名', mac ? 'Enter' : 'F2', selectionCount === 1);
  command('duplicate', '制作副本', mac ? 'Command+D' : 'Control+D', hasSelection);
  if (mac) {
    command('compress', selectionCount > 1 ? `压缩 ${selectionCount} 个项目` : '压缩', undefined, hasSelection);
    if (canExtract) {
      command('extract-here', '解压到当前文件夹', undefined, true);
      command('extract-folder', '解压到同名文件夹', undefined, true);
    }
  }
  separator();
  native('baidu-upload', '上传到百度网盘', hasSelection);
  separator();
  command('trash', mac ? '移到废纸篓' : '移到回收站', mac ? 'Backspace' : 'Delete', hasSelection);
  if (mac) {
    separator();
    native('get-info', '显示简介', selectionCount === 1);
    items.push({ id: 'share', role: 'shareMenu', enabled: hasSelection });
    items.push({ id: 'services', role: 'services' });
  }
  separator();
  command('copy-path', '拷贝完整路径', undefined, hasSelection);
  native('reveal', mac ? '在 Finder 中显示' : '在文件资源管理器中显示', hasSelection);
  return items;
}

module.exports = { nativeContextMenuItems };
