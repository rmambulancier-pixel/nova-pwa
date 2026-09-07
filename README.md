# NOVA — Progressive Web App

Zéro build, zéro Gradle, zéro Android Studio. HTML/CSS/JS pur, aucune dépendance,
tout tourne dans le navigateur et fonctionne hors-ligne une fois chargé.

## Installer sur le téléphone

Une PWA doit être servie en HTTPS pour être installable (verrou technique du
navigateur, pas de ma part). Le plus simple avec ce que tu as déjà :

1. Crée un dépôt GitHub (ou réutilise un dépôt existant) et pousse ce dossier
   tel quel à la racine (ou dans un sous-dossier `docs/`).
2. Dans les réglages du dépôt → **Pages**, active GitHub Pages sur la branche
   et le dossier concernés.
3. GitHub te donne une URL du type `https://<toi>.github.io/<repo>/`.
4. Ouvre cette URL sur ton téléphone (Chrome sur Android, Safari sur iOS) →
   menu du navigateur → **Ajouter à l'écran d'accueil**.

Ça y est, tu as une icône NOVA sur ton téléphone, sans passer par un store ni
un pipeline de build.

## Ce qui marche vraiment

- **Hors-ligne** : le service worker met en cache toute l'app au premier
  chargement. Une fois installée, elle s'ouvre sans réseau.
- **Toutes les données restent sur l'appareil** (`localStorage`) : missions,
  business, watch lab, argent, notes, historique Alphonse.
- **Verrou d'accès** : essaie d'abord l'empreinte/Face ID du téléphone via
  WebAuthn ; si l'appareil ne le supporte pas, bascule sur un code à 4
  chiffres.
- **Alphonse** répond toujours, même sans rien configurer (moteur local
  déterministe). Un LLM distant compatible OpenAI peut être branché dans
  Réglages — la clé reste uniquement dans ce navigateur, jamais envoyée
  ailleurs qu'à l'endpoint que tu renseignes.
- **Export/import JSON** : bouton dans Réglages. À faire régulièrement,
  surtout avant de changer de téléphone ou de vider le cache du navigateur.

## Ce qui NE marche PAS comme une vraie app native

- **Pas de notification en tâche de fond garantie.** Sans serveur qui pousse
  les notifications (Web Push), le rappel quotidien ne se déclenche que si
  l'app est ouverte ce jour-là. C'est un vrai rappel, mais pas une alarme
  fiable pendant que le téléphone dort.
- **Le verrou n'est pas un vrai verrou biométrique système** — c'est
  WebAuthn, standard et sérieux, mais géré par le navigateur, pas par
  Android/iOS directement.
- **Vider les données du navigateur = tout perdre**, sauf si tu exportes
  régulièrement. Aucun cloud derrière, par choix.

## Structure

```
index.html          — app shell + les 5 écrans (Radar, Business, Watch, Money, Brain) + Réglages
styles.css           — design tokens, layout mobile-first
app.js                — état, rendu, moteur local, Alphonse, verrou, rappel
manifest.json         — installabilité PWA
service-worker.js     — cache hors-ligne (ne met jamais en cache les appels au LLM distant)
icons/                — icônes 192/512/maskable
```

Aucune étape de build : modifier un fichier = recharger la page pour voir le
changement (en dev). Une fois déployé, le service worker garde en cache
l'ancienne version jusqu'au prochain chargement réseau — pense à faire un
"hard refresh" après un déploiement si tu ne vois pas tes changements.
