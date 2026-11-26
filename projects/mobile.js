import { readProjects, setProjectImage } from './catalog.js';
import { chooseLayout, dividers } from './layout.js';
import { formats } from './formats.js';

const feed = document.querySelector('#projects-feed');
const projectsPerBand = 6;
// The separate desktop layout can use the same dataset and layout engine later.
const compact = matchMedia('(max-width: 680px)');

function draw(projects) {
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
      if (start) img.loading = 'lazy';
      setProjectImage(img, project.images?.[0] ?? project.video.cover);
      detail.append(img);
      band.append(detail);
    });
    fragment.append(band);
  }
  feed.replaceChildren(fragment);
}

try {
  const projects = (await readProjects())
    .filter(project => Object.hasOwn(formats, project.format) && (project.images?.length || project.video?.cover))
    .map(project => ({project, format: formats[project.format]}));
  draw(projects);
  compact.addEventListener('change', () => draw(projects));
} catch (error) {
  console.error(error);
}
