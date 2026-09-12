# PertFlow — Notes de version

Historique synthétique des versions livrées, orienté utilisateur (le détail technique est
dans l'historique git, et l'architecture dans [`conception.md`](conception.md)).

- **Licence** : MIT — © Stéphane Guichard
- **Usage** : application web 100 % hors ligne, ouverte par double-clic (`file://`) ;
  livrée sous forme d'un fichier unique `dist/pertflow.html`.
- **Numérotation** : les versions `vN` ne suivent pas les numéros de session (une session
  intercalaire a décalé la suite) ; les correctifs mineurs utilisent un 3ᵉ indice `vX.Y.Z`.

---

## v0.26.1 — 11/09/2026 · Chaque sauvegarde est tracée
Un planning partagé dans un répertoire commun passe de main en main. Or chaque sauvegarde est un
**téléchargement**, que l'on recopie ensuite à la main : rien ne disait **qui** avait enregistré
**quoi**, ni **quand**, ni si deux fichiers étaient deux états du **même** planning. C'est la
première brique du travail à plusieurs sur un même PERT.

- **Nouveau — la fenêtre de sauvegarde.** **💾 Sauvegarder** (ou `Ctrl+S`) ouvre une courte
  fenêtre : **votre nom**, demandé une seule fois puis retenu sur votre poste, et un
  **commentaire facultatif** sur ce qui a changé. Elle rappelle le numéro de la révision que vous
  allez produire, et la précédente. **Entrée** sauvegarde, **Échap** annule : la sauvegarde reste
  à deux touches.
- **Nouveau — l'historique des sauvegardes**, inscrit **dans le fichier** : numéro de révision,
  date, auteur, commentaire. Il se consulte dans **⚙ Paramètres → Historique** (nouvel onglet),
  la plus récente en tête — les 50 dernières sont conservées.
- **Nouveau — l'identifiant du planning.** Tiré à la première sauvegarde, il ne change plus :
  ni au renommage du fichier, ni au changement de titre, ni à l'import d'un autre planning. Il
  permet de reconnaître deux fichiers comme deux états du même planning.
- **Seules les sauvegardes du fichier sont numérotées** : la sauvegarde automatique et
  l'annulation (`Ctrl+Z`) n'y touchent pas.
- **Tous les nœuds ont désormais un identifiant stable** — jalons et labels compris, comme
  les tâches et les risques avant eux. Invisible, il permettra de reconnaître un même nœud d'un
  fichier à l'autre (comparaison de deux versions d'un planning, travail à plusieurs).
- **Vos anciens fichiers s'ouvrent sans changement**, en « révision 0 » : leur historique commence
  à leur prochaine sauvegarde. Les identifiants de leurs jalons et labels sont attribués à
  l'ouverture et deviennent définitifs à cette même sauvegarde.
- **Corrigé — `Ctrl+V` collait deux copies superposées** de la sélection quand la zone de dessin
  avait le focus (le cas habituel). Les deux copies se recouvrant exactement, le doublon passait
  inaperçu. Un collage produit désormais une seule copie.

## v0.26 — 03/09/2026 · La gestion des risques
Un planning ne dit que ce qui est **prévu**. Ce qui peut le mettre en défaut — un composant à
fournisseur unique, une qualification qui traîne, un moyen d'essai partagé — vivait dans un
tableau à part, sans lien avec les dates. Or un risque n'a d'intérêt que rapporté à une
**période** et à des **tâches** : de quand à quand suis-je exposé, et sur quoi ? C'est
précisément ce qu'un PERT sait dire.

- **Nouveau — le Risque, quatrième type d'objet du planning**, à côté de la tâche, du jalon et
  du label. Il se crée par **➕ Insérer ▾ → ⚠ Risque**. Il apparaît sous forme de **bandeau** posé
  au-dessus du planning : **sa position et sa largeur sont sa période**, lisibles sur le même axe
  des temps que les tâches.
- **Trois attributs, dont un seul se calcule tout seul.** Le **libellé** et la **date de début**
  se saisissent ; la **date de fin**, elle, est **déduite** — c'est la fin au plus tard de la
  dernière tâche couverte. Vous n'avez donc jamais à la remettre à jour : rattacher une tâche,
  en détacher une, allonger une durée ou replanifier suffit, la période suit.
