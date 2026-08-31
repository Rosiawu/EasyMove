const test = require('node:test');
const assert = require('node:assert/strict');
const { mountedVolumeFromPlist, parseDiskutilPlist } = require('../src/volume-utils');

function plist(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${entries}</dict></plist>`;
}

test('reads an SD card as a removable read-only volume', () => {
  const xml = plist(`
    <key>BusProtocol</key><string>Secure Digital</string>
    <key>FilesystemName</key><string>ExFAT</string>
    <key>Internal</key><true/>
    <key>MountPoint</key><string>/Volumes/SD_Card</string>
    <key>RemovableMedia</key><true/>
    <key>VolumeName</key><string>SD_Card</string>
    <key>Writable</key><false/>
  `);
  assert.deepEqual(mountedVolumeFromPlist(xml, '/fallback', 'fallback'), {
    name: 'SD_Card',
    path: '/Volumes/SD_Card',
    kind: 'removable',
    removable: true,
    readOnly: true,
    protocol: 'Secure Digital',
    filesystem: 'ExFAT'
  });
});

test('filters mounted disk images out of the physical volume list', () => {
  const xml = plist(`
    <key>BusProtocol</key><string>Disk Image</string>
    <key>MountPoint</key><string>/Volumes/EasyMove 0.6.13</string>
    <key>RemovableMedia</key><true/>
    <key>Writable</key><false/>
  `);
  assert.equal(mountedVolumeFromPlist(xml, '/fallback', 'fallback'), null);
});

test('decodes plist strings and scalar values', () => {
  const info = parseDiskutilPlist(plist(`
    <key>VolumeName</key><string>Rosia &amp; Files</string>
    <key>RemovableMediaOrExternalDevice</key><true/>
    <key>WritableVolume</key><false/>
  `));
  assert.equal(info.VolumeName, 'Rosia & Files');
  assert.equal(info.RemovableMediaOrExternalDevice, true);
  assert.equal(info.WritableVolume, false);
});
