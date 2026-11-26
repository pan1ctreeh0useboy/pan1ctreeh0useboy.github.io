function scaledCanvas(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The preview could not be encoded.')), type, quality);
  });
}

export async function imageThumbnail(bitmap) {
  for (const maxSide of [840, 640, 420]) {
    const canvas = scaledCanvas(bitmap.width, bitmap.height, maxSide);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await encode(canvas, 'image/webp', 0.76);
    if (thumbnail.size <= 256 * 1024) return thumbnail;
    if (maxSide === 420) return encode(canvas, 'image/jpeg', 0.76);
  }
}

function waitForVideo(video, eventName, start) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, ready);
      video.removeEventListener('error', fail);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const fail = () => finish(new Error('The MP4 could not be decoded. Try an H.264 MP4.'));
    const timeout = setTimeout(fail, 8000);
    video.addEventListener(eventName, ready);
    video.addEventListener('error', fail);
    start();
  });
}

const ascii = new TextEncoder();
function put24(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >> 8) & 255;
  bytes[offset + 2] = (value >> 16) & 255;
}

function chunk(tag, ...parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const header = new Uint8Array(8);
  header.set(ascii.encode(tag));
  new DataView(header.buffer).setUint32(4, length, true);
  return new Blob([header, ...parts, new Uint8Array(length % 2)]);
}

async function lossyFrame(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sizes = new DataView(bytes.buffer);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = sizes.getUint32(offset + 4, true);
    const end = offset + 8 + length + length % 2;
    if (end > bytes.length) break;
    if (sizes.getUint32(offset) === 0x56503820) return bytes.subarray(offset, end); // VP8
    offset = end;
  }
  return null;
}

async function animatedPreview(video, width, height) {
  if (!Number.isFinite(video.duration) || video.duration < 0.3) return null;
  const canvas = scaledCanvas(width, height, 320);
  const context = canvas.getContext('2d', {alpha: false});
  const duration = Math.min(video.duration, 4);
  const frameCount = Math.ceil(duration * 8);
  const frameDuration = Math.round(duration * 1000 / frameCount);
  const extended = new Uint8Array(10);
  extended[0] = 2; // Animation flag in VP8X.
  put24(extended, 4, canvas.width - 1);
  put24(extended, 7, canvas.height - 1);
  const chunks = [ascii.encode('WEBP'), chunk('VP8X', extended), chunk('ANIM', new Uint8Array(6))];
  for (let index = 0; index < frameCount; index++) {
    if (index) {
      await waitForVideo(video, 'seeked', () => { video.currentTime = index * duration / frameCount; });
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = await lossyFrame(await encode(canvas, 'image/webp', 0.62));
    if (!frame) return null;
    const header = new Uint8Array(16);
    put24(header, 6, canvas.width - 1);
    put24(header, 9, canvas.height - 1);
    put24(header, 12, frameDuration);
    header[15] = 2; // Each frame replaces the entire canvas.
    chunks.push(chunk('ANMF', header, frame));
  }
  const header = new Uint8Array(8);
  header.set(ascii.encode('RIFF'));
  const data = new Blob(chunks);
  if (data.size + header.byteLength > 2 * 1024 * 1024) return null;
  new DataView(header.buffer).setUint32(4, data.size, true);
  return new Blob([header, data], {type: 'image/webp'});
}

export async function videoPreviews(file) {
  if (!/\.mp4$/i.test(file.name)) throw new Error('Choose an MP4 video.');
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    await waitForVideo(video, 'loadeddata', () => { video.src = url; });
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('The MP4 needs a video track.');
    const canvas = scaledCanvas(width, height, 720);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const cover = await encode(canvas, 'image/jpeg', 0.78);
    const animation = await animatedPreview(video, width, height);
    return {cover, animation, dimensions: {width, height, coverWidth: canvas.width, coverHeight: canvas.height}};
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