- **À la création, un risque couvre tout le projet** (de T0 à la fin du planning) : l'hypothèse
  la plus large, donc la moins fausse tant que vous n'avez rien précisé. Désigner les tâches
  concernées ne fait ensuite que **resserrer** la période.
- **Dire sur quoi le risque pèse, sans quitter des yeux le planning.** La fenêtre
  **⚠ Couvrir des tâches…** reprend le principe de « Relier à… » : vous **désignez** les tâches
  par une **recherche** (nom ou notes, plus un filtre par groupe et par responsable). La vue ne
  bouge pas, aucun nœud n'est déplacé. Un clic couvre une tâche, un second l'en retire, et la
  **période exposée**, rappelée en tête, se met à jour à chaque clic. Depuis une tâche, le clic
  droit propose symétriquement **⚠ Risques couvrant cette tâche**.
- **Le début reste sous votre contrôle**, entre T0 et le début de la première tâche couverte —
  un risque qui commencerait après la tâche qu'il couvre ne la couvrirait pas. Votre saisie
  n'est jamais écrasée : détachez la tâche qui bornait le début, et la date que vous aviez tapée
  revient d'elle-même. Si une tâche couverte est **anticipée** (engagée avant T0), la borne
  descend avec elle.
- **Un filtre par risque** : le menu 🔎 Filtre gagne une section **Risques**. La choisir met en
  évidence le bandeau **et les tâches qu'il couvre**, tout le reste s'estompe — et le panneau
  ouvre dans le même geste la **synthèse des tâches couvertes** : dates, marges, avancement et
  **coût exposé**.
- **Une fenêtre Risques** — **📊 Synthèse ▾ → ⚠ Risques**, à côté de « Planification » et
  « Avancement ». Deux onglets : **par risque** (ce que chacun met en jeu) et **par tâche**
  (à combien de risques chaque tâche est exposée — la lecture qui fait ressortir celle qui en
  concentre plusieurs). Imprimable en PDF, un chapitre par onglet.

- **La réorganisation range aussi les risques.** En mode *chronologique complet*, ils sont
  regroupés en une **bande au-dessus du planning**, sur autant de lignes que nécessaire — deux
  risques dont les périodes ne se recouvrent pas partagent la même ligne. En mode *axe du temps
  seul*, leur hauteur est conservée comme celle des autres nœuds.
- **La barre d'outils est allégée** : les boutons *Activité*, *Jalon*, *Label* et *Risque* sont
  regroupés derrière un seul bouton **➕ Insérer ▾**, sur le modèle de *Réorganiser ▾* et de
  *Synthèse ▾*. Quatre boutons pour une famille d'actions qu'on ne déclenche qu'en construisant
  le planning rognaient la place des outils utilisés en permanence. Le **clic droit sur le fond**
  reste le chemin le plus direct quand on sait déjà où poser le nœud : il le pose sous le curseur.

> **Votre PERT n'est pas touché.** Un risque **n'entre dans aucun calcul** : dates au plus tôt et
> au plus tard, marges, chemin critique et coûts sont rendus au chiffre près comme avant. Vous
> pouvez en ajouter autant que vous voulez. Les plannings existants s'ouvrent sans changement et
> sans conversion — ils n'ont simplement aucun risque.

---

## v0.25 — 03/09/2026 · Relier deux nœuds sans les chercher à l'écran
Sur un planning qui dépasse l'écran, créer un lien était devenu le geste le plus coûteux de
l'outil : dézoomer pour retrouver la tâche visée, poser un filtre pour la distinguer, zoomer,
déplacer le nœud pour l'amener à portée de souris, tirer le trait, puis le remettre en place. Une
manœuvre d'affichage pour exprimer une simple relation de précédence — et le risque, à chaque
fois, de laisser l'agencement du planning abîmé derrière soi.

