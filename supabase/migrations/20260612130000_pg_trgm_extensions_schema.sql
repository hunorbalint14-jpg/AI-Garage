-- Supabase advisory (extension_in_public): pg_trgm was created in the public
-- schema by 20260610110000_trigram_search_indexes.sql. Move it to the
-- dedicated extensions schema (Supabase convention — keeps extension objects
-- out of the API-exposed schema). Safe to relocate: the existing GIN indexes
-- reference gin_trgm_ops by OID, and app queries only use plain `ilike`,
-- which the indexes serve regardless of where the extension lives.

create schema if not exists extensions;

alter extension pg_trgm set schema extensions;
