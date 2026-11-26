import { HttpError, base64, boundedBody, check, fileExtension, text } from './core.mjs';
import { GitHubGallery } from './github.mjs';
import { formats, platforms, platformUrl } from '../projects/formats.js';

const catalogPath = 'projects/catalog.json';
const maxFileSize = 24 * 1024 * 1024;
const maxUploadSize = 25 * 1024 * 1024;
const maxThumbnailSize = 1024 * 1024;
const maxAnimationSize = 2 * 1024 * 1024;
const maxBodySize = 32 * 1024 * 1024;
const projectId = /^[a-z0-9][a-z0-9-]{0,79}$/;
const revisionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function checkProjectId(input) {
  check(typeof input?.id === 'string' && projectId.test(input.id), 'Invalid project identifier.');
  check(input.expectedRevision === null || typeof input.expectedRevision === 'string' && revisionId.test(input.expectedRevision), 'Invalid previous version.');
}

export async function parseProjectDelete(request) {
  const bytes = await boundedBody(request, 2048);
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'The project to delete could not be read.');
  }
  checkProjectId(input);
  return {id: input.id, expectedRevision: input.expectedRevision};
}

function checkFile(file, limit, message) {
  check(file && typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= limit, message);
}

export async function parseProjectSave(request) {
  check(request.body, 'Missing request body.');
  check(Number(request.headers.get('Content-Length') ?? 0) <= maxBodySize, 'Upload is too large.', 413);
  let received = 0;
  const body = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      check(received <= maxBodySize, 'Upload is too large.', 413);
      controller.enqueue(chunk);
    },
  }));
  let form, input;
  try {
    form = await new Response(body, {headers: {'Content-Type': request.headers.get('Content-Type')}}).formData();
    input = JSON.parse(form.get('metadata'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'The project upload could not be read.');
  }
  checkProjectId(input);
  check(typeof input.revision === 'string' && revisionId.test(input.revision), 'Invalid save identifier.');
  check(typeof input.create === 'boolean', 'Choose a project.');
  check(typeof input.format === 'string' && Object.hasOwn(formats, input.format), 'Choose a display format.');
  const title = text(input.title, 'a project title', 160);
  const type = text(input.type, 'a work type', 100);
  const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';
  const timestamp = Date.parse(date);
  check(Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date, 'Enter a valid project date.');
  const links = {};
  for (const [key, platform] of Object.entries(platforms)) {
    const url = input.links?.[key] ?? '';
    check(typeof url === 'string' && url.length <= 2048, `Enter a valid ${platform.label} link.`);
    const value = url.trim();
    if (!value) continue;
    const href = platformUrl(key, value);
    check(href, `Enter an HTTPS link from ${platform.label}.`);
    links[key] = href;
  }

  const files = form.getAll('images');
  const videos = form.getAll('video');
  const covers = form.getAll('videoCover');
  const thumbnails = form.getAll('thumbnail');
  const animations = form.getAll('videoAnimation');
  const cardThumbnails = form.getAll('cardThumbnail');
  check(files.length <= 10 && videos.length <= 1, 'Choose up to 10 images and one MP4 video.');
  check(!input.create || files.length || videos.length, 'New projects require an image or a video.');
  check(files.length === input.dimensions?.length, 'Image dimensions are incomplete.');
  check(covers.length === videos.length, 'The video cover is missing.');
  const order = input.order;
  check(order === undefined || Array.isArray(order) && order.every(key => typeof key === 'string'), 'Invalid media order.');
  const homepage = input.homepage;
  check(homepage === undefined || order && Array.isArray(homepage) && homepage.every(entry =>
    Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' &&
    (entry[1] === 'auto' || typeof entry[1] === 'string' && Object.hasOwn(formats, entry[1]))), 'Invalid homepage container type.');
  const homepageFormats = new Map(homepage);
  check(homepage === undefined || homepage.length === homepageFormats.size, 'A homepage card was listed more than once.');
  const thumbnailKeys = input.thumbnailKeys ?? [];
  check(Array.isArray(thumbnailKeys) && thumbnailKeys.length === cardThumbnails.length &&
    new Set(thumbnailKeys).size === thumbnailKeys.length && thumbnailKeys.every(key =>
      typeof key === 'string' && key !== 'video' && (key === order?.[0] || homepageFormats.has(key))), 'Invalid homepage thumbnails.');
  const canAddThumbnail = order ? order[0] !== 'video' : files.length > 0;
  check(thumbnails.length <= Number(canAddThumbnail) && !(thumbnails.length && cardThumbnails.length) &&
    animations.length <= videos.length, 'Invalid homepage previews.');
  const originals = [...files, ...videos];
  for (const file of originals) checkFile(file, maxFileSize, 'Each original must be 24 MB or smaller.');
  check(originals.reduce((size, file) => size + file.size, 0) <= maxUploadSize, 'Originals must total 25 MB or less per save.');
  for (const file of [...thumbnails, ...covers, ...cardThumbnails]) checkFile(file, maxThumbnailSize, 'Each cover must be 1 MB or smaller.');
  for (const file of animations) checkFile(file, maxAnimationSize, 'The animated preview must be 2 MB or smaller.');
  const prefix = `projects/uploads/${input.revision}`;
  const uploads = [];
  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `${prefix}-${index}.${fileExtension(bytes)}`;
    const dimensions = input.dimensions[index];
    check(dimensions && ['width', 'height'].every(key => Number.isInteger(dimensions[key]) && dimensions[key] > 0 && dimensions[key] <= 30000), 'Invalid image dimensions.');
    uploads.push({path, bytes, image: {src: `/${path}`, width: dimensions.width, height: dimensions.height}});
  }
  let thumbnailSrc;
  if (thumbnails.length) {
    const bytes = new Uint8Array(await thumbnails[0].arrayBuffer());
    const path = `${prefix}-thumb.${fileExtension(bytes)}`;
    thumbnailSrc = `/${path}`;
    if (!order) uploads[0].image.thumbnailSrc = thumbnailSrc;
    uploads.push({path, bytes});
  }
  const cardThumbnailPaths = new Map();
  for (const [index, file] of cardThumbnails.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `${prefix}-card-${index}.${fileExtension(bytes)}`;
    cardThumbnailPaths.set(thumbnailKeys[index], `/${path}`);
    uploads.push({path, bytes});
  }
  let video;
  if (videos.length) {
    const bytes = new Uint8Array(await videos[0].arrayBuffer());
    const decoder = new TextDecoder();
    const boxSize = bytes.length >= 16 ? new DataView(bytes.buffer).getUint32(0) : 0;
    check(boxSize >= 16 && boxSize <= bytes.length && decoder.decode(bytes.subarray(4, 8)) === 'ftyp' &&
      /^(?:iso[0-9m]|mp4[12]|avc1|M4V )$/.test(decoder.decode(bytes.subarray(8, 12))), 'Choose an MP4 video.');
    const dimensions = input.videoDimensions;
    check(dimensions && ['width', 'height', 'coverWidth', 'coverHeight'].every(key =>
      Number.isInteger(dimensions[key]) && dimensions[key] > 0 && dimensions[key] <= 30000), 'Invalid video dimensions.');
    const coverBytes = new Uint8Array(await covers[0].arrayBuffer());
    check(fileExtension(coverBytes) === 'jpg', 'The video cover must be JPEG.');
    const path = `${prefix}.mp4`;
    const coverPath = `${prefix}-video.jpg`;
    uploads.push({path, bytes}, {path: coverPath, bytes: coverBytes});
    video = {
      src: `/${path}`, width: dimensions.width, height: dimensions.height,
      cover: {src: `/${coverPath}`, width: dimensions.coverWidth, height: dimensions.coverHeight},
    };
    if (animations.length) {
      const bytes = new Uint8Array(await animations[0].arrayBuffer());
      const tag = (from, to) => decoder.decode(bytes.subarray(from, to));
      check(fileExtension(bytes) === 'webp' && tag(12, 16) === 'VP8X' &&
        (bytes[20] & 2) && tag(30, 34) === 'ANIM', 'The animated preview must be animated WebP.');
      const animationPath = `${prefix}-loop.webp`;
      video.animatedPreviewSrc = `/${animationPath}`;
      uploads.push({path: animationPath, bytes});
    }
  }
  return {
    create: input.create, expectedRevision: input.expectedRevision, uploads, video, order, thumbnailSrc, cardThumbnailPaths, homepageFormats: homepage === undefined ? undefined : homepageFormats,
    project: {id: input.id, revision: input.revision, title, date, type, format: input.format, links},
  };
}

