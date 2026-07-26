/**
 * Genera client/public/sitemap.xml: la home + una URL por página de localidad
 * (/incendios/<slug>, servidas por functions/incendios/[slug].ts).
 *
 * Deriva del meta de municipios (campo `s` de muni-meta.json), así que hay que
 * regenerarlo tras cada build:muni-index — el script de npm los encadena.
 * ~8.500 URLs caben con holgura en un solo urlset (límite: 50.000 / 50 MB).
 *
 * Uso:  node scripts/build-sitemap.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://firemapsspain.online';

const meta = JSON.parse(
  readFileSync(path.join(root, 'client', 'public', 'data', 'muni-meta.json'), 'utf8')
);

const seen = new Set();
for (const m of meta.municipalities) {
  if (!m.s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.s) || seen.has(m.s)) {
    throw new Error(`Slug inválido o duplicado en muni-meta.json: "${m.s}" (${m.n})`);
  }
  seen.add(m.s);
}

const urls = [
  `  <url>\n    <loc>${ORIGIN}/</loc>\n    <changefreq>hourly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ...meta.municipalities.map(
    (m) =>
      `  <url>\n    <loc>${ORIGIN}/incendios/${m.s}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.5</priority>\n  </url>`
  ),
];

const out = path.join(root, 'client', 'public', 'sitemap.xml');
writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
);

console.log(`${urls.length} URLs → ${path.relative(root, out)}`);
