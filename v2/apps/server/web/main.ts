/* Server edition in the browser: the shared UI over fetch. The token arrives once in the URL (#t=…) and stays in
   sessionStorage for this tab only. */
import { mount, type Backend } from '@fuelpro/ui';

const m = /[#&]t=([\w-]+)/.exec(location.hash);
if (m) { try { sessionStorage.setItem('fpv2', m[1]); } catch { /* private mode */ } history.replaceState(null, '', location.pathname); }
const token = (() => { try { return sessionStorage.getItem('fpv2') || ''; } catch { return m ? m[1] : ''; } })();

async function req<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query) : '';
  let r: Response;
  try {
    r = await fetch('/api/v2' + path + qs, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw { status: 0, code: 'NETWORK', message: 'Network error' }; }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw { status: r.status, ...(j && j.error ? j.error : { code: 'HTTP_' + r.status, message: r.statusText }) };
  return j as T;
}
const be: Backend = {
  mode: 'server',
  stationId: async () => (await req<{ station_id: number | null }>('GET', '/state')).station_id,
  call: req,
  firstRun: async (b) => { await req('POST', '/first-run', b); }
};
mount(document.getElementById('app')!, be);
