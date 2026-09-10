/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : notifications par e-mail, traitées chaque minute (voir notify.js).
 * Prévient les membres quand une pierre est posée, et l'auteur d'une pierre (ainsi que ceux qui en
 * discutent) quand un commentaire arrive. Nécessite un canal d'envoi (API Brevo ou SMTP) ; sans lui,
 * les échecs sont journalisés et la file avance quand même.
 */
cronAdd("wecairn_notify", "* * * * *", () => {
  require(`${__hooks}/notify.js`).run($app);
});