- **Nouveau — la fenêtre « Relier à… ».** Sélectionnez un nœud, faites un **clic droit** puis
  **🔗 Relier à…** (ou utilisez le bouton du même nom dans l'onglet **Synthèse** du panneau), et
  **désignez l'autre extrémité par son nom**. Le lien est créé au clic. La vue ne bouge pas, et
  aucun nœud n'est déplacé.
- **Cherchez comme vous vous souvenez de la tâche** : la recherche porte sur le **nom** et sur les
  **notes**, sans se soucier des majuscules ni des accents. Deux listes permettent en plus de se
  restreindre à un **groupe** ou à un **responsable**. Chaque résultat affiche son groupe, son
  responsable et sa date, de quoi trancher entre deux tâches de même nom.
- **Les deux sens sont possibles** — ajouter un **successeur** ou un **prédécesseur** au nœud
  choisi. Sans cela, il aurait fallu se déplacer jusqu'à l'amont pour lui ajouter une suite,
  c'est-à-dire refaire la navigation qu'on cherche à éviter.
- **La fenêtre reste ouverte** après chaque lien : on relie souvent plusieurs tâches d'affilée à un
  même jalon. La ligne cliquée passe en « déjà lié ».
- **Les liens impossibles sont refusés, et expliqués.** Un nœud déjà relié porte la mention
  **déjà lié** ; un nœud dont le lien refermerait une **boucle** (A avant B, et B avant A) porte
  la mention **boucle**. Dans les deux cas la ligne reste visible mais n'est plus cliquable — un
  cycle empêche PertFlow de calculer quoi que ce soit, il valait mieux l'écarter d'avance que de
  laisser un clic éteindre tout le planning.

Le manuel décrit la fenêtre au chapitre 5.

## v0.24 — 01/09/2026 · Version sécurisée
Aucune fonction ne change : **cette version se comporte exactement comme la précédente**. Ce qui
change, c'est ce que le fichier contient — et ce qu'on peut en prouver. Elle répond aux questions
que posent les services informatiques avant d'autoriser un outil sur leur réseau, et c'est
désormais **la version à diffuser** en entreprise : les précédentes restent fonctionnelles, mais
elles n'apportent pas ces garanties.

- **Le fichier est plus léger d'un quart** (2 041 → 1 475 Ko). La bibliothèque graphique embarquée
  est passée à sa version « cœur » : PertFlow n'utilisait que le canevas, mais emportait avec lui
  une centaine de briques inutilisées (audio, MIDI, webcam, réseau…). Elles ne sont plus là.
- **L'application ne peut plus, techniquement, communiquer avec l'extérieur.** Une règle de
  sécurité inscrite en tête du fichier demande au navigateur d'interdire toute sortie réseau. Ce
  n'était déjà pas le comportement de PertFlow ; c'est désormais le navigateur qui le garantit,
  et cela se lit en clair dans le fichier — un argument vérifiable à présenter à une DSI.
- **Un planning reçu d'un tiers ne peut plus rien déclencher.** Un fichier `.pert` est une
  description de planning, et rien d'autre : il ne peut plus faire exécuter au logiciel autre
  chose que l'affichage de vos tâches et de vos jalons.
- **Les licences des bibliothèques libres utilisées** accompagnent maintenant la livraison
  (`LICENCES-TIERCES.txt` dans l'archive), et leurs auteurs sont crédités dans le fichier lui-même.
- **Pour votre service informatique** : le dépôt contient de quoi refaire les vérifications
  (`node tools/audit-securite.js`) — nomenclature des bibliothèques, empreintes, comparaison avec
  les paquets officiels publiés, vulnérabilités connues, et observation du logiciel en marche. Le
  rapport produit est remis sur demande.

## v0.23.2 — 25/08/2026 · Export MS Project : dates, échéances et couleurs
Trois évolutions de l'export **Gantt MS Project (XML)**, toutes issues de retours d'utilisateurs.
Le fil conducteur : MS Project **replanifie** à l'import, il ne recopie pas les dates du fichier —
il fallait donc lui parler dans son vocabulaire.

- **Correctif — les jalons d'entrée ne s'écrasent plus sur T0.** Un jalon d'entrée (une livraison
  fournisseur, un déblocage de budget…) partait bien avec sa date-cible dans le fichier, mais MS
  Project la remplaçait par le début du projet : faute de contrainte, il planifie « dès que
  possible » toute tâche sans prédécesseur. Sa date est désormais **épinglée** (contrainte « Début
  au plus tôt »), et arrive donc là où vous l'avez placée. Les **tâches anticipées** bénéficient du
  même épinglage — sans lui, MS Project les collait au plus tôt derrière leur prédécesseur et
  l'anticipation disparaissait du planning importé.
- **Correctif — la date-cible d'un jalon de sortie devient une échéance.** Elle part maintenant
  dans le champ **Échéance** de MS Project, qui affiche le repère sur le Gantt et signale le
  dépassement : l'équivalent exact de la « tenue de cible » de PertFlow. Le jalon, lui, se place
  sur sa **date calculée**. Que la cible ait été saisie en date ou en « T0 + X » ne change rien,
  elle est convertie. Un jalon d'**entrée** n'en reçoit pas : sa date est une donnée d'entrée,
  pas un engagement à tenir.
- **Nouveau — le groupe et la couleur voyagent avec le fichier.** Le format MSPDI ne sait pas
  transporter l'apparence d'un Gantt (elle appartient au fichier `.mpp`) : aucun outil ne peut
  restituer vos couleurs automatiquement. Chaque tâche emporte donc deux **champs personnalisés**,
  **Groupe** et **Couleur PertFlow**, à partir desquels recolorier vos barres par lot en quelques
  clics — la marche à suivre est dans le manuel, chapitre 11.
- **Manuel** : le chapitre *Exporter le planning* rappelle désormais, format par format, les
  **conventions et hypothèses** de chaque export (ce qui est transmis, ce qui ne l'est pas, ce qui
  reste à votre charge), et une section entière est consacrée à l'export MS Project.

## v0.23.1 — 25/08/2026 · Correctif export MS Project
- Correctif ciblé : un libellé de tâche ou de jalon contenant un **retour à la ligne** rendait le
  fichier **MS Project (MSPDI XML)** non conforme, empêchant son import. Les retours à la ligne
  sont désormais remplacés par un espace dans le fichier exporté.
- Aucun autre changement.

## v0.23 — 21/08/2026 · Export « Planning directeur »
- Nouvel export Excel : le **planning directeur**, la vue qu'on projette en **revue de projet**.
  Une colonne par mois, surmontée des trimestres et des années, sur **exactement la durée réelle
  de votre projet** ; vos tâches en barres et vos jalons en losanges, à leur couleur de groupe,
  avec une légende.
- Ce ne sont pas des cellules coloriées mais de **vraies formes dessinées** : une fois dans Excel,
  vous les déplacez, les retaillez, en ajoutez, changez un libellé. Le document est fait pour être
  retouché, pas seulement lu.
- **Votre agencement est respecté.** La position verticale de chaque tâche est celle que vous lui
  avez donnée dans PertFlow : rien n'est retrié, réempilé ni regroupé. Horizontalement, en
  revanche, tout est recalé sur les **dates calculées** — c'est ce qui garantit qu'une barre tombe
  bien sous son mois. (Un jalon se place sur sa date-cible si vous en avez saisi une.)
- Les **deux colonnes de gauche sont livrées vides mais mises en forme** : vous y saisissez votre
  propre nomenclature (poste, lot, système…) après l'export, et fusionnez les cellules à votre
  guise. PertFlow n'a qu'un niveau de regroupement, il ne vous en impose pas un second.
- Le classeur s'ouvre prêt à imprimer : colonnes de gauche et en-tête **figés**, **paysage**,
  ajustement en largeur. Les liens de dépendance n'y sont volontairement pas tracés (illisibles
  dès qu'un planning s'étoffe) ; ils restent dans l'export MS Project.
