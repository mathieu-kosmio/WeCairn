/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : importe les collections de pb_schema.json au premier démarrage.
 *
 * PocketBase exécute les migrations de ce dossier une seule fois, dans l'ordre, avant de servir.
 * Le schéma reste défini dans un seul endroit (pocketbase/pb_schema.json) ; cette migration le lit
 * et l'importe sans supprimer les collections existantes (deleteMissing = false), ce qui préserve
 * les collections système (_superusers, _authOrigins…) et les données déjà présentes.
 *
 * Sur une instance WeCairn déjà en service, dont le schéma avait été importé à la main via la console,
 * cette migration est sans effet : les collections existent déjà et le merge n'y touche pas.
 *
 * Après une modification du schéma : soit relancer l'import via l'API, soit ajouter une nouvelle
 * migration (voir docs/deploiement.md).
 */
migrate((app) => {
  // pb_schema.json est à côté du dossier des hooks (dépôt : pocketbase/, image Docker : /pb/).
  const candidates = [];
  try { candidates.push($filepath.join($filepath.dir(__hooks), "pb_schema.json")); } catch (_) {}
  candidates.push("pocketbase/pb_schema.json", "/pb/pb_schema.json");
  let raw = "";
  for (const path of candidates) {
    try { raw = toString($os.readFile(path)); break; } catch (_) {}
  }
  if (!raw) throw new Error("pb_schema.json introuvable (cherché dans : " + candidates.join(", ") + ")");
  const collections = JSON.parse(raw);
  app.importCollections(collections, false);
}, (app) => {
  // Retour arrière volontairement vide : on ne supprime jamais de collections automatiquement.
});
