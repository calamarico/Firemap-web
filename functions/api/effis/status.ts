import { getEffisStatus } from '../../_lib/effis';
import { errorResponse, json } from '../../_lib/http';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const status = await getEffisStatus((p) => ctx.waitUntil(p));
    return json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};