- Cette version emporte aussi ce qui attendait depuis le 1er août : les **notes de version voyagent
  avec l'archive** de livraison, en texte brut lisible au Bloc-notes, et la documentation de
  reprise (`conception.md`, `maintenance.md`) a été remise à jour.

## v0.22 — 01/08/2026 · Charge en ETP ou en heures
- La charge d'une tâche peut désormais s'exprimer **en heures** autant qu'en **ETP**. Le panneau
  affiche un sélecteur **« Charge exprimée en »** puis **les deux valeurs côte à côte** : celle que
  vous saisissez, et celle qui en est déduite (grisée). Utile en **phase Offre**, où le chiffrage
  se négocie en heures et où l'élongation n'est pas toujours arrêtée.
- **Changer de mode ne change jamais le coût** : la valeur affichée en face devient simplement la
  nouvelle saisie. Vous pouvez chiffrer en heures puis basculer en ETP pour voir combien de monde
  cela suppose.
- Ce que le mode change, c'est ce qui **résiste quand la durée bouge** : en **ETP**, allonger la
  tâche augmente sa charge en heures ; en **Heures**, l'enveloppe d'heures et le coût ne bougent
  pas, c'est l'ETP déduit qui se dilue.
- La **synthèse de planification** gagne une colonne **Charge (h)** par groupe et une ligne
  **Charge totale** dans la vue d'ensemble : les tâches chiffrées en ETP et celles chiffrées en
  heures s'y additionnent dans la même unité.
