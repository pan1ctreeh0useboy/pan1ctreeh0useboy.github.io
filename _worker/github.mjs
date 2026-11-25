import { HttpError, applyUpload, applyPhotoEdit, base64 } from './core.mjs';

export class GitHubGallery {
  constructor(env, fetcher = fetch) { this.env = env; this.fetcher = fetcher; }
  async api(path, method = 'GET', body) {
    // Workers' native fetch rejects a repository instance as its receiver.
    const fetcher = this.fetcher;
    const response = await fetcher(`https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Treehouse-Photography', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = new HttpError(502, 'GitHub could not save the photographs. Please try again.');
      error.githubStatus = response.status;
      throw error;
    }
    return response.json();
  }
  async snapshot() {
    const branch = encodeURIComponent(this.env.GITHUB_BRANCH);
    const ref = await this.api(`/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const commit = await this.api(`/git/commits/${head}`);
    const file = await this.api(`/contents/photography/gallery.json?ref=${head}`);
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    return { head, tree: commit.tree.sha, gallery: JSON.parse(new TextDecoder().decode(bytes)) };
  }
  async read() { return (await this.snapshot()).gallery; }
  async checkUploadAccess() {
    // An unreferenced, fixed blob tests Contents write access without changing
    // the gallery, creating a test photograph or updating any branch.
    await this.api('/git/blobs', 'POST', { content: 'Treehouse Photography upload access check\n', encoding: 'utf-8' });
    return { ready: true };
  }
  async publish(upload) {
    let blobs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot();
      const change = applyUpload(snapshot.gallery, upload);
      if (change.duplicate) return { gallery: change.data, duplicate: true };
      // Upload each image once. A branch race retries against the newest gallery.
      if (!blobs) {
        blobs = [];
        for (const photo of upload.photos) {
          const blob = await this.api('/git/blobs', 'POST', { content: base64(photo.bytes), encoding: 'base64' });
          blobs.push({ path: photo.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
      }
      const tree = await this.api('/git/trees', 'POST', {
        base_tree: snapshot.tree,
        tree: [...blobs, { path: 'photography/gallery.json', mode: '100644', type: 'blob', content: JSON.stringify(change.data, null, 2) + '\n' }],
      });
      const commit = await this.api('/git/commits', 'POST', { message: `Add photographs to ${upload.location.name}`, tree: tree.sha, parents: [snapshot.head] });
      try {
        await this.api(`/git/refs/heads/${encodeURIComponent(this.env.GITHUB_BRANCH)}`, 'PATCH', { sha: commit.sha, force: false });
        return { gallery: change.data, duplicate: false };
      } catch (error) {
        if (![409, 422].includes(error.githubStatus) || attempt === 2) throw error;
      }
    }
  }
  async editPhoto(edit) {
    let blob;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot();
      const change = applyPhotoEdit(snapshot.gallery, edit);
      if (change.duplicate) return { gallery: change.data, duplicate: true };
      if (edit.action === 'replace' && !blob) blob = await this.api('/git/blobs', 'POST', { content: base64(edit.bytes), encoding: 'base64' });
      const entries = [{ path: change.oldPath, mode: '100644', type: 'blob', sha: null }];
      if (blob) entries.push({ path: edit.path, mode: '100644', type: 'blob', sha: blob.sha });
      entries.push({ path: 'photography/gallery.json', mode: '100644', type: 'blob', content: JSON.stringify(change.data, null, 2) + '\n' });
      const tree = await this.api('/git/trees', 'POST', { base_tree: snapshot.tree, tree: entries });
      const commit = await this.api('/git/commits', 'POST', { message: `${edit.action === 'replace' ? 'Replace' : 'Delete'} photograph in ${edit.locationId}`, tree: tree.sha, parents: [snapshot.head] });
      try {
        await this.api(`/git/refs/heads/${encodeURIComponent(this.env.GITHUB_BRANCH)}`, 'PATCH', { sha: commit.sha, force: false });
        return { gallery: change.data, duplicate: false };
      } catch (error) {
        if (![409, 422].includes(error.githubStatus) || attempt === 2) throw error;
      }
    }
  }
}