function mediaPaths(project) {
  const images = [...project.images, project.video?.cover].filter(Boolean);
  return [...images.flatMap(image => [image.src, image.thumbnailSrc]), project.video?.src, project.video?.animatedPreviewSrc]
    .filter(src => typeof src === 'string' && /^\/projects\/(?:uploads|covers)\/[a-zA-Z0-9-]+\.(?:jpg|png|webp|mp4)$/.test(src))
    .map(src => src.slice(1));
}

export class GitHubProjects extends GitHubGallery {
  async api(path, method, body) {
    try {
      return await super.api(path, method, body);
    } catch (error) {
      if (error instanceof HttpError) error.message = 'GitHub could not load or save the projects. Please try again.';
      throw error;
    }
  }

  async projectFile(ref = this.env.GITHUB_BRANCH) {
    const file = await this.api(`/contents/${catalogPath}?ref=${encodeURIComponent(ref)}`);
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    const catalog = JSON.parse(new TextDecoder().decode(bytes));
    check(catalog.version === 1 && Array.isArray(catalog.projects), 'The project catalog could not be read.', 502);
    return catalog;
  }

  async readPublic() {
    const catalog = await this.projectFile();
    const base = `https://raw.githubusercontent.com/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/${encodeURIComponent(this.env.GITHUB_BRANCH)}`;
    const withFallback = media => media.src.startsWith('/projects/uploads/') ? {...media, fallbackSrc: base + media.src} : media;
    return {
      version: catalog.version,
      projects: catalog.projects.map(({revision, video, ...project}) => ({
        ...project,
        images: project.images.map(withFallback),
        ...(video && {video: {...withFallback(video), cover: withFallback(video.cover)}}),
      })),
    };
  }

