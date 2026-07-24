import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { fetchEffisTile, getEffisStatus } from './effis';
import { getFires } from './firms';
import { ApiError, ApiErrorBody } from './types';

const app = express();

// En dev el frontend llega vía el proxy de Vite (mismo origen), pero se
// habilita CORS abierto por si se consume el proxy desde otro puerto/origen.
app.use(cors());
// gzip: imprescindible para servir el GeoJSON de municipios (7,5 MB → ~2 MB)
// y abarata también las respuestas JSON de /api/fires.
app.use(compression());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Vista única de "momento actual": últimas 24 h, tres satélites VIIRS
// fusionados. Sin parámetros: aquí no hay histórico.
app.get('/api/fires', async (_req, res, next) => {
  try {
    res.json(await getFires());
  } catch (err) {
    next(err);
  }
});

app.get('/api/effis/status', async (_req, res, next) => {
  try {
    res.json(await getEffisStatus());
  } catch (err) {
    next(err);
  }
});

// Proxy de tiles WMS de EFFIS. Se proxea (en vez de que MapLibre ataque al WMS
// directamente) para poder cambiar de host/capa en un solo sitio, cachear y
// evitar sorpresas de CORS de los servidores del JRC.
app.get('/api/effis/wms', async (req, res, next) => {
  try {
    const tile = await fetchEffisTile(
      String(req.query.range ?? '7d'),
      String(req.query.bbox ?? ''),
      String(req.query.width ?? '256'),
      String(req.query.height ?? '256')
    );
    res
      .set('Content-Type', tile.contentType)
      .set('Cache-Control', 'public, max-age=300')
      .send(tile.body);
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', `Ruta no encontrada: ${req.originalUrl}`));
});

// En producción este mismo proceso sirve el build del cliente: un solo puerto,
// sin CORS y sin exponer nada más.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // Los assets de Vite llevan hash en el nombre: inmutables para siempre.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.includes(`${path.sep}data${path.sep}`)) {
          // Límites y teselas cambian solo al redesplegar: 1 día + revalidación.
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(errorBody(err.code, err.message));
    return;
  }
  console.error('Error no controlado:', err);
  res.status(500).json(errorBody('INTERNAL', 'Error interno del proxy.'));
});

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Proxy escuchando en http://localhost:${port}`);
  if (!process.env.FIRMS_MAP_KEY) {
    console.warn(
      'AVISO: FIRMS_MAP_KEY no está configurada. /api/fires devolverá un error ' +
        'claro hasta que copies server/.env.example a server/.env y la rellenes.'
    );
  }
});
