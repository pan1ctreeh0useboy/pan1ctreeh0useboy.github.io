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

export async function readProjects() {
  try {
    const api = await uploadService();
    return await getCatalog(api + '/projects/catalog', {signal: AbortSignal.timeout(4500)});
  } catch {
    return getCatalog('/projects/catalog.json');
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
