export const formats = {
  a3: { label: 'A3 Poster', ratio: 297 / 420, priority: 1 },
  b2: { label: 'B2 Poster (ISO)', ratio: 500 / 707, priority: 1 },
  landscape: { label: 'Landscape Video (16:9)', ratio: 16 / 9, priority: 1 },
  vertical: { label: 'Portrait Video (9:16)', ratio: 9 / 16, priority: 3 },
  square: { label: 'Square (1:1)', ratio: 1, priority: 2 },
  photo: { label: 'Portrait Photo (4:5)', ratio: 4 / 5, priority: 3 },
  banner: { label: 'Banner (3:1)', ratio: 3, priority: 3 },
};

export const platforms = {
  behance: { label: 'Behance', hosts: ['behance.net'] },
  vimeo: { label: 'Vimeo', hosts: ['vimeo.com'] },
  youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  bilibili: { label: 'Bilibili', hosts: ['bilibili.com', 'b23.tv'] },
};

export function platformUrl(platform, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!platforms[platform].hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return '';
    return url.href;
  } catch {
    return '';
  }
}
