/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : hooks PocketBase (chargés automatiquement depuis pb_hooks/).
 *
 * 1. À l'inscription, l'utilisateur est rattaché à l'organisation correspondant au
 *    domaine de son e-mail (créée si elle n'existe pas). Le client ne peut jamais
 *    choisir son organisation (voir createRule de la collection users).
 * 2. Les domaines de messageries grand public sont refusés : WeCairn rattache par
 *    domaine professionnel. Liste ajustable dans pb_hooks/wecairn.js.
 * 3. Normalisation des retex : tags en minuscules, dédoublonnés, 8 maximum ; source par défaut.
 *
 * Note PocketBase : chaque handler s'exécute dans une VM isolée, d'où le require()
 * à l'intérieur des handlers plutôt que des constantes au niveau du fichier.
 */

onRecordCreateRequest((e) => {
  const w = require(`${__hooks}/wecairn.js`);
  const email = String(e.record.get("email") || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  if (!domain) throw new BadRequestError("Adresse e-mail invalide.");
  if (w.PUBLIC_DOMAINS.includes(domain)) {
    throw new BadRequestError("Utilisez votre adresse e-mail professionnelle : l'organisation est déduite de son domaine.");
  }
  e.record.set("organisation", w.findOrCreateOrganisation($app, domain));
  if (!e.record.get("name")) e.record.set("name", email.split("@")[0]);
  e.record.set("emailVisibility", false);
  e.next();
}, "users");

onRecordCreateRequest((e) => {
  require(`${__hooks}/wecairn.js`).normalizeRetex(e.record);
  e.next();
}, "retex");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/wecairn.js`).normalizeRetex(e.record);
  e.next();
}, "retex");
