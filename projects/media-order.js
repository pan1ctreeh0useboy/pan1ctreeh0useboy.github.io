export function orderedMedia(project) {
  const media = project.images.map((image, index) => ({kind: 'image', index, image}));
  if (project.video) media.splice(project.videoIndex ?? 0, 0, {kind: 'video', video: project.video});
  return media;
}

export function homepageCover(project) {
  // Older projects put videos first on the detail page and preferred an image for the homepage.
  if (!project.coverRatio) return project.images[0] ?? project.video?.cover;
  if (project.video && project.videoIndex === 0) return project.video.cover;
  return project.images[0];
}
