import { readProjects, setProjectImage } from './catalog.js';
import { platforms, platformUrl } from './formats.js';

const projectId = new URLSearchParams(location.search).get('id');

function showProject(project) {
  document.querySelector('#project-title').textContent = project.title;
  document.querySelector('#project-date').textContent = project.date.slice(2).replaceAll('-', '.');
  document.querySelector('#project-type').textContent = project.type;
  const slider = document.querySelector('.slider');
  const slideTemplate = document.querySelector('#slide-template');
  if (project.video) {
    const media = project.video;
    const slide = slideTemplate.content.cloneNode(true);
    slide.querySelector('.vertical-text').textContent = 'Video';
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', project.title);
    video.width = media.width;
    video.height = media.height;
    video.poster = media.cover.src;
    if (media.fallbackSrc) {
      video.addEventListener('error', () => {
        video.poster = media.cover.fallbackSrc ?? media.cover.src;
        video.src = media.fallbackSrc;
      }, {once: true});
    }
    video.src = media.src;
    slide.querySelector('img').replaceWith(video);
    slider.append(slide);
  }
  project.images.forEach((image, index) => {
    const slide = slideTemplate.content.cloneNode(true);
    slide.querySelector('.vertical-text').textContent = image.caption || `fig.${index + 1} ${project.type}`;
    const img = slide.querySelector('img');
    setProjectImage(img, image);
    // Match the original template, where the source image controls its natural size.
    img.removeAttribute('width');
    img.removeAttribute('height');
    slider.append(slide);
  });

  for (const key of Object.keys(platforms)) {
    const url = platformUrl(key, project.links?.[key]);
    if (!url) continue;
    const img = document.querySelector(`.${key}-icon img`);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    img.replaceWith(link);
    link.append(img);
  }
  document.querySelector('#project').hidden = false;
}

try {
  const project = (await readProjects()).find(item => item.id === projectId);
  if (project) showProject(project);
  else document.querySelector('#project-error').hidden = false;
} catch (error) {
  console.error(error);
  document.querySelector('#project-error').hidden = false;
}
