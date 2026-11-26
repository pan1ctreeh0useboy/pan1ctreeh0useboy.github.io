import { HttpError, base64, check, fileExtension, text } from './core.mjs';
import { GitHubGallery } from './github.mjs';
import { formats, platforms, platformUrl } from '../projects/formats.js';

const catalogPath = 'projects/catalog.json';
const maxFileSize = 24 * 1024 * 1024;
const maxUploadSize = 25 * 1024 * 1024;
const maxBodySize = 26 * 1024 * 1024;
const projectId = /^[a-z0-9][a-z0-9-]{0,79}$/;
const revisionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  check(input && projectId.test(input.id) && typeof input.id === 'string', 'Invalid project identifier.');
  check(typeof input.revision === 'string' && revisionId.test(input.revision), 'Invalid save identifier.');
  check(input.expectedRevision === null || typeof input.expectedRevision === 'string' && revisionId.test(input.expectedRevision), 'Invalid previous version.');
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
    links[key] = url.trim() ? platformUrl(key, url.trim()) : '';
    check(!url.trim() || links[key], `Enter an HTTPS link from ${platform.label}.`);
  }

  const files = form.getAll('images');
  const videos = form.getAll('video');
  const covers = form.getAll('videoCover');
  check(files.length <= 10 && videos.length <= 1, 'Choose up to 10 images and one MP4 video.');
  check(!input.create || files.length || videos.length, 'New projects require an image or a video.');
  check(files.length === input.dimensions?.length, 'Image dimensions are incomplete.');
  check(covers.length === videos.length, 'The video cover is missing.');
  const media = [...files, ...videos, ...covers];
  check(media.every(file => typeof file.arrayBuffer === 'function' && file.size > 0 && file.size <= maxFileSize), 'Each file must be 24 MB or smaller.');
  check(media.reduce((size, file) => size + file.size, 0) <= maxUploadSize, 'Media must total 25 MB or less per save.');
  const uploads = [];
  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `projects/uploads/${input.revision}-${index}.${fileExtension(bytes)}`;
    const dimensions = input.dimensions[index];
    check(dimensions && ['width', 'height'].every(key => Number.isInteger(dimensions[key]) && dimensions[key] > 0 && dimensions[key] <= 30000), 'Invalid image dimensions.');
    uploads.push({path, bytes, image: {src: `/${path}`, width: dimensions.width, height: dimensions.height}});
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
    const path = `projects/uploads/${input.revision}.mp4`;
    const coverPath = `projects/uploads/${input.revision}-video.jpg`;
    uploads.push({path, bytes}, {path: coverPath, bytes: coverBytes});
    video = {
      src: `/${path}`, width: dimensions.width, height: dimensions.height,
      cover: {src: `/${coverPath}`, width: dimensions.coverWidth, height: dimensions.coverHeight},
    };
  }
  return {
    create: input.create, expectedRevision: input.expectedRevision, uploads, video,
    project: {id: input.id, revision: input.revision, title, date, type, format: input.format, links},
  };
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
    let blobs;
    const branch = encodeURIComponent(this.env.GITHUB_BRANCH);
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.api(`/git/ref/heads/${branch}`);
      const head = ref.object.sha;
      const catalog = await this.projectFile(head);
      const index = catalog.projects.findIndex(project => project.id === edit.project.id);
      const previous = catalog.projects[index];
      if (previous?.revision === edit.project.revision) return catalog;
      check(edit.create ? !previous : previous && previous.revision === edit.expectedRevision, 'This project has changed. Refresh the editor and try again.', 409);
      const newImages = edit.uploads.flatMap(upload => upload.image ? [upload.image] : []);
      const images = newImages.length ? newImages : previous?.images ?? [];
      const video = edit.video ?? previous?.video;
      const project = {...edit.project, images, ...(video && {video})};
      if (edit.create) catalog.projects.unshift(project);
      else catalog.projects[index] = project;

      if (!blobs) {
        blobs = [];
        for (const upload of edit.uploads) {
          const blob = await this.api('/git/blobs', 'POST', {content: upload.bytes.toBase64?.() ?? base64(upload.bytes), encoding: 'base64'});
          blobs.push({path: upload.path, mode: '100644', type: 'blob', sha: blob.sha});
        }
      }
      const commit = await this.api(`/git/commits/${head}`);
      const tree = await this.api('/git/trees', 'POST', {
        base_tree: commit.tree.sha,
        tree: [...blobs, {path: catalogPath, mode: '100644', type: 'blob', content: JSON.stringify(catalog, null, 2) + '\n'}],
      });
      const next = await this.api('/git/commits', 'POST', {
        message: `${edit.create ? 'Add' : 'Update'} project: ${project.title}`, tree: tree.sha, parents: [head],
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
