-- Schema de la base D1 compartida de la app (radar-db, binding APP_DB).
-- Hoy: micro-encuesta de feedback. Futuro: suscripciones de alertas push
-- (ver memoria del proyecto). Aplicar con:
--   npx wrangler d1 execute radar-db --file=scripts/app-db-schema.sql --remote
--   npx wrangler d1 execute radar-db --file=scripts/app-db-schema.sql --local

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,  -- epoch ms
  useful       INTEGER,           -- 1 | 0 | NULL (pregunta sin responder)
  wants_alerts INTEGER,           -- 1 | 0 | NULL
  locality     TEXT,              -- slug de la localidad activa al responder (contexto)
  comment      TEXT,              -- texto libre opcional (≤500 chars, llega en un envío aparte)
  -- SHA-256(ip + fecha UTC + salt) truncado: permite limitar envíos por IP y día
  -- SIN guardar la IP. El hash cambia cada día: no identifica a nadie entre días.
  ip_day_hash  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_hash ON feedback(ip_day_hash);
