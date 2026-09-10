/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : envoi des e-mails par l'API transactionnelle de Brevo.
 *
 * Intercepte tous les e-mails émis par PocketBase (réinitialisation de mot de passe, code OTP,
 * vérification d'adresse, changement d'adresse) et les envoie via https://api.brevo.com/v3/smtp/email
 * au lieu du SMTP de la console. Actif dès que WECAIRN_BREVO_API_KEY est défini (secret Coolify) ;
 * sans la variable, PocketBase garde son comportement habituel (SMTP de la console, sinon sendmail).
 *
 * Variables :
 *   WECAIRN_BREVO_API_KEY  clé API Brevo v3, obligatoire pour activer le relais
 *   WECAIRN_MAIL_FROM      expéditeur « WeCairn <noreply@exemple.fr> » (ou adresse seule) ; à défaut,
 *                          l'expéditeur des réglages PocketBase (Settings > Mail settings). L'adresse ou
 *                          son domaine doit être validé chez Brevo, sinon l'API refuse l'envoi.
 */
onMailerSend((e) => {
  const key = String($os.getenv("WECAIRN_BREVO_API_KEY") || "").trim();
  if (!key) return e.next();

  const msg = e.message;
  const addr = (a) => (a.name ? { email: a.address, name: a.name } : { email: a.address });
  let sender = addr(msg.from);
  const custom = String($os.getenv("WECAIRN_MAIL_FROM") || "").trim();
  if (custom) {
    const m = custom.match(/^(.*?)\s*<([^>]+)>$/);
    sender = m ? (m[1].trim() ? { email: m[2].trim(), name: m[1].trim() } : { email: m[2].trim() }) : { email: custom };
  }

  const body = { sender, to: (msg.to || []).map(addr), subject: msg.subject };
  if (msg.html) body.htmlContent = msg.html;
  if (msg.text) body.textContent = msg.text;
  if (msg.cc && msg.cc.length) body.cc = msg.cc.map(addr);
  if (msg.bcc && msg.bcc.length) body.bcc = msg.bcc.map(addr);

  const res = $http.send({
    url: "https://api.brevo.com/v3/smtp/email",
    method: "POST",
    timeout: 15,
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Brevo a refusé l'envoi (${res.statusCode}) : ${String(res.raw || "").slice(0, 300)}`);
  }
  // e.next() volontairement omis : l'envoi SMTP par défaut est court-circuité.
});
