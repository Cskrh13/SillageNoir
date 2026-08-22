# Correction du générateur — Sillage Noir

Corrections apportées à `js/generator.js` :

- restauration de l'infrastructure de chargement JSON (`PATHS`, `getJSON`) ;
- restauration de la normalisation des suppléments et armées ;
- restauration du chargement des Honneurs Elfiques ;
- restauration de `loadMagicItems()` ;
- résolution des anciens identifiants de sources d'objets magiques vers les vrais fichiers :
  - `objets-magiques-courants` → `communs.json` ;
  - `royaumes-hauts-elfes` → `hauts-elfes.json` ;
  - `tour-dargent` → `tour-d-argent.json` ;
  - `elfes-noirs` → `elfes-noirs.json` ;
  - `sillage-noir` → `sillage-noir.json` ;
- conservation du format existant `restrictions.global.magicItems.source` au singulier ;
- chargement de la source générique de l'armée puis des sources du supplément, avec déduplication ;
- initialisation des fonctions utilitaires manquantes utilisées par le générateur ;
- suppression d'un bloc de code orphelin qui rendait le fichier JavaScript syntaxiquement invalide.

Aucun fichier d'objets magiques n'a été modifié.
