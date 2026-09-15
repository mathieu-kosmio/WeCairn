/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : hooks PocketBase (chargés automatiquement depuis pb_hooks/).
 *
 * 1. À l'inscription, l'utilisateur est rattaché à l'organisation correspondant au
 *    domaine de son e-mail (créée si elle n'existe pas). Le client ne peut jamais
 *    choisir son organisation (voir createRule de la collection users). L'adresse est
 *    enregistrée en minuscules (index unique insensible à la casse) : BOB@acme.fr et
 *    bob@acme.fr sont le même compte.
 * 2. Les domaines de messageries grand public sont refusés, y compris leurs déclinaisons
 *    par pays (yahoo.co.uk, outlook.de…) ; les domaines non ASCII sont refusés. Liste et
 *    logique dans pb_hooks/wecairn.js (memberDomain, PUBLIC_DOMAINS, PUBLIC_FAMILIES).
 * 3. Un changement d'adresse vers un autre domaine est refusé : il ferait sortir le membre
 *    de son organisation tout en gardant l'accès à ses données.
 * 4. Normalisation des retex : tags en minuscules, dédoublonnés, 8 maximum ; source par défaut.
 *
 * Note PocketBase : chaque handler s'exécute dans une VM isolée, d'où le require()
 * à l'intérieur des handlers plutôt que des constantes au niveau du fichier.
 */

onRecordCreateRequest((e) => {
  const m = require(`${__hooks}/wecairn.js`).memberDomain(e.record.get("email"));
  if (m.error) throw new BadRequestError(m.error);
  e.record.set("email", m.email);
  e.record.set("organisation", require(`${__hooks}/wecairn.js`).findOrCreateOrganisation($app, m.domain));
  if (!e.record.get("name")) e.record.set("name", m.email.split("@")[0]);
  e.record.set("emailVisibility", false);
  e.next();
}, "users");

onRecordRequestEmailChangeRequest((e) => {
  const w = require(`${__hooks}/wecairn.js`);
  const next = w.memberDomain(e.newEmail), current = w.memberDomain(e.record.get("email"));
  if (next.error) throw new BadRequestError(next.error);
  if (next.domain !== current.domain) {
    throw new BadRequestError("La nouvelle adresse doit rester sur le domaine de votre organisation. Pour rejoindre une autre organisation, créez un compte avec la nouvelle adresse.");
  }
  e.newEmail = next.email;
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
