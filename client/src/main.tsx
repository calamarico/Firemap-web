import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Protocolo pmtiles: teselas vectoriales servidas desde un único fichero
// estático mediante peticiones HTTP Range — cada vista descarga solo las
// teselas de su viewport en lugar del GeoJSON completo de municipios.
maplibregl.addProtocol('pmtiles', new Protocol().tile);

const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
