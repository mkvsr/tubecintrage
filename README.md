# TubeCintrage — version 0.6 (site GitHub Pages)

TubeCintrage prépare le cintrage à partir de la CAO. Il donne la liste de débit et le plan de coupe des barres,
puis le programme de l'Ercolina MG030 + banc mandrin (Y, B, angle, compensation) et l'orientation de la soudure.
Il contrôle aussi la faisabilité et simule chaque tube pli par pli en 3D.

L'application fonctionne entièrement dans le navigateur, sur PC comme sur tablette Android.
**Les fichiers CAO ne quittent jamais le poste.** Le site ne contient que l'application et les lots que vous
publiez, chiffrés avec le mot de passe de l'atelier.

## 1. Mise en ligne (une seule fois)

1. Sur github.com : **New repository**, nom `tubecintrage`, visibilité **Public**, puis **Create repository**.
2. Sur la page du dépôt vide : **uploading an existing file**. Glisser **tout le contenu** du dossier `site`
   (dossiers `css`, `img`, `js`, `vendor` et les fichiers `index.html`, `sw.js`…), puis **Commit changes**.
3. **Settings > Pages** : *Source* = **Deploy from a branch**, *Branch* = **main** / **(root)**, puis **Save**.
4. Une à deux minutes plus tard, le site est en ligne à l'adresse `https://<votre-compte>.github.io/tubecintrage/`.

## 2. Poste qui prépare les lots (une seule fois)

Pour publier depuis l'application, il faut un **jeton GitHub** limité à ce dépôt.

1. Sur github.com : photo de profil > **Settings** > **Developer settings** > **Personal access tokens** >
   **Fine-grained tokens** > **Generate new token**.
2. *Expiration* : 1 an (à renouveler ensuite). *Repository access* : **Only select repositories** > `tubecintrage`.
3. *Permissions* > *Repository permissions* > **Contents** : **Read and write**. Puis **Generate token** et copier le jeton.
4. Dans TubeCintrage : **Paramètres > onglet Partage**. Le dépôt est déjà rempli. Coller le jeton, puis cliquer sur
   **Tester la connexion**. Choisir le **mot de passe atelier**.

Le jeton reste dans le navigateur de ce poste. Les tablettes n'en ont pas besoin.

## 3. Travail quotidien

**Au bureau (PC)**

1. Glisser les fichiers (`.json` de la macro SolidWorks, `.step`, `.stp`, points) sur la page et vérifier chaque tube.
2. **Publier** : donner un nom au lot. Il est chiffré et envoyé sur GitHub, puis visible sur les tablettes
   **1 à 2 minutes plus tard**. Republier un lot du même nom le remplace.
3. **Dossier PDF** : liste de débit, plan de coupe barre par barre, fiche et simulation pas à pas de chaque tube.

**À l'atelier (tablette)**

1. Ouvrir l'adresse du site dans Chrome, puis **⋮ > Ajouter à l'écran d'accueil** : l'application s'ouvre ensuite
   comme une appli, et elle fonctionne même sans réseau une fois chargée.
2. La première fois, saisir le **mot de passe atelier**.
3. À chaque ouverture, la liste **Lots de l'atelier** s'affiche : toucher un lot. On retrouve alors tous les tubes,
   le tableau Y / B / angle / compensation, la simulation (toucher une ligne pour aller au pli) et le dossier PDF.

**Paramètres machine** : *Paramètres*, modifier les valeurs, cocher **Publier ces paramètres pour tout l'atelier**,
puis **Enregistrer**. Tous les postes les prennent à leur prochaine ouverture. Sans cette case, la modification
ne vaut que pour ce navigateur. *Revenir aux réglages publiés* annule une modification locale.

Pour reprendre les réglages de la version Python : *Paramètres > Partage > Importer un fichier…* et choisir
`C:\Users\<nom>\TubeCintrage\parametres_machine.json`. Les fichiers `.tclot` sont compatibles dans les deux sens.

## 4. Sécurité

- Un site GitHub Pages est public, mais les lots (`lots/*.tcx`, y compris leur liste et leurs noms) sont chiffrés
  en AES-256 avec une clé tirée du mot de passe atelier. Sans le mot de passe, ces fichiers sont illisibles.
- Choisir un mot de passe d'au moins 10 caractères, et ne pas le noter sur la tablette.
- Les paramètres machine (`parametres_machine.json`) sont en clair, car ils ne contiennent rien de confidentiel.
- **Changer de mot de passe** : les lots déjà publiés restent chiffrés avec l'ancien. Il faut supprimer le dossier
  `lots` du dépôt sur github.com, puis republier les lots utiles avec le nouveau mot de passe.
- Si le jeton GitHub fuite, le supprimer sur github.com (*Fine-grained tokens > Delete*) et en créer un autre.

## 5. Mise à jour de l'application

Déposer les nouveaux fichiers dans le dépôt par-dessus les anciens (*Add file > Upload files*), sans toucher
au dossier `lots` ni à `parametres_machine.json`. Les postes prennent la nouvelle version à leur prochaine ouverture.

## 6. Macro SolidWorks

Elle est inchangée (`ExportTubes.bas`) : *Outils > Macro > Nouvelle…* (`ExportTubes.swp`), puis dans l'éditeur VBA
*Fichier > Importer* `ExportTubes.bas`, supprimer `Module1` et enregistrer. La macro exporte les esquisses 3D
en `<nom>_tubes.json`.

---
Bibliothèques intégrées : three.js 0.170, jsPDF 2.5.2, occt-import-js 0.0.23 (OpenCascade), police DejaVu Sans.
Tests : `node --test tests/comparer.test.js tests/step.test.js`. Les résultats sont identiques à la version Python.
