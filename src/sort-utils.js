function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function compareEntries(left, right, sort) {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  const direction = sort.direction === 'desc' ? -1 : 1;
  let result = 0;
  if (sort.field === 'modified') result = (left.modified || 0) - (right.modified || 0);
  else if (sort.field === 'size') {
    const leftReady = Number.isFinite(left.size);
    const rightReady = Number.isFinite(right.size);
    if (leftReady !== rightReady) return leftReady ? -1 : 1;
    result = (left.size || 0) - (right.size || 0);
  } else if (sort.field === 'type') result = naturalCompare(left.kind, right.kind);
  else result = naturalCompare(left.name, right.name);
  if (result === 0) result = naturalCompare(left.name, right.name);
  return result * direction;
}

function sortEntries(entries, sort) {
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareEntries(a.entry, b.entry, sort) || a.index - b.index)
    .map(({ entry }) => entry);
}

if (typeof module !== 'undefined') module.exports = { naturalCompare, compareEntries, sortEntries };
if (typeof window !== 'undefined') window.easyMoveSort = { naturalCompare, compareEntries, sortEntries };