  async save(edit) {
    return this.changeCatalog(catalog => {
      const index = catalog.projects.findIndex(project => project.id === edit.project.id);
      const previous = catalog.projects[index];
      if (previous?.revision === edit.project.revision) return null;
      check(edit.create ? !previous : previous && (previous.revision ?? null) === edit.expectedRevision,
        'This project has changed. Refresh the editor and try again.', 409);
      const newImages = edit.uploads.flatMap(upload => upload.image ? [upload.image] : []);
      const video = edit.video ?? previous?.video;
      const project = {...edit.project, images: newImages.length ? newImages : previous?.images ?? [], ...(video && {video})};
      if (edit.order) {
        const media = new Map((previous?.images ?? []).map((image, i) => [`image:${i}`, image]));
        newImages.forEach((image, i) => media.set(`new:${i}`, image));
        if (video) media.set('video', video);
        check(edit.order.length === media.size && new Set(edit.order).size === media.size &&
          edit.order.every(key => media.has(key)), 'The order must include each image and video exactly once.');
        const first = media.get(edit.order[0]);
        check(first, 'Add at least one image or video.');
        const imageKeys = edit.order.filter(key => key !== 'video');
        const selectedImages = new Set(imageKeys);
        check([...(edit.homepageFormats?.keys() ?? []), ...edit.cardThumbnailPaths.keys()].every(key => selectedImages.has(key)),
          'Homepage cards must reference images in this project.');
        project.images = imageKeys.map(key => {
          const image = {...media.get(key)};
          if (edit.homepageFormats) {
            const format = edit.homepageFormats.get(key);
            if (format) image.homepageFormat = format;
            else delete image.homepageFormat;
          }
          const thumbnail = edit.cardThumbnailPaths.get(key);
          if (thumbnail) image.thumbnailSrc = thumbnail;
          return image;
        });
        if (video) project.videoIndex = edit.order.indexOf('video');
        if (edit.thumbnailSrc) project.images[0] = {...project.images[0], thumbnailSrc: edit.thumbnailSrc};
        project.coverRatio = Math.max(1 / 3, Math.min(3, first.width / first.height));
      } else if (!newImages.length && !edit.video && previous?.coverRatio) {
        project.coverRatio = previous.coverRatio;
        if (video) project.videoIndex = previous.videoIndex;
      }
      if (edit.create) catalog.projects.unshift(project);
      else catalog.projects[index] = project;
      return {message: `${edit.create ? 'Add' : 'Update'} project: ${project.title}`};
    }, edit.uploads);
  }

  async deleteProject(edit) {
    return this.changeCatalog(catalog => {
      const index = catalog.projects.findIndex(project => project.id === edit.id);
      if (index < 0) return null;
      const project = catalog.projects[index];
      check((project.revision ?? null) === edit.expectedRevision,
        'This project has changed. Refresh the editor and try again.', 409);
      catalog.projects.splice(index, 1);
      const retained = new Set(catalog.projects.flatMap(mediaPaths));
      const files = [...new Set(mediaPaths(project))].filter(path => !retained.has(path));
      return {message: `Delete project: ${project.title}`, files};
    });
  }

  async changeCatalog(update, uploads = []) {
    let blobs;
    const branch = encodeURIComponent(this.env.GITHUB_BRANCH);
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.api(`/git/ref/heads/${branch}`);
      const head = ref.object.sha;
      const catalog = await this.projectFile(head);
      const change = update(catalog);
      if (!change) return catalog;

      if (!blobs) {
        blobs = [];
        for (const upload of uploads) {
          const blob = await this.api('/git/blobs', 'POST', {content: upload.bytes.toBase64?.() ?? base64(upload.bytes), encoding: 'base64'});
          blobs.push({path: upload.path, mode: '100644', type: 'blob', sha: blob.sha});
        }
      }
      const commit = await this.api(`/git/commits/${head}`);
      const removals = (change.files ?? []).map(path => ({path, mode: '100644', type: 'blob', sha: null}));
      const tree = await this.api('/git/trees', 'POST', {
        base_tree: commit.tree.sha,
        tree: [...blobs, ...removals, {path: catalogPath, mode: '100644', type: 'blob', content: JSON.stringify(catalog, null, 2) + '\n'}],
      });
      const next = await this.api('/git/commits', 'POST', {
        message: change.message, tree: tree.sha, parents: [head],
      });
      try {
        await this.api(`/git/refs/heads/${branch}`, 'PATCH', {sha: next.sha, force: false});
        return catalog;
      } catch (error) {
        if (![409, 422].includes(error.githubStatus) || attempt === 2) throw error;
      }
    }
  }
}