- L'export **CSV** gagne une colonne **`Charge(h)`** en fin de ligne (la colonne `ETP` reste
  remplie, avec la valeur déduite le cas échéant) ; le **Gantt Excel** et l'export **MS Project**
  tiennent compte du mode.
- **Panneau d'une tâche réorganisé** : d'abord ce qui sert à **planifier** (libellé, durée, tâche
  anticipée, couleur, groupe, responsable, notes), puis, sous l'intertitre **« Suivi et coût »**,
  l'avancement et la charge. Un PERT sert d'abord à bâtir une stratégie ; le suivi et le chiffrage
  sont des fonctions d'appoint, et la liste des champs avait fini par le masquer.
- **Vos plannings existants sont inchangés** : un fichier `.pert` antérieur s'ouvre en mode ETP,
  avec exactement les mêmes coûts qu'avant.

## v0.21.1 — 31/07/2026 · Dépôt prêt pour une reprise
- **Aucun changement dans l'application** : cette version est fonctionnellement identique à la
  v0.21. Si vous utilisez PertFlow, vous n'avez rien à faire — cette archive et la précédente
  contiennent le même outil.
- Ce qui change est **côté dépôt**, pour qui reprendrait le développement : la **suite de tests**
  (29 tests qui pilotent l'application dans un vrai navigateur) et les **plannings d'exemple**
  entrent dans le dépôt, avec leur mode d'emploi et leurs prérequis dans `tools/README.md`. Ils en
  étaient absents jusqu'ici : personne d'autre que l'auteur ne pouvait vérifier une modification.
- La documentation de reprise (`docs/conception.md`, `docs/maintenance.md`) est réalignée, et les
  documents qui ne traçaient que l'avancement du chantier ont quitté le dépôt.
- Le numéro de version est repris uniquement pour que le bouton **« À propos »** de l'application
  et cette archive affichent la même chose.

## v0.21 — 29/07/2026 · Suivi d'avancement
- Nouveau champ **Avancement** sur chaque tâche : **Non commencé** (par défaut), **En cours**,
  **Terminé**. Il **n'a aucun effet sur le calcul PERT** — dates, marges, chemin critique et coûts
  sont identiques que vous le renseigniez ou non. Une **pastille** apparaît sur le nœud pour « en
  cours » et « terminé » seulement : un planning que personne ne suit s'affiche exactement comme
  avant.
- Le bouton **📊 Synthèse** devient un menu à deux entrées : **Planification** (la synthèse
  existante — le planning tel qu'il est prévu) et **Avancement** (le nouveau **suivi** — le même
  planning confronté à la date du jour).
- La **fenêtre de suivi** a deux onglets. **Tâches** : ce qui est *en cours*, ce qui est *à
  engager* (l'amont est en cours, ou la date de début est atteinte) et ce qui **aurait dû
  commencer**, avec le retard et la tâche amont qui bloque. **Jalons** : les *prochains jalons* par
  ordre chronologique, et les *jalons en alerte* — échéance proche alors que l'amont n'est pas
  terminé, en **rouge** si une tâche amont n'est même pas commencée (replanification à prévoir), en
  **orange** si elle est engagée mais pas finie (à surveiller). Tout est cliquable et imprimable.
- Le **filtre** gagne l'axe **avancement**, avec un regroupement **« En cours ou non commencé »**
  pour voir le **reste à faire** tout confondu.
- Les exports **CSV** et **Gantt Excel** transportent l'avancement.
- Nouveau contrôle dans l'onglet **Analyse** : **Nœuds masqués** — un nœud dont la moitié au moins
  disparaît sous un autre n'est plus lisible ni cliquable, au point qu'on peut le croire supprimé.
  Les recouvrements partiels ne sont pas signalés.
- **Correctif** : aller à un nœud (voisin du panneau, nom cliqué dans la synthèse ou le suivi)
  **lève désormais le filtre** en cours. Auparavant la vue se centrait sur un nœud resté estompé,
  voire invisible — particulièrement déroutant en enchaînant filtre et navigation depuis la
  synthèse.

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
