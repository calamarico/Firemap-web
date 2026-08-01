import { useEffect, useState } from 'react';
import { findLocalityBySlug, type ActiveLocality } from '../lib/locality';

/** Respuesta de /api/fwi (functions/api/fwi.ts). */
interface FwiPayload {
  fwi: { id: string; label: string; color: string; date: string } | null;
}

interface CachedFwi {
  slug: string;
  date: string; // día UTC: el dato es diario
  fwi: FwiPayload['fwi'];
}

const FWI_CACHE_KEY = 'fm-fwi-v1';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(slug: string): CachedFwi | null {
  try {
    const raw = localStorage.getItem(FWI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFwi;
    return parsed.slug === slug && parsed.date === todayUtc() ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedFwi): void {
  try {
    localStorage.setItem(FWI_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sin persistencia: el dato ya está en memoria
  }
}

/**
 * "Riesgo de incendio hoy: muy alto" para la localidad activa — la versión
 * hidratada de la frase que el server inyecta en /incendios/<slug>. Una
 * invocación del Worker por localidad y día (localStorage), y el Worker a su
 * vez cachea por celda de 0.1°: el coste marginal es ~cero. Sin dato (GWIS
 * caído, vista país), no se renderiza nada.
 */
export default function LocalityRisk({ locality }: { locality: ActiveLocality | null }) {
  const [fwi, setFwi] = useState<FwiPayload['fwi']>(null);

  const slug = locality?.kind === 'municipality' ? locality.slug : null;

  useEffect(() => {
    setFwi(null);
    if (!slug) return;
    const cached = readCache(slug);
    if (cached) {
      setFwi(cached.fwi);
      return;
    }
    let cancelled = false;
    void (async () => {
      const hit = await findLocalityBySlug(slug);
      if (!hit || cancelled) return;
      try {
        const res = await fetch(`/api/fwi?lat=${hit.center[1]}&lon=${hit.center[0]}`);
        if (!res.ok) return;
        const body = (await res.json()) as FwiPayload;
        if (cancelled) return;
        writeCache({ slug, date: todayUtc(), fwi: body.fwi });
        setFwi(body.fwi);
      } catch {
        // capa secundaria: sin dato no se muestra nada
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!locality || !fwi) return null;

  return (
    <section className="text-sm text-ink-secondary">
      <h2 className="fm-eyebrow mb-1.5">Riesgo de incendio hoy</h2>
      <p className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 rounded-full border border-edge"
          style={{ backgroundColor: fwi.color }}
        />
        <span>
          <span className="font-semibold capitalize text-ink-primary">{fwi.label}</span>
          <span className="text-ink-faint"> · índice FWI, Copernicus EFFIS</span>
        </span>
      </p>
    </section>
  );
}
