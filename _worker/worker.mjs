import { HttpError, boundedBody, check, passwordMatches, createSession, validSession, parseUpload, parsePhotoEdit } from './core.mjs';
import { GitHubGallery } from './github.mjs';
import { GitHubProjects, parseProjectSave } from './projects.mjs';

export function createHandler(makeRepository = env => new GitHubGallery(env), makeProjects = env => new GitHubProjects(env)) {
  return async function handle(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!origin || !allowed.includes(origin)) return reply({ error: 'This website is not allowed to upload.' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/projects/catalog') {
        return reply(await makeProjects(env).readPublic());
      }
      check(env.ADMIN_PASSWORD && env.SESSION_SECRET?.length >= 32, 'Uploads are not connected yet.', 503);
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      if (request.method === 'POST' && path === '/login') {
        check(env.LOGIN_LIMITER, 'Uploads are not connected yet.', 503);
        const limit = await env.LOGIN_LIMITER.limit({ key: ip });
        check(limit.success, 'Too many attempts. Please wait one minute.', 429);
        let input;
        try { input = JSON.parse(new TextDecoder().decode(await boundedBody(request, 1024))); }
        catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Please enter your password.'); }
        check(typeof input?.password === 'string' && input.password.length <= 200, 'Please enter your password.');
        check(await passwordMatches(input.password, env.ADMIN_PASSWORD), 'Incorrect password.', 401);
        return reply({ token: await createSession(env.SESSION_SECRET), expiresIn: 1800 });
      }
      check(await validSession(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.SESSION_SECRET), 'Please sign in again.', 401);
      if (request.method === 'GET' && path === '/projects/editor') return reply(await makeProjects(env).projectFile());
      if (request.method === 'POST' && path === '/projects/save') {
        check(env.UPLOAD_LIMITER, 'Uploads are not connected yet.', 503);
        check((await env.UPLOAD_LIMITER.limit({key: ip})).success, 'Please wait one minute before saving again.', 429);
        return reply({catalog: await makeProjects(env).save(await parseProjectSave(request)), message: 'Project published.'});
      }
      const repository = makeRepository(env);
      if (request.method === 'GET' && path === '/gallery') return reply(await repository.read());
      if (request.method === 'POST' && path === '/check-upload') {
        check(env.UPLOAD_LIMITER, 'Uploads are not connected yet.', 503);
        check((await env.UPLOAD_LIMITER.limit({ key: ip })).success, 'Please wait one minute before trying again.', 429);
        return reply(await repository.checkUploadAccess());
      }
      if (request.method === 'POST' && path === '/upload') {
        check(env.UPLOAD_LIMITER, 'Uploads are not connected yet.', 503);
        check((await env.UPLOAD_LIMITER.limit({ key: ip })).success, 'Please wait one minute before uploading again.', 429);
        const result = await repository.publish(await parseUpload(request));
        return reply({ ...result, message: env.LOCAL_PREVIEW === 'true' ? 'Saved to this computer only.' : 'Saved. GitHub Pages may take a few minutes to show the photographs.' });
      }
      if (request.method === 'POST' && path === '/edit-photo') {
        check(env.UPLOAD_LIMITER, 'Uploads are not connected yet.', 503);
        check((await env.UPLOAD_LIMITER.limit({ key: ip })).success, 'Please wait one minute before editing again.', 429);
        const result = await repository.editPhoto(await parsePhotoEdit(request));
        return reply({ ...result, message: env.LOCAL_PREVIEW === 'true' ? 'Saved to this computer only.' : 'Saved. GitHub Pages may take a few minutes to update.' });
      }
      return reply({ error: 'Not found.' }, 404);
    } catch (error) {
      return reply({ error: error instanceof HttpError ? error.message : 'The upload could not be completed. Please try again.' }, error instanceof HttpError ? error.status : 500);
    }
  };
}
export default { fetch: createHandler() };
