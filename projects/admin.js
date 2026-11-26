import { uploadService, setProjectImage } from './catalog.js';
import { formats, platforms } from './formats.js';
import { imageThumbnail, videoPreviews } from './media-previews.js?v=homepage-cards';
import { orderedMedia } from './media-order.js';

const login = document.querySelector('#login-form');
const editor = document.querySelector('#editor');
const form = document.querySelector('#project-form');
const status = document.querySelector('#admin-status');
const mediaList = document.querySelector('#project-media');
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
let media = [];

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

function releasePreviews() {
  for (const item of media) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

function homepageControls(item, index) {
  const controls = document.createElement('div');
  controls.className = 'homepage-controls';

  const show = document.createElement('input');
  show.type = 'checkbox';
  show.checked = !!item.showOnHomepage;
  show.setAttribute('aria-label', `Show item ${index + 1} on homepage`);
  const showLabel = document.createElement('label');
  showLabel.append(show, ' Show on homepage');

  const format = document.createElement('select');
  format.setAttribute('aria-label', `Container type for item ${index + 1}`);
  format.add(new Option('Match image', 'auto'));
  for (const [key, {label}] of Object.entries(formats)) format.add(new Option(label, key));
  format.value = item.homeFormat ?? 'auto';
  format.disabled = !show.checked;
  const formatLabel = document.createElement('label');
  formatLabel.append('Container type', format);

  show.addEventListener('change', () => {
    item.showOnHomepage = show.checked;
    format.disabled = !show.checked;
  });
  format.addEventListener('change', () => { item.homeFormat = format.value; });
  controls.append(showLabel, formatLabel);
  return controls;
}

function renderMedia() {
  mediaList.replaceChildren();
  for (const [index, item] of media.entries()) {
    const row = document.createElement('li');
    row.className = 'photo-list-item';
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.alt = '';
    img.loading = 'lazy';
    const image = item.image ?? item.video?.cover;
    const fallbackSrc = image?.src.startsWith('/projects/uploads/')
      ? `https://raw.githubusercontent.com/pan1ctreeh0useboy/pan1ctreeh0useboy.github.io/main${image.src}`
      : image?.src;
    if (item.previewUrl) img.src = item.previewUrl;
    else if (image) setProjectImage(img, {...image, src: image.thumbnailSrc ?? image.src, fallbackSrc});

    const label = document.createElement('span');
    label.className = 'media-label';
    const name = item.file?.name ?? (item.kind === 'video' ? 'Video' : `Image ${item.index + 1}`);
    label.textContent = `${index === 0 ? 'Cover · ' : ''}${name}`;

    const actions = document.createElement('span');
    actions.className = 'media-actions';
    for (const [delta, arrow, direction] of [[-1, '↑', 'up'], [1, '↓', 'down']]) {
      const move = document.createElement('button');
      move.type = 'button';
      move.textContent = arrow;
      move.setAttribute('aria-label', `Move item ${index + 1} ${direction}`);
      const next = index + delta;
      move.disabled = next < 0 || next >= media.length;
      move.addEventListener('click', () => {
        [media[next], media[index]] = [media[index], media[next]];
        revision = crypto.randomUUID();
        renderMedia();
        const buttons = [...mediaList.children[next].querySelectorAll('button')];
        (buttons.find(button => button.textContent === arrow && !button.disabled) ??
          buttons.find(button => !button.disabled))?.focus();
      });
      actions.append(move);
    }
    if (item.file) {
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.textContent = '×';
      discard.setAttribute('aria-label', `Discard ${name}`);
      discard.addEventListener('click', () => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.video) media[index] = {kind: 'video', video: item.video};
        else media.splice(index, 1);
        revision = crypto.randomUUID();
        renderMedia();
      });
      actions.append(discard);
    }
    const preview = img.hasAttribute('src') ? img : document.createElement('span');
    row.append(preview, label, actions);
    if (index > 0 && item.kind === 'image') row.append(homepageControls(item, index));
    mediaList.append(row);
  }
}

function showProject() {
  const project = projects.find(item => item.id === selected.value);
  deleteButton.hidden = !project;
  for (const key of ['title', 'type', 'date']) form.elements[key].value = project?.[key] ?? '';
  form.elements.images.value = '';
  form.elements.video.value = '';
  for (const key of Object.keys(platforms)) form.elements[key].value = project?.links?.[key] ?? '';

  releasePreviews();
  media = project ? orderedMedia(project).map(item => ({
    ...item, showOnHomepage: !!item.image?.homepageFormat, homeFormat: item.image?.homepageFormat,
  })) : [];
  renderMedia();
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
  releasePreviews();
  media = [];
  projects = [];
  editor.hidden = true;
  login.hidden = false;
  login.reset();
  login.elements.password.focus();
}

selected.addEventListener('change', showProject);
form.addEventListener('input', () => { revision = crypto.randomUUID(); });
form.elements.images.addEventListener('change', () => {
  for (const file of form.elements.images.files) {
    media.push({kind: 'image', file, previewUrl: URL.createObjectURL(file)});
  }
  form.elements.images.value = '';
  renderMedia();
});
form.elements.video.addEventListener('change', () => {
  const file = form.elements.video.files[0];
  if (!file) return;
  const existing = media.find(item => item.kind === 'video');
  if (existing) existing.file = file;
  else media.push({kind: 'video', file});
  form.elements.video.value = '';
  renderMedia();
});

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
  const files = media.filter(item => item.kind === 'image' && item.file).map(item => item.file);
  const video = media.find(item => item.kind === 'video')?.file;
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
    const thumbnailKeys = [];
    let newImageIndex = 0;
    const items = media.map(item => ({
      ...item,
      key: item.kind === 'video' ? 'video' : item.file ? `new:${newImageIndex++}` : `image:${item.index}`,
    }));
    const order = items.map(item => item.key);
    const homepage = items.filter(item => item.showOnHomepage).map(item => [item.key, item.homeFormat ?? 'auto']);

    for (const [index, item] of items.entries()) {
      if (item.kind !== 'image') continue;
      const needsThumbnail = (index === 0 || item.showOnHomepage) && !item.image?.thumbnailSrc;
      if (!item.file && !needsThumbnail) continue;
      status.textContent = 'Preparing homepage previews…';
      let source = item.file;
      if (!source) {
        try {
          const response = await fetch(item.image.src, {signal: AbortSignal.timeout(15000)});
          if (response.ok) source = await response.blob();
        } catch {
          // Keep saved originals usable while a Pages build is still publishing.
        }
        if (!source) continue;
      }
      const bitmap = await createImageBitmap(source);
      try {
        if (item.file) dimensions.push({width: bitmap.width, height: bitmap.height});
        if (needsThumbnail) {
          payload.append('cardThumbnail', await imageThumbnail(bitmap), 'thumbnail');
          thumbnailKeys.push(item.key);
        }
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
      id, revision, expectedRevision: previous?.revision ?? null, create: !previous, dimensions, videoDimensions, order, homepage, thumbnailKeys,
      title: form.elements.title.value, date: form.elements.date.value,
      type: form.elements.type.value, format: previous?.format ?? 'square',
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
