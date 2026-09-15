# Journal des modifications

Évolutions notables de WeCairn. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## Sécurité - 2026-09-16

Série de correctifs de sécurité. **Mise à jour impérative.** Livrée en trois étapes déployées dans l'ordre.

### Critique

- **Prise de contrôle d'un superutilisateur.** S'inscrire comme membre avec l'adresse d'un superutilisateur
  remplaçait le mot de passe de la console PocketBase : l'alignement des mots de passe se faisait dans les deux
  sens. Il ne va désormais que de la console vers le membre de même adresse, et seulement si cette adresse est
  vérifiée. Un compte membre, qui s'obtient par simple inscription, ne peut plus jamais écrire un accès console.

### Haute

- **Inscription sans vérification d'adresse.** L'organisation étant déduite du domaine de l'e-mail, n'importe qui
  pouvait s'inscrire avec `prenom@client.fr` et lire les pierres et les membres de ce client. La connexion exige
  désormais une adresse confirmée (`authRule` de `users`) ; les clés MCP d'un membre non vérifié sont refusées.

### Moyenne

- Unicité des adresses insensible à la casse (`BOB@acme.fr` doublait `bob@acme.fr`) ; adresses enregistrées en
  minuscules ; familles de messageries grand public (`yahoo.co.uk`, `outlook.de`…) et domaines non ASCII refusés.
- Un changement d'adresse vers un autre domaine gardait l'accès à l'ancienne organisation ; il est refusé.
- Les comptes non vérifiés apparaissaient dans la liste des membres et le classement et recevaient les
  notifications ; ils sont invisibles, non notifiés et supprimés après 7 jours.
- L'horizon (activité publique) pouvait exposer un tag propre à une organisation ; un tag n'apparaît plus que s'il
  a été utilisé par au moins trois organisations (comptées parmi celles ayant un membre vérifié).
- Limitation de débit par adresse IP sur les connexions, inscriptions, e-mails de compte, relais IA, MCP et OAuth,
  avec l'adresse réelle lue dans `X-Forwarded-For`.
- Un nouveau mot de passe (ou une réinitialisation) révoque les clés MCP du membre.
- Serveur MCP : contenus saisis par les membres (pierres, commentaires, noms) cités comme des données, jamais comme
  des consignes, dans les instructions envoyées à l'agent ; lots JSON-RPC et publications en lot bornés à 20.
- OAuth : page de consentement affichant l'hôte qui recevra l'accès, avec un avertissement s'il n'est pas celui
  d'un connecteur connu.
- SDK PocketBase chargé avec contrôle d'intégrité (SRI) ; archive PocketBase vérifiée par SHA-256 dans l'image.
- Conteneur Docker exécuté sans les droits root (utilisateur dédié, bascule par `su-exec`).

### Basse

- OAuth refuse les adresses de retour avec fragment, identifiants ou joker (cinq au plus) et exige `client_id`
  à l'échange du code ; `X-Forwarded-Proto` n'est plus repris tel quel ; seuls des formats audio partent chez le
  fournisseur de dictée ; avatars protégés.
- En-têtes `Strict-Transport-Security` (en HTTPS), `Referrer-Policy`, `Permissions-Policy` et une
  `Content-Security-Policy` (sous-ensemble défensif) sur toutes les réponses.

### Ajouté

- Mécanisme de migrations (import du schéma, puis durcissement).
- Harnais de tests d'intégration (`make test`) : instance PocketBase jetable, relais IA simulé localement, aucune
  clé réelle. 24 tests, un par correctif au moins. À lancer avant de pousser ; le déploiement se fait ensuite par
  l'auto-déploiement Coolify sur `main`.
- `SECURITY.md`, `docs/securite.md`.

### Mise à niveau

Déployée en trois étapes, dans cet ordre :

1. **Alignement des mots de passe à sens unique** (hooks seuls). Aucune migration, aucune donnée touchée, pas de
   déconnexion. Après déploiement : changer le mot de passe de chaque superutilisateur et activer la MFA
   (console `_superusers` > *Options*), au cas où un mot de passe aurait déjà été écrasé.
2. **Vérification des adresses** (migration `1789494348_users_require_verified`). **Tous les membres sont
   déconnectés une fois** (le secret des jetons de la collection est renouvelé) et se reconnectent. Les comptes
   jamais confirmés ne sont pas validés automatiquement : marquer vérifiés à la main ceux à conserver avant de
   déployer (`make verify-user EMAIL=…`), sinon ils devront confirmer leur adresse pour revenir. Vérifier d'abord
   qu'un canal d'e-mail fonctionne (Brevo ou SMTP), sans quoi personne ne peut confirmer son adresse.
3. **Durcissement** (migration `1789495468_security_hardening` : index insensible à la casse, règles des membres non
   vérifiés, avatars protégés, limitation de débit). Si la base contient deux adresses identiques à la casse près,
   l'index n'est pas modifié (avertissement dans les journaux) : dans la console, collection `users` > *Indexes*,
   vérifier que `idx_users_email` porte `COLLATE NOCASE` ; sinon supprimer le compte en double puis modifier
   l'index. Le passage du conteneur en non-root réaligne l'appartenance du volume `pb_data` au premier démarrage.
