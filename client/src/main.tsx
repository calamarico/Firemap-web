import 'maplibre-gl/dist/maplibre-gl.css';
// Montserrat (display/marca); el cuerpo sigue con la pila del sistema.
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerEffisTileProtocol } from './map/effisTileCache';

// Protocolo pmtiles: teselas vectoriales servidas desde un único fichero
// estático mediante peticiones HTTP Range — cada vista descarga solo las
// teselas de su viewport en lugar del GeoJSON completo de municipios.
maplibregl.addProtocol('pmtiles', new Protocol().tile);

// Protocolo effis-tiles: las teselas de área quemada se guardan en la Cache
// API del navegador y se sirven desde ahí cuando EFFIS está caído.
registerEffisTileProtocol();

// Easter egg para quien abra la consola.
console.log(
  `%c Designed by:\n` +
    `%c` +
    ` ██╗  ██╗ █████╗ ██╗      █████╗ ███╗   ███╗ █████╗ ██████╗ ██╗ ██████╗ ██████╗ \n` +
    ` ██║ ██╔╝██╔══██╗██║     ██╔══██╗████╗ ████║██╔══██╗██╔══██╗██║██╔════╝██╔═══██╗\n` +
    ` █████╔╝ ███████║██║     ███████║██╔████╔██║███████║██████╔╝██║██║     ██║   ██║\n` +
    ` ██╔═██╗ ██╔══██║██║     ██╔══██║██║╚██╔╝██║██╔══██║██╔══██╗██║██║     ██║   ██║\n` +
    ` ██║  ██╗██║  ██║███████╗██║  ██║██║ ╚═╝ ██║██║  ██║██║  ██║██║╚██████╗╚██████╔╝\n` +
    ` ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═════╝ \n\n` +
    ` 🔗 @calamarico\n`,
  // Colores CSS con nombre: el criterio "cero hex fuera de tokens" también
  // aplica aquí, aunque solo lo vea quien abra la consola.
  'color: darkgray; font-size: 14px; font-weight: normal;',
  'color: plum; font-size: 10px; font-family: monospace; font-weight: bold;'
);

const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
