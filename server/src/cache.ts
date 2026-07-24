/**
 * Cache TTL en memoria, deliberadamente simple: este proxy es un único proceso
 * y el objetivo es no martillear a FIRMS (límite: 5000 req / 10 min por clave)
 * ni a EFFIS, no compartir estado entre instancias.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    /** Tope de entradas para que la cache de tiles no crezca sin límite. */
    private readonly maxEntries = 500
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      // Map itera en orden de inserción: expulsa la entrada más antigua.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
