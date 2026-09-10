# L'univers du Cairn

## L'histoire

Sur un sentier de montagne, chaque marcheur pose une pierre sur le cairn pour baliser le chemin de ceux qui suivent.
Dans WeCairn, un retex est une pierre, l'organisation érige son cairn, et voter revient à caler la pierre. Les niveaux
suivent l'altitude. L'équipe est une cordée. Sur la page d'accueil, le chemin vers l'horizon montre, jour après jour,
les cairns que toutes les organisations dressent au bord de la route.

Le vocabulaire imagé accompagne les termes métier sans les remplacer : « retex », « situation », « ce qu'on a appris »
et « bonne pratique » restent affichés tels quels.

## Palette

| Jeton | Clair (sable) | Sombre (ardoise) | Usage |
|---|---|---|---|
| `--bg` | `#EBE4D6` | `#2B2F36` | fond de page |
| `--card` | `#F8F4EC` | `#343940` | cartes (pierres plates) |
| `--ink` | `#2B2F36` | `#E9E1D3` | texte |
| `--muted` | `#5C606A` | `#A9B0B8` | texte secondaire (4,5:1 garanti) |
| `--accent` | `#E0743A` | `#E0743A` | lichen : bouton principal, pierre calée, pierre de l'utilisateur |
| `--accent-text` | `#9E4514` | `#F39A68` | lichen lisible en texte (libellés, logo) |
| `--sky` | `#2F5C75` | `#BFD6E3` | ciel : auteurs, liens, tags |
| `--stone`, `--stone-2` | `#C9C2B5`, `#AAA397` | `#9AA0A8`, `#7A7F88` | galets et pierres du cairn |
| `--line-strong` | `#857F71` | `#8F969F` | bordures de champs et de boutons (3:1 garanti) |
| `--focus` | `#9E4514` | `#F39A68` | anneau de focus |

Le thème suit le réglage du système ; le bouton en haut à droite force clair ou sombre (choix mémorisé dans le
navigateur, appliqué avant le premier rendu). Les deux thèmes partagent les mêmes jetons : un composant ne connaît
jamais une couleur en dur.

## Typographie

Young Serif pour les titres (chaleureuse, un peu taillée, comme une pierre), IBM Plex Sans pour le texte. Les deux
viennent de Google Fonts avec repli système (`Iowan Old Style`, `Georgia` ; `system-ui`). Pour une instance qui veut
éviter tout appel externe, les polices peuvent être embarquées en `@font-face` dans `index.html`.

## Formes et matière

Cartes à coin arrondi asymétrique (`6px 6px 22px 6px`) qui évoquent une pierre plate, aplats mats, ombre légère au
survol seulement. Le galet de vote est un SVG en deux tons avec un contour ; calé, il passe en lichen. Le cairn de
l'organisation empile des ellipses de largeur décroissante avec un léger décalage, la pierre de l'utilisateur en lichen.

## Le chemin vers l'horizon

La page d'accueil est peinte en WebGL, sans bibliothèque : un shader plein écran dessine le ciel au lavis, cinq plans
de montagnes qui se fondent dans la brume à leur pied (comme sur une estampe), un sol en perspective avec ses brins
d'herbe, et un sentier sinueux qui monte vers l'horizon. Le soleil (sable) ou la lune (ardoise) veille dans la marge.
Les couleurs viennent des jetons `--scene-*` définis pour chaque thème. Les cairns sont des SVG posés par-dessus,
projetés avec la même caméra pour suivre le sentier : le jour le plus récent au premier plan, les anciens vers
l'horizon, une balise plate pour les jours sans pierre. Ils restent survolables, focusables au clavier et lus par les
lecteurs d'écran. Sans WebGL, un dégradé CSS tient lieu de paysage. Le vent dans l'herbe, la dérive de la brume et la
parallaxe au pointeur sont coupés avec `prefers-reduced-motion`.

## Mouvement

Sortie exponentielle (`cubic-bezier(.16, 1, .3, 1)`), jamais de rebond. Les pierres du cairn se posent une à une au
chargement ; la nouvelle pierre tombe du haut avec un léger tassement ; le galet cale avec une petite rotation ; la
carte fraîchement publiée monte dans le fil. Tout est coupé avec `prefers-reduced-motion`.

## Vocabulaire de l'interface

| Geste | Mot |
|---|---|
| Publier un retex | Poser une pierre |
| Voter « utile » | Caler (n calages) |
| Modifier, supprimer | Modifier la pierre, Retirer du cairn |
| Classement | La cordée |
| Niveau | Observateur, Contributeur, Passeur, Mentor, Pilier, avec l'altitude |
| Objectifs de l'organisation | Ce cairn balise : … |
| Page d'accueil | Le chemin vers l'horizon |
