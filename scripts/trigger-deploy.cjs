// Hooks are secrets: never print URLs, response bodies, or raw network errors.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

async function main() {
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Missing valid commit SHA');
  const hooks = [
    ['Render', process.env.RENDER_DEPLOY_HOOK, 'api.render.com', '/deploy/'],
    ['Vercel', process.env.VERCEL_DEPLOY_HOOK, 'api.vercel.com', '/v1/integrations/deploy/'],
  ].map(([name, value, host, prefix]) => {
    if (!value) throw new Error(`Configure ${name.toUpperCase()}_DEPLOY_HOOK in GitHub Actions secrets`);
    let url;
    try { url = new URL(value); } catch { throw new Error(`Invalid ${name} deploy hook`); }
    if (url.protocol !== 'https:' || url.hostname !== host || !url.pathname.startsWith(prefix) || url.username || url.password || url.port || url.hash) {
      throw new Error(`Invalid ${name} deploy hook`);
    }
    if (name === 'Render') url.searchParams.set('ref', sha);
    return { name, url };
  });
  // Avoid releasing an older queued workflow after another commit reached main.
  const latest = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  if (latest !== sha) {
    console.log('Superseded by a newer main commit; its workflow will deploy.');
    return;
  }
  const results = await Promise.all(hooks.map(async ({ name, url }) => {
    try {
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000) });
      return { name, ok: response.ok, status: response.status };
    } catch { return { name, ok: false, status: 'network error' }; }
  }));
  const summary = results.map(r => `${r.name}: ${r.ok ? 'deployment request accepted' : `trigger failed (${r.status})`}`).join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\nThese are trigger results, not confirmation that hosting builds are live. Check Render and Vercel deployment status.\n`);
  if (results.some(r => !r.ok)) throw new Error('Deployment trigger failed; see provider result above');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
