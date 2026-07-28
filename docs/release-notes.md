# PertFlow — Notes de version

Historique synthétique des versions livrées, orienté utilisateur (la version détaillée,
technique, est dans `CLAUDE.md` et `docs/journal-developpement.md`).

- **Licence** : MIT — © Stéphane Guichard
- **Usage** : application web 100 % hors ligne, ouverte par double-clic (`file://`) ;
  livrée sous forme d'un fichier unique `dist/pertflow.html`.
- **Numérotation** : les versions `vN` ne suivent pas les numéros de session (une session
  intercalaire a décalé la suite) ; les correctifs mineurs utilisent un 3ᵉ indice `vX.Y.Z`.

---

## v0.20 — 28/07/2026 · Recherche par nom & synthèse en chapitres
- **Recherche par nom** dans le menu **🔎 Filtre** : une zone de saisie met en évidence les
  nœuds dont le **nom** ou les **notes** contiennent le texte tapé. Insensible à la casse et
  aux accents (`etude` trouve « Étude mécanique »), et valable pour les **trois types de
  nœuds** — tâches, jalons et labels. Un **compteur** indique le nombre de nœuds trouvés, ou
  « aucun résultat ». Choisir un autre filtre vide la zone, et inversement.
- La **synthèse** est répartie en **quatre onglets** — *Générique*, *Jalons sortants*,
  *Jalons entrants*, *Analyse* — qui deviennent les **chapitres du document imprimé**, chacun
  sur une nouvelle page. L'onglet consulté est conservé d'une ouverture à l'autre.
- Nouvel onglet **Analyse** : les **points d'attention** de la structure du planning — jalons
  orphelins, **jalons de nom similaire** (typiquement le jalon sortant d'un lot et le jalon
  entrant du suivant, entre lesquels le lien manque), tâches isolées, fins de chaîne sans
  jalon, tâches de durée nulle. Chaque contrôle explique ce qu'il signale et **n'apparaît que
  s'il a trouvé quelque chose**. Une pastille sur l'onglet donne le total.
- **La synthèse ramène au planning** : cliquer le nom d'un jalon ou d'une tâche ferme la
  fenêtre, sélectionne le nœud et centre la vue dessus ; le bouton **🔎** d'une ligne
  d'analyse met en évidence **tous** les nœuds concernés d'un coup.

## v0.19 — 28/07/2026 · Panneau en deux onglets & couleur des nouvelles tâches
- Le **panneau latéral se divise en deux onglets** : **Propriétés** (ce que vous saisissez) et
  **Synthèse** (ce que PertFlow calcule). Le bouton **Supprimer** reste accessible depuis les
  deux, et l'onglet consulté est **conservé quand vous changez de nœud**.
- L'onglet **Synthèse** liste les **prédécesseurs et les successeurs** du nœud sélectionné —
  avec, pour chacun, la date qui compte : la **fin au plus tôt** d'un prédécesseur, le **début
  au plus tôt** d'un successeur. Sur un planning dense, plus besoin de suivre les liens à l'œil.
- Chaque voisin est **cliquable** : le clic le sélectionne et **centre la vue dessus** sans
  changer le zoom, ce qui permet de remonter une chaîne de dépendances de proche en proche.
  Les voisins situés sur le **chemin critique** sont bordés de rouge.
- Nouveau réglage **« Couleur des nouvelles tâches »** (Paramètres → Projet). Une tâche créée
  naissait toujours bleue, y compris quand un groupe s'était approprié ce bleu — elle semblait
  alors rattachée à ce groupe sans l'être. Deux modes désormais : **couleur libre** (la première
  teinte qu'aucun groupe n'utilise, aucun rattachement) ou **rattachement direct à un groupe
  existant**, avec sa couleur.

## v0.18.1 — 28/07/2026 · Lisibilité de la trame
- Le **libellé d'année** de la trame temporelle est **nettement plus grand** : il se lit
  désormais comme un filigrane, d'un coup d'œil et sur un planning dézoomé.
- La fenêtre **À propos** n'affiche plus l'heure de génération du bundle, seulement la date.

## v0.18 — 27/07/2026 · Réglage de la trame & Paramètres en onglets
- **Curseur « Intensité de la trame »** (20 % → 400 %) : le bon contraste dépend de l'écran
  et du goût, il se règle donc à la main. Une **vignette d'aperçu** montre l'effet dans le
  dialogue ; le rendu définitif se juge sur votre planning.
