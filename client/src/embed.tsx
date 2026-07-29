// El CSS de MapLibre lo importa index.css (ver el comentario de orden allí).
// Solo el peso 700: en el widget la única tipografía de display es el wordmark
// de la marca (la app carga cuatro pesos porque tiene títulos y prosa).
import '@fontsource/montserrat/700.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EmbedView from './components/EmbedView';
import './index.css';
import { parseEmbedConfig } from './lib/embed';
import { registerEffisTileProtocol } from './map/effisTileCache';

/**
 * Entrada del widget embebible (client/embed.html → /embed). Es una entrada
 * propia de Vite y no una ruta de la SPA: así el iframe no descarga la sidebar,
 * la prosa SEO ni los vídeos de la home, y el documento puede declararse
 * noindex sin tocar el de la app.
 */
maplibregl.addProtocol('pmtiles', new Protocol().tile);
registerEffisTileProtocol();

const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en embed.html');
}

createRoot(container).render(
  <StrictMode>
    <EmbedView config={parseEmbedConfig(window.location.search)} />
  </StrictMode>
);
