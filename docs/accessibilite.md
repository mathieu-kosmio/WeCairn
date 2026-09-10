# Accessibilité

Objectif : conformité RGAA 4.1 (WCAG 2.1 AA) sur toute l'interface, dans les deux thèmes.

## Ce qui est en place

**Contrastes.** Texte à 4,5:1 au moins et composants (bordures de champs, boutons, galet de vote, anneau de focus)
à 3:1 au moins, en clair comme en sombre. Les jetons `--accent-text`, `--muted`, `--line-strong`, `--stone-edge` et
`--focus` ont été choisis pour cela (valeurs dans [design.md](design.md)).

**Structure.** Un `h1` (le logo), des titres `h2` pour les retex, les blocs latéraux et les dialogues, un lien
d'évitement « Aller au contenu », des repères `main` et `aside` nommés, la langue déclarée (`lang="fr"`).

**Formulaires.** Chaque champ a une étiquette reliée (`label for`), les champs obligatoires sont annoncés, le champ
e-mail désactivé est décrit, les messages d'erreur de connexion sont en `role="alert"`.

**Clavier.** Tout est atteignable à la tabulation dans l'ordre visuel. Menu utilisateur : Entrée ouvre et place le
focus sur le premier élément, flèches haut et bas pour circuler, Échap ferme et rend le focus au bouton. Dialogues :
focus sur le premier champ à l'ouverture, Échap ferme et rend le focus à l'élément déclencheur (comportement natif de
`dialog`). Les cairns du chemin sont focalisables et décrits.

**États annoncés.** Tri (`aria-pressed`), vote (`aria-pressed`), « Lire le retex » (`aria-expanded`), menu
(`aria-expanded`, `aria-controls`), barre de progression nommée, dialogues nommés (`aria-labelledby`).

**Retours.** Toasts en `role="status"`, statuts de la dictée et de l'entretien en `role="status"`, journal de
l'entretien en `aria-live="polite"`, questions de l'IA en `role="status"`.

**Mouvement et zoom.** Animations désactivées avec `prefers-reduced-motion`. Pas de défilement horizontal à 400 px de
large ni à 200 % de zoom.

## Comment c'est vérifié

- axe-core (règles WCAG 2.0 et 2.1 A et AA, plus bonnes pratiques) sur chaque écran (accueil, fil, dialogues, menu)
  dans les deux thèmes : zéro violation.
- Parcours clavier scripté avec Playwright : ordre de tabulation, menu, dialogues, retour du focus.
- Calcul des contrastes de chaque paire de jetons.

L'audit automatisé couvre une partie des critères. Un test avec VoiceOver et NVDA reste à faire pour valider les
annonces lors du rafraîchissement temps réel du fil et le parcours de l'entretien vocal.

## Ce qui dépend de l'instance

- La déclaration d'accessibilité (page « Accessibilité » avec le taux de conformité) est obligatoire pour les services
  publics et les grandes entreprises : à rédiger par l'organisation qui déploie.
- La transcription des échanges vocaux avec l'IA est affichée en direct ; elle constitue l'alternative textuelle de
  l'entretien.
