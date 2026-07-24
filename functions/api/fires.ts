import { getFires } from '../_lib/firms';
import { errorResponse, json } from '../_lib/http';
import { Env } from '../_lib/types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const data = await getFires(ctx.env, (p) => ctx.waitUntil(p));
    return json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};