- La fenêtre **Paramètres** est répartie en **trois onglets** — *Projet*, *Affichage*,
  *Coûts*. Un seul **Valider** enregistre l'ensemble, et le dernier onglet consulté est
  rouvert la fois suivante.

## v0.17 — 27/07/2026 · Jalons entrants/sortants, trame, aimantation
- La **synthèse** classe les jalons en **entrants** (ce qui alimente le planning) et
  **sortants** (ce qu'il produit) au lieu de « tenus / non tenus ». Un jalon intermédiaire
  figure dans les deux listes ; chaque liste reste chronologique.
- La **tenue de la cible** passe à la **couleur de la ligne**, avec le **même code que les
  jalons du plan de travail** : rouge si la cible n'est pas tenue, orange si elle l'est tout
  juste, vert sinon.
- **Trame temporelle** optionnelle en fond de plan (Paramètres) : bandes discrètes
  délimitant les années, les mois ou les semaines selon l'unité du projet.
- Les **Labels s'aimantent** aux bords des nœuds voisins quand on les relâche.

## v0.16 — 25/07/2026 · Anticipation avant T0
- Des travaux peuvent être **engagés avant T0** pour gagner de la marge : nouvelle case
  **« tâche anticipée »** (planifiée au plus tard), et les dates antérieures à T0 sont
  désormais légales. T0 redevient l'**origine contractuelle**, il n'est plus un plancher.
- La **date-cible d'un jalon** se saisit en **date** ou en **« T0 + X »**.
- Un **repère T0** et une **bande hachurée** signalent la zone anticipée ; le **coût
  anticipé** est ventilé au prorata (barre d'état, panneau et synthèse par groupe).

## v0.15.5 — 24/07/2026 · Jalons sur leur date-cible
- La réorganisation « axe temps seul » place un jalon **sur sa date-cible** quand il en a une.
- Les listes de jalons de la synthèse sont triées **chronologiquement**.

## v0.15.4 — 23/07/2026 · Fenêtre de synthèse
- Nouveau bouton **📊 Synthèse** : tout le planning en une vue — vue d'ensemble, jalons et
  leur marge, coût et fin au plus tard **par groupe**.
- **Imprimable en PDF** (bouton *Imprimer / PDF*, puis « Enregistrer au format PDF »).

## v0.15.3 — 16/07/2026 · Manuel utilisateur
- Manuel mis à jour (évolutions v0.15.2, 8 captures) et correctif de la case « gras » du
  panneau Label.

## v0.15.2 — 16/07/2026 · Réorganisation, Labels, alignement
- Deuxième mode de réorganisation, **« axe temps seul »** : les tâches se replacent sur
  l'axe du temps **sans changer de ligne**.
- **Mise en forme des Labels** : justification, gras, couleurs de texte et de fond.
- **Boîte d'alignement** dans le menu contextuel : aligner et répartir une sélection.

## v0.15.1 — 08/07/2026 · Peaufinage Jalon & Label
- **Notes libres sur les Jalons** (comme sur les tâches) — dans le panneau, jamais sur le nœud.
- **Nœud Label** : la taille définie **manuellement est désormais conservée** à l'édition du
  texte (bug corrigé) ; nouveaux boutons **− / +** pour régler la **taille de police**.

## v0.15 — 08/07/2026 · Refonte de l'import
- **Un seul bouton « Importer »** ouvrant une fenêtre de **choix du format** : planning
  **Excel CPERT** ou **projet PertFlow `.pert`**, tous deux **ajoutés** au projet en cours.
- **Aucune date absolue ne bouge** à l'import : le T0 devient le plus ancien des deux et le
  bloc concerné est **ancré** automatiquement par un jalon d'entrée daté.
- **L'unité du projet n'est plus jamais écrasée en silence** : en cas de divergence, choix
  entre ignorer, convertir les durées, ou annuler. Le bouton « Ouvrir » (qui *remplace* le
  projet) reste distinct.

## v0.14.2 — 08/07/2026 · Unité « jour » = jours ouvrés
- En unité **jour**, le calcul saute désormais les **week-ends** (jours ouvrés). Les unités
  **semaine** et **mois** sont inchangées.

## v0.14.1 — 07/07/2026 · Réorganisation & sélection
- **Réorganiser** regroupe d'abord par **enchaînement** de tâches (moins de liens croisés,
  mise en page plus compacte).
- Une **sélection multiple** se déplace au **simple clic-glisser** (plus besoin de Shift).

## v0.14 — 05/07/2026 · Rendu des liens
- Choix du **style des liens** dans les Paramètres : **courbe**, **droit** ou **coudé**
  (angles droits) — le mode coudé **contourne les nœuds** pour ne plus passer dessus.

## v0.13 — 05/07/2026 · Exports avancés
- Un seul bouton **« Exporter »** → fenêtre de choix. En plus de **PNG** et **PDF** :
  **CSV**, **Gantt chargé (Excel)**, **micro-jalonnement (Excel)** et **Gantt MS Project**
  (XML importable dans Project).

## v0.12.3 — 05/07/2026 · Filtre
- Voile d'estompage **assombri** (cohérent avec le thème sombre) et nouveau **filtre par
  responsable**.

## v0.12.2 — 03/07/2026 · Ergonomie & filet anti-crash
- Nœuds ajoutés **au centre** de la vue, **toolbar toujours accessible** (retour à la ligne),
  boutons **zoom − / +**, et **sauvegarde automatique** de secours (activée par défaut).

## v0.12.1 — 02/07/2026 · Sélecteur de groupe
- Menu déroulant de **choix du groupe** fiable sur **tous les navigateurs** (Firefox/Edge/Chrome).

## v0.12 — 01/07/2026 · Correctif d'import
- Durées correctement lues sur les tâches à **marge indéterminée** (« ? ») des fichiers CPERT.

## v0.11 — 30/06/2026 · Estimation des coûts
- **ETP** saisissable par tâche et **coût estimé** dérivé (durée × ETP × taux), affichés dans
  le panneau et agrégés dans la **barre d'état** (total projet et chemin critique).

## v0.10 — 30/06/2026 · Propriétés & jalons enrichis
- **Note libre** sur les tâches, **liste des responsables** déjà saisis, **tags de jalons**
  (DOTD / COTD / Ingénierie), et **largeur ∝ durée** rendue optionnelle.

## v0.9 — 29/06/2026 · Jalons entrants & mois calendaires
- **Jalons d'entrée** (contrainte de date externe qui fixe le départ de la chaîne aval) et
  calcul en **mois calendaires réels** (fin de l'approximation à 30 jours).

## v0.8 — 29/06/2026 · Couleur/groupe au cœur des fonctions
- **Import** et **réorganisation** conscients du **groupe** ; **filtre** par WP ou par couleur.
- Bouton **« À propos »** (copyright, licence, version) et bundle standalone versionné.

## v0.7 — 28/06/2026 · Regroupement métier (WP/service)
- Dimension **« groupe »** par tâche avec **couleur partagée** au sein du groupe, et
  identifiant unique interne par tâche.

## v0.6 — 27/06/2026 · Correctifs & quick wins
- Cohérence linguistique (interface en français), **tracé complet du chemin critique**,
  **PDF plus léger**, responsable affiché dans l'en-tête, jalons **vert / orange / rouge**
  selon la tenue de leur date-cible.

## v0.5 — 27/06/2026 · Finitions UX & packaging
- **Annuler / Rétablir**, **menus contextuels en français**, **grille aimantée**, gestion des
  erreurs (messages à l'écran), et **fichier HTML standalone** de livraison.

## v0.4 — 25/06/2026 · Données : import, persistance, export
- **Import des plannings Excel** existants, **sauvegarde / chargement `.pert`**,
  **export PNG / PDF** et **copier-coller** de nœuds.

## v0.3 — 24/06/2026 · Visualisation & lisibilité
- **Réorganisation automatique** des nœuds, **largeur des tâches ∝ durée**, jalons redessinés
  (drapeau), intitulés multi-lignes et **tracé du chemin critique** en rouge.

## v0.2 — 22/06/2026 · Moteur de calcul PERT
- Dates **au plus tôt / au plus tard**, **marges**, **chemin critique** et **détection des
  cycles**, avec recalcul automatique.

## v0.1 — 01/04/2026 · Socle
- Canvas, nœuds **Activité / Jalon / Label**, toolbar et panneau de propriétés.
