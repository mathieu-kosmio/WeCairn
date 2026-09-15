/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : en-têtes de sécurité HTTP sur toutes les réponses, quel que soit le mode de déploiement
 * (Coolify, Traefik, binaire seul). PocketBase envoie déjà X-Content-Type-Options et X-Frame-Options.
 *
 * - Strict-Transport-Security : seulement quand la requête est arrivée en HTTPS (directement ou via le proxy).
 * - Referrer-Policy : l'adresse complète (qui peut contenir #retex=…) ne sort pas du site.
 * - Permissions-Policy : micro réservé au site (dictée, entretien vocal), caméra et géolocalisation coupées.
 * - Content-Security-Policy : sous-ensemble sûr en défense en profondeur (anti-clickjacking, injection de <base>,
 *   plugins, détournement de formulaire). On ne pose volontairement pas default-src/script-src/connect-src : le
 *   JS et le CSS sont en ligne dans web/index.html et l'entretien vocal ouvre une connexion vers le fournisseur
 *   temps réel ; une CSP restrictive complète suppose d'externaliser le JS (nonce) et de lister ces origines.
 */
routerUse((e) => {
  const h = e.response.header();
  const proto = String(e.request.header.get("X-Forwarded-Proto") || "").split(",")[0].trim().toLowerCase();
  if (e.isTLS() || proto === "https") h.set("Strict-Transport-Security", "max-age=31536000");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
  h.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  return e.next();
});
