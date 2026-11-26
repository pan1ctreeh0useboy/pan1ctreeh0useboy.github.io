export async function uploadService() {
  const response = await fetch('/photography/config.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('The upload service could not be reached.');
  const {apiBase} = await response.json();
  if (!apiBase) throw new Error('The upload service is not connected.');
  const url = new URL(apiBase, location.origin);
  if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error('Invalid upload service address.');
  return url.href.replace(/\/$/, '');
}

async function getCatalog(url, options) {
  const response = await fetch(url, {cache: 'no-cache', ...options});
  if (!response.ok) throw new Error('Projects could not be loaded.');
  const catalog = await response.json();
  if (catalog.version !== 1 || !Array.isArray(catalog.projects)) throw new Error('Invalid project catalog.');
  return catalog.projects;
}

async function readLiveProjects() {
  const api = await uploadService();
  return getCatalog(api + '/projects/catalog', {signal: AbortSignal.timeout(4500)});
}

export async function readProjects({staticFirst = false} = {}) {
  const readStatic = () => getCatalog('/projects/catalog.json');
  try {
    return await (staticFirst ? readStatic() : readLiveProjects());
  } catch {
    return staticFirst ? readLiveProjects() : readStatic();
  }
}

export function setProjectImage(img, image) {
  const main = image.src;
  if (image.fallbackSrc && image.fallbackSrc !== main) {
    img.addEventListener('error', () => { img.src = image.fallbackSrc; }, {once: true});
  }
  img.width = image.width;
  img.height = image.height;
  img.src = main;
}
