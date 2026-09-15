# Politique de sécurité

WeCairn héberge les retours d'expérience de plusieurs organisations : chaque organisation ne doit voir que ses
propres pierres et ses propres membres. Nous traitons en priorité tout signalement qui remet en cause cette
isolation ou l'accès aux comptes.

## Versions suivies

| Version | Correctifs de sécurité |
|---|---|
| Série de sécurité 2026-09 et suivantes | oui |
| Versions antérieures | non : failles critiques connues, mettre à jour (voir [CHANGELOG.md](CHANGELOG.md)) |

Suivez les [avis de sécurité du dépôt](https://github.com/mathieu-kosmio/WeCairn/security/advisories) : chaque avis
indique les fichiers et la migration concernés.

## Signaler une faille

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub :
[Security > Report a vulnerability](https://github.com/mathieu-kosmio/WeCairn/security/advisories/new).

Pour que nous puissions reproduire rapidement, indiquez :

- la version (hash du commit) et le mode de déploiement ;
- le scénario : requêtes `curl` ou étapes dans l'interface, résultat obtenu, résultat attendu ;
- l'impact estimé (quelles données, quelle organisation, quel rôle d'attaquant).

Testez sur une instance jetable (`make dev` ou `make test`), jamais sur une instance qui ne vous appartient pas ni
sur des données réelles.

## Ce qui se passe ensuite

| Étape | Délai visé |
|---|---|
| Accusé de réception | 3 jours ouvrés |
| Première évaluation (reproduction, gravité) | 7 jours ouvrés |
| Correctif pour une faille critique ou haute | 30 jours |
| Publication de l'avis et du correctif | dès que le correctif est disponible, en accord avec vous |

Nous créditons les personnes qui signalent une faille dans l'avis publié, sauf si elles préfèrent rester anonymes.

## Périmètre

Dans le périmètre : tout le code de ce dépôt (hooks, schéma et règles d'accès, interface, serveur MCP, OAuth, relais
IA, scripts, Dockerfile, workflows GitHub, configuration Compose).

Hors périmètre, à signaler au projet concerné :

- PocketBase lui-même : [pocketbase/pocketbase](https://github.com/pocketbase/pocketbase/security) ;
- les fournisseurs (Mistral, OpenAI, Brevo) et Coolify ;
- les instances déployées et administrées par des tiers.

Ne sont pas considérés comme des failles : l'absence d'une limite que la documentation présente comme un risque
résiduel assumé (voir [docs/securite.md](docs/securite.md#risques-résiduels)), les attaques qui supposent un accès
superutilisateur ou au serveur, et le déni de service par volume.

## Modèle de sécurité

Le fonctionnement détaillé (isolation des organisations, comptes, clés, OAuth, IA, en-têtes, déploiement), la
correspondance entre chaque protection et son test, les risques résiduels et la liste de contrôle avant mise en
production sont décrits dans [docs/securite.md](docs/securite.md).
