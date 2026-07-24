import { json } from '../_lib/http';

export const onRequestGet: PagesFunction = async () => json({ ok: true });
