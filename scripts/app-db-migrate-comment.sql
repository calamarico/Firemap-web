-- Migración one-shot (2026-08): añade el texto libre a la encuesta en bases
-- feedback YA creadas (app-db-schema.sql solo cubre bases nuevas). Ejecutar
-- ANTES de desplegar el código que inserta la columna:
--   npx wrangler d1 execute radar-db --file=scripts/app-db-migrate-comment.sql --remote
--   npx wrangler d1 execute radar-db --file=scripts/app-db-migrate-comment.sql --local

ALTER TABLE feedback ADD COLUMN comment TEXT;
