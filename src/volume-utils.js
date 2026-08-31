function decodeXml(value) {
  return String(value || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function plistScalar(xml, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(
    `<key>${escapedKey}<\\/key>\\s*<(string|integer|real)>([\\s\\S]*?)<\\/\\1>|<key>${escapedKey}<\\/key>\\s*<(true|false)\\s*\\/>`
  ));
  if (!match) return undefined;
  const type = match[1] || match[3];
  if (type === 'true') return true;
  if (type === 'false') return false;
  if (type === 'integer' || type === 'real') return Number(match[2]);
  return decodeXml(match[2]);
}

function parseDiskutilPlist(xml) {
  const keys = [
    'VolumeName',
    'MountPoint',
    'BusProtocol',
    'FilesystemType',
    'FilesystemName',
    'RemovableMediaOrExternalDevice',
    'RemovableMedia',
    'Removable',
    'Ejectable',
    'Internal',
    'Writable',
    'WritableVolume'
  ];
  return Object.fromEntries(keys
    .map((key) => [key, plistScalar(xml, key)])
    .filter(([, value]) => value !== undefined));
}

function mountedVolumeFromPlist(xml, fallbackPath, fallbackName) {
  const info = parseDiskutilPlist(xml);
  if (info.BusProtocol === 'Disk Image') return null;
  const removable = Boolean(
    info.RemovableMediaOrExternalDevice
    || info.RemovableMedia
    || info.Removable
    || info.Ejectable
    || info.Internal === false
  );
  return {
    name: info.VolumeName || fallbackName,
    path: info.MountPoint || fallbackPath,
    kind: removable ? 'removable' : 'volume',
    removable,
    readOnly: info.Writable === false || info.WritableVolume === false,
    protocol: info.BusProtocol || '',
    filesystem: info.FilesystemName || info.FilesystemType || ''
  };
}

module.exports = {
  mountedVolumeFromPlist,
  parseDiskutilPlist,
  plistScalar
};
