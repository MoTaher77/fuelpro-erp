/* The desktop and phone editions: the core runs in the app itself on a local SQLite file, fully offline.
   The device's single user is the organisation owner (a local PIN / OS lock comes with the users module). */
import { api, setup, type Ctx } from '@fuelpro/core';
import type { Backend } from '@fuelpro/ui';

export function localBackend(open: () => Promise<Ctx>, mode: 'desktop' | 'phone'): Backend {
  let ctxP: Promise<Ctx> | null = null;
  const ctx = () => (ctxP ||= open());
  // errors cross into the UI as plain objects, exactly as the server edition sends them
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { const { status, body } = api.errorBody(e); if (status === 500) console.error(e); throw { status, ...body.error }; }
  };
  return {
    mode,
    stationId: () => wrap(async () => (await setup.firstOwner(await ctx()))?.station_id ?? null),
    firstRun: (b) => wrap(async () => { await setup.firstRun(await ctx(), b); }),
    call: <T>(method: string, path: string, body?: unknown, query?: Record<string, string>) => wrap(async () => {
      const c = await ctx(), owner = await setup.firstOwner(c);
      if (!owner) throw new Error('not set up');
      return (await api.call(c, owner, method, path, body, query)) as T;
    })
  };
}
