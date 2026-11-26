import { uploadService, setProjectImage } from './catalog.js';
import { formats, platforms } from './formats.js';
import { imageThumbnail, videoPreviews } from './media-previews.js';

const login = document.querySelector('#login-form');
const editor = document.querySelector('#editor');
const form = document.querySelector('#project-form');
const status = document.querySelector('#admin-status');
const currentImages = document.querySelector('#current-images');
const selected = form.elements.project;
const deleteButton = document.querySelector('#delete-project');
const maxFileSize = 24 * 1024 * 1024;
const maxUploadSize = 25 * 1024 * 1024;
let token = '';
let apiBase = '';
let projects = [];
let newId;
let revision;
let busy = false;

for (const [key, {label}] of Object.entries(formats)) form.elements.format.add(new Option(label, key));

async function api(path, options = {}) {
  apiBase ||= await uploadService();
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...options.headers},
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') signOut();
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

function showProject() {
  const project = projects.find(item => item.id === selected.value);
  deleteButton.hidden = !project;
  for (const key of ['title', 'type', 'date']) form.elements[key].value = project?.[key] ?? '';
  form.elements.format.value = project?.format ?? 'a3';
  form.elements.images.value = '';
  form.elements.video.value = '';
  for (const key of Object.keys(platforms)) form.elements[key].value = project?.links?.[key] ?? '';

  currentImages.replaceChildren();
  const media = (project?.images ?? []).map((image, index) => ({
    image, label: index === 0 ? 'Cover' : `Image ${index + 1}`,
  }));
  if (project?.video) media.push({image: project.video.cover, label: 'Video'});
  for (const {image, label} of media) {
    const item = document.createElement('li');
    item.className = 'photo-list-item';
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.alt = project.title;
    img.loading = 'lazy';
    const fallbackSrc = image.src.startsWith('/projects/uploads/')
      ? `https://raw.githubusercontent.com/pan1ctreeh0useboy/pan1ctreeh0useboy.github.io/main${image.src}`
      : undefined;
    setProjectImage(img, {...image, src: image.thumbnailSrc ?? image.src, fallbackSrc: fallbackSrc ?? image.src});
    const caption = document.createElement('span');
    caption.textContent = label;
    item.append(img, caption);
    currentImages.append(item);
  }

  newId = crypto.randomUUID();
  revision = crypto.randomUUID();
}

function showProjects(id = 'new') {
  selected.replaceChildren(new Option('New project', 'new'), ...projects.map(project => new Option(project.title, project.id)));
  selected.value = id;
  showProject();
}

function signOut() {
  token = '';
  projects = [];
  editor.hidden = true;
  login.hidden = false;
  login.reset();
  login.elements.password.focus();
}

selected.addEventListener('change', showProject);
form.addEventListener('input', () => { revision = crypto.randomUUID(); });
document.querySelector('#logout').addEventListener('click', signOut);

login.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  login.querySelector('button').disabled = true;
  status.textContent = '';
  try {
    const result = await api('/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: login.elements.password.value}),
    });
    token = result.token;
    ({projects} = await api('/projects/editor'));
    login.reset();
    login.hidden = true;
    editor.hidden = false;
    showProjects(projects[0]?.id);
    selected.focus();
  } catch (error) {
    token = '';
    status.textContent = error.message;
  } finally {
    busy = false;
    login.querySelector('button').disabled = false;
  }
});

deleteButton.addEventListener('click', async () => {
  const project = projects.find(item => item.id === selected.value);
  if (busy || !project || !window.confirm(`Delete “${project.title}” from Projects?`)) return;
  busy = true;
  editor.inert = true;
  status.textContent = 'Deleting…';
  try {
    const result = await api('/projects/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: project.id, expectedRevision: project.revision ?? null}),
    });
    projects = result.catalog.projects;
    showProjects();
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    editor.inert = false;
    busy = false;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const previous = projects.find(item => item.id === selected.value);
  const files = Array.from(form.elements.images.files);
  const video = form.elements.video.files[0];
  const size = files.reduce((total, file) => total + file.size, video?.size ?? 0);
  if ((!previous && !files.length && !video) || files.length > 10 || video?.size > maxFileSize ||
      files.some(file => file.size > maxFileSize) || size > maxUploadSize) {
    status.textContent = 'Choose up to 10 images and one MP4, 24 MB per file and 25 MB total. New projects require media.';
    return;
  }

  busy = true;
  editor.inert = true;
  status.textContent = files.length || video ? 'Preparing homepage previews…' : 'Publishing…';
  const id = previous?.id ?? newId;
  try {
    const payload = new FormData();
    const dimensions = [];
    for (const [index, file] of files.entries()) {
      const bitmap = await createImageBitmap(file);
      try {
        dimensions.push({width: bitmap.width, height: bitmap.height});
        if (index === 0) payload.append('thumbnail', await imageThumbnail(bitmap), 'thumbnail');
      } finally {
        bitmap.close();
      }
    }
    let videoDimensions;
    let missingAnimation = false;
    if (video) {
      const {cover, animation, dimensions} = await videoPreviews(video);
      videoDimensions = dimensions;
      payload.append('video', video);
      payload.append('videoCover', cover, 'cover.jpg');
      if (animation) payload.append('videoAnimation', animation, 'preview.webp');
      else missingAnimation = true;
    }
    payload.set('metadata', JSON.stringify({
      id, revision, expectedRevision: previous?.revision ?? null, create: !previous, dimensions, videoDimensions,
      title: form.elements.title.value, date: form.elements.date.value,
      type: form.elements.type.value, format: form.elements.format.value,
      links: Object.fromEntries(Object.keys(platforms).map(key => [key, form.elements[key].value])),
    }));
    for (const file of files) payload.append('images', file);
    status.textContent = 'Publishing…';
    const result = await api('/projects/save', {method: 'POST', body: payload});
    projects = result.catalog.projects;
    showProjects(id);
    status.textContent = missingAnimation ? result.message + ' A static video cover was generated.' : result.message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    editor.inert = false;
    busy = false;
  }
});
