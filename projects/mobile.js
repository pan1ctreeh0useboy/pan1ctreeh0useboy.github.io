import { readProjects, setProjectImage } from './catalog.js?v=fast-feed';
import { chooseLayout, dividers } from './layout.js';
import { formats } from './formats.js';
import { homepageCover } from './media-order.js';

const feed = document.querySelector('#projects-feed');
const projectsPerBand = 6;
// The separate desktop layout can use the same dataset and layout engine later.
const compact = matchMedia('(max-width: 680px)');
const setPreviewVisibility = new WeakMap();
const previewObserver = new IntersectionObserver(entries => {
  for (const {target, intersectionRatio} of entries) {
    setPreviewVisibility.get(target)(intersectionRatio >= 0.2);
  }
}, {threshold: 0.2});

function addPreview(card, media) {
  const video = document.createElement('video');
  video.defaultMuted = true;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'none';
  video.setAttribute('aria-hidden', 'true');
  card.prepend(video);

  const animation = media.animatedPreviewSrc ? document.createElement('img') : null;
  let visible = false;
  let autoplayBlocked = false;
  let startTimeout;

  function hideAnimation() {
    if (!animation) return;
    animation.hidden = true;
    animation.removeAttribute('src');
  }

  function showAnimation() {
    if (!animation || !visible || !card.isConnected || card.classList.contains('preview-playing')) return;
    if (!animation.hasAttribute('src')) animation.src = media.animatedPreviewSrc;
    if (animation.naturalWidth > 0) animation.hidden = false;
  }

  if (animation) {
    animation.className = 'preview-animation';
    animation.alt = '';
    animation.hidden = true;
    animation.addEventListener('load', showAnimation);
    card.append(animation);
  }

  video.addEventListener('playing', () => {
    clearTimeout(startTimeout);
    card.classList.add('preview-playing');
    hideAnimation();
  });
  video.addEventListener('error', () => {
    card.classList.remove('preview-playing');
    showAnimation();
    if (media.fallbackSrc && video.src !== media.fallbackSrc) video.src = media.fallbackSrc;
  });

  setPreviewVisibility.set(card, inView => {
    visible = inView;
    clearTimeout(startTimeout);
    video.autoplay = inView && !autoplayBlocked;
    if (!inView) {
      video.pause();
      hideAnimation();
      return;
    }
    if (autoplayBlocked) {
      showAnimation();
      return;
    }

    if (!video.hasAttribute('src')) video.src = media.src;
    if (animation) startTimeout = setTimeout(showAnimation, 1500);
    video.play().catch(error => {
      if (!visible || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        autoplayBlocked = true;
        video.autoplay = false;
      }
      clearTimeout(startTimeout);
      showAnimation();
    });
  });
  previewObserver.observe(card);
}

function draw(projects) {
  previewObserver.disconnect();
  feed.querySelectorAll('.project-cover').forEach(card => setPreviewVisibility.get(card)?.(false));
  const fragment = document.createDocumentFragment();
  let exitGuides = [];
  for (let start = 0; start < projects.length; start += projectsPerBand) {
    const items = projects.slice(start, start + projectsPerBand);
    const {height, rectangles} = chooseLayout(items, compact.matches, exitGuides);
    exitGuides = dividers(rectangles, 'x', 1)
      .filter(line => line.spans.some(span => Math.abs(span.to - height) < 1e-6))
      .map(line => line.position);

    const band = document.createElement('div');
    band.className = 'project-band';
    band.style.aspectRatio = String(1 / height);
    rectangles.forEach(({x, y, width, height: tileHeight}, index) => {
      const {project} = items[index];
      const detail = document.createElement('a');
      detail.className = 'project-cover';
      detail.href = '/project_mobile.html?id=' + encodeURIComponent(project.id);
      const inset = [y / height, 1 - x - width, 1 - (y + tileHeight) / height, x];
      detail.style.inset = inset.map(value => (Math.max(0, value) * 100).toFixed(6) + '%').join(' ');
      const img = document.createElement('img');
      img.alt = project.title;
      img.decoding = 'async';
      if (start || index > 1) img.loading = 'lazy';
      else if (index === 0) img.fetchPriority = 'high';
      const cover = homepageCover(project);
      setProjectImage(img, cover.thumbnailSrc ? {...cover, src: cover.thumbnailSrc, fallbackSrc: cover.src} : cover);
      detail.append(img);
      if (project.video) addPreview(detail, project.video);
      band.append(detail);
    });
    fragment.append(band);
  }
  feed.replaceChildren(fragment);
}

try {
  const projects = (await readProjects({staticFirst: true}))
    .filter(project => Object.hasOwn(formats, project.format) && (project.images?.length || project.video?.cover))
    .map(project => {
      const preset = formats[project.format];
      return {project, format: {...preset, ratio: project.coverRatio ?? preset.ratio}};
    });
  draw(projects);
  compact.addEventListener('change', () => draw(projects));
} catch (error) {
  console.error(error);
}
