const encoder = new TextEncoder();
export const MAX_FILE = 5 * 1024 * 1024;
export const MAX_BODY = 12 * 1024 * 1024;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function check(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
export function text(value, name, max = 300) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Please enter ${name}.`);
  return value.trim();
}
export function validateLocation(input) {
  const location = {
    id: input.id,
    name: text(input.name, 'a location name', 100),
    address: text(input.address, 'an English address', 500),
    latitude: input.latitude,
    longitude: input.longitude,
  };
  check(typeof location.id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(location.id), 'Invalid location identifier.');
  check(!/\bcounty\b|县/i.test(location.address), 'Please leave county out of the address.');
  check(!/[\u3400-\u9fff]/.test(location.address), 'Please enter the address in English.');
  check(Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90, 'Latitude must be between -90 and 90.');
  check(Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180, 'Longitude must be between -180 and 180.');
  return location;
}
export function fileExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if ([137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return 'png';
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'webp';
  throw new HttpError(400, 'Use JPEG, PNG or WebP photographs.');
}
export function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function url64(bytes) { return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function un64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function passwordMatches(value, expected) {
  const key = await signingKey(expected);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(value));
}
export async function createSession(secret, now = Date.now()) {
  const payload = url64(encoder.encode(JSON.stringify({ expires: now + 30 * 60 * 1000, nonce: crypto.randomUUID() })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${url64(new Uint8Array(signature))}`;
}
export async function validSession(token, secret, now = Date.now()) {
  try {
    if (!token || token.length > 1000) return false;
    const [payload, signature, extra] = token.split('.');
    if (extra || !signature || !await crypto.subtle.verify('HMAC', await signingKey(secret), un64(signature), encoder.encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(un64(payload)));
    return Number.isFinite(data.expires) && data.expires > now && data.expires <= now + 30 * 60 * 1000;
  } catch { return false; }
}
export async function boundedBody(request, limit) {
  check(Number(request.headers.get('content-length') || 0) <= limit, 'Upload is too large.', 413);
  const reader = request.body?.getReader();
  check(reader, 'Missing request body.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Upload is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function parseUpload(request) {
  const body = await boundedBody(request, MAX_BODY);
  let form, metadata;
  try {
    form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    metadata = JSON.parse(form.get('metadata'));
  } catch { throw new HttpError(400, 'The upload could not be read.'); }
  check(metadata && typeof metadata === 'object', 'Missing photo information.');
  check(typeof metadata.uploadId === 'string' && /^[0-9a-f-]{36}$/.test(metadata.uploadId), 'Invalid upload identifier.');
  const location = validateLocation(metadata.location || {});
  const device = text(metadata.device, 'a device name', 100);
  const files = form.getAll('photos');
  check(files.length > 0 && files.length <= 10, 'Choose between 1 and 10 photographs.');
  check(Array.isArray(metadata.photos) && metadata.photos.length === files.length, 'Photo information is incomplete.');
  const photos = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    check(typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= MAX_FILE, 'Each photograph must be 5 MB or smaller.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = fileExtension(bytes);
    const info = metadata.photos[i];
    check(info && ['width', 'height'].every(key => Number.isInteger(info[key]) && info[key] > 0 && info[key] <= 30000), 'Invalid photo dimensions.');
    const id = `${metadata.uploadId}-${i}`;
    photos.push({
      bytes, path: `photography/uploads/${id}.${extension}`,
      data: { id, src: `/photography/uploads/${id}.${extension}`, alt: typeof info.alt === 'string' ? info.alt.slice(0, 300) : location.name, width: info.width, height: info.height, device, uploadId: metadata.uploadId },
    });
  }
  return { uploadId: metadata.uploadId, location, photos };
}
export function applyUpload(gallery, upload) {
  check(gallery.version === 1 && Array.isArray(gallery.locations), 'The existing gallery could not be read.', 502);
  const data = structuredClone(gallery);
  if (data.locations.some(location => location.photos.some(photo => photo.uploadId === upload.uploadId))) return { data, duplicate: true };
  let location = data.locations.find(item => item.id === upload.location.id);
  if (!location) { location = { ...upload.location, photos: [] }; data.locations.push(location); }
  // Existing location coordinates and address are authoritative; adding photos cannot move older work.
  location.photos = location.photos.filter(photo => photo.src);
  location.photos.push(...upload.photos.map(photo => photo.data));
  return { data, duplicate: false };
}

const uploadPath = /^\/photography\/uploads\/[a-zA-Z0-9-]+\.(?:jpg|png|webp)$/;
export async function parsePhotoEdit(request) {
  const body = await boundedBody(request, 6 * 1024 * 1024);
  let metadata, file;
  try {
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
      metadata = JSON.parse(form.get('metadata'));
      file = form.get('photo');
    } else metadata = JSON.parse(new TextDecoder().decode(body));
  } catch { throw new HttpError(400, 'The photograph edit could not be read.'); }
  check(metadata && ['replace', 'delete'].includes(metadata.action), 'Choose a photograph edit.');
  check(typeof metadata.locationId === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(metadata.locationId), 'Invalid series.');
  check(typeof metadata.photoId === 'string' && metadata.photoId.length <= 100, 'Invalid photograph.');
  check(typeof metadata.expectedSrc === 'string' && uploadPath.test(metadata.expectedSrc), 'Invalid photograph path.');
  const edit = { action: metadata.action, locationId: metadata.locationId, photoId: metadata.photoId, expectedSrc: metadata.expectedSrc };
  if (edit.action === 'replace') {
    check(typeof metadata.editId === 'string' && /^[0-9a-f-]{36}$/.test(metadata.editId), 'Invalid edit identifier.');
    check(file && typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= MAX_FILE, 'Each photograph must be 5 MB or smaller.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = fileExtension(bytes);
    const dimensions = metadata.dimensions;
    check(dimensions && ['width', 'height'].every(key => Number.isInteger(dimensions[key]) && dimensions[key] > 0 && dimensions[key] <= 30000), 'Invalid photo dimensions.');
    edit.bytes = bytes;
    edit.path = `photography/uploads/${metadata.editId}.${extension}`;
    edit.src = `/${edit.path}`;
    edit.dimensions = dimensions;
  }
  return edit;
}
export function applyPhotoEdit(gallery, edit) {
  check(gallery.version === 1 && Array.isArray(gallery.locations), 'The existing gallery could not be read.', 502);
  const data = structuredClone(gallery);
  const location = data.locations.find(item => item.id === edit.locationId);
  check(location && Array.isArray(location.photos), 'Series not found.', 404);
  const index = location.photos.findIndex(photo => photo.id === edit.photoId);
  if (index < 0 && edit.action === 'delete') return { data, duplicate: true };
  check(index >= 0, 'Photograph not found.', 404);
  const original = location.photos[index];
  if (edit.action === 'replace' && original.src === edit.src) return { data, duplicate: true };
  check(original.src === edit.expectedSrc, 'This photograph changed. Refresh the page and try again.', 409);
  const oldPath = original.src.slice(1);
  if (edit.action === 'delete') location.photos.splice(index, 1);
  else location.photos[index] = { ...original, src: edit.src, width: edit.dimensions.width, height: edit.dimensions.height };
  return { data, duplicate: false, oldPath };
}
