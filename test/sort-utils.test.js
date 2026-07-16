const test = require('node:test');
const assert = require('node:assert/strict');
const { sortEntries } = require('../src/sort-utils');

const entries = [
  { name: 'file10.txt', kind: 'TXT', size: 10, modified: 30, isDirectory: false },
  { name: 'Folder2', kind: '文件夹', size: null, modified: 20, isDirectory: true },
  { name: 'file2.jpg', kind: 'JPG', size: 20, modified: 10, isDirectory: false },
  { name: 'Folder10', kind: '文件夹', size: 50, modified: 40, isDirectory: true }
];

test('name sort is natural and always keeps folders first', () => {
  assert.deepEqual(sortEntries(entries, { field: 'name', direction: 'asc' }).map((item) => item.name), ['Folder2', 'Folder10', 'file2.jpg', 'file10.txt']);
  assert.deepEqual(sortEntries(entries, { field: 'name', direction: 'desc' }).slice(0, 2).map((item) => item.name), ['Folder10', 'Folder2']);
});

test('size sort puts unavailable folder sizes after ready folders and reorders once ready', () => {
  assert.deepEqual(sortEntries(entries, { field: 'size', direction: 'asc' }).slice(0, 2).map((item) => item.name), ['Folder10', 'Folder2']);
  const ready = entries.map((item) => item.name === 'Folder2' ? { ...item, size: 5 } : item);
  assert.deepEqual(sortEntries(ready, { field: 'size', direction: 'asc' }).slice(0, 2).map((item) => item.name), ['Folder2', 'Folder10']);
});

test('modified and type sorts are deterministic with name tie breaking', () => {
  assert.equal(sortEntries(entries, { field: 'modified', direction: 'desc' })[0].name, 'Folder10');
  assert.deepEqual(sortEntries(entries, { field: 'type', direction: 'asc' }).map((item) => item.name), ['Folder2', 'Folder10', 'file2.jpg', 'file10.txt']);
});
