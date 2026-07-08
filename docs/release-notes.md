# PertFlow — Notes de version

Historique synthétique des versions livrées, orienté utilisateur (la version détaillée,
technique, est dans `CLAUDE.md` et `docs/journal-developpement.md`).

- **Licence** : MIT — © Stéphane Guichard
- **Usage** : application web 100 % hors ligne, ouverte par double-clic (`file://`) ;
  livrée sous forme d'un fichier unique `dist/pertflow.html`.
- **Numérotation** : les versions `vN` ne suivent pas les numéros de session (une session
  intercalaire a décalé la suite) ; les correctifs mineurs utilisent un 3ᵉ indice `vX.Y.Z`.

---

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
