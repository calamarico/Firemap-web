import { getEffisStatus } from '../../_lib/effis';
import { errorResponse, json } from '../../_lib/http';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async () => {
  try {
    return json(await getEffisStatus(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
};
