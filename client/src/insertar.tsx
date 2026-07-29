// Montserrat: solo los pesos que usa esta página (marca y titulares).
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EmbedBuilder from './components/EmbedBuilder';
import './index.css';

/**
 * Entrada de /insertar (client/insertar.html): generador del código de
 * inserción. Entrada propia de Vite, así que no arrastra MapLibre — el mapa de
 * la previsualización lo carga el iframe de /embed, no esta página.
 */
const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en insertar.html');
}

createRoot(container).render(
  <StrictMode>
    <EmbedBuilder />
  </StrictMode>
);
