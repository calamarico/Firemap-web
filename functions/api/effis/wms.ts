import { fetchEffisTile } from '../../_lib/effis';
import { errorResponse } from '../../_lib/http';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const params = new URL(ctx.request.url).searchParams;
    const tile = await fetchEffisTile(
      params.get('range') ?? '7d',
      params.get('bbox') ?? '',
      params.get('width') ?? '256',
      params.get('height') ?? '256'
    );
    return new Response(tile.body, {
      headers: {
        'Content-Type': tile.contentType,
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
