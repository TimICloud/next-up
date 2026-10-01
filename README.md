# Next Up

Suis où tu en es dans tes séries et films, quelle que soit la plateforme de streaming.

- **+1** : un tap pour marquer l'épisode suivant comme vu (avec « Annuler »).
- **La progression appartient au titre, pas à la plateforme** : si une série passe de Netflix à Prime Video, rien n'est perdu ; l'app te prévient et garde l'historique des plateformes.
- Ajout manuel : choisis le titre, la plateforme, et le prochain épisode à voir.
- Fonctionne comme **site web** et comme **app installable** (PWA) sur iPhone, Android et ordinateur, y compris hors ligne.

## Lancer en local

Les modules JavaScript ne fonctionnent pas en ouvrant `index.html` directement : il faut un petit serveur.

```bash
ruby -run -e httpd . -p 8770
```

Puis ouvre http://localhost:8770.

## Comptes et catalogue

- Sans serveur configuré : mode démo, catalogue intégré (les plateformes indiquées y sont fictives).
- Avec le serveur Next Up (Supabase) : chaque utilisateur crée son compte Next Up et accède à tout le catalogue TMDB
  (affiches, épisodes, plateformes réellement disponibles dans son pays). La clé TMDB reste sur le serveur.
  La bibliothèque est sauvegardée dans le compte et synchronisée entre appareils.

Mise en place : voir [SETUP.md](SETUP.md).

## Structure

| Fichier | Rôle |
|---|---|
| `js/app.js` | Écrans, navigation, actions |
| `js/store.js` | Bibliothèque, progression, sauvegarde et synchronisation |
| `js/catalog.js` | Catalogue démo + TMDB via le serveur Next Up |
| `js/auth.js`, `js/config.js` | Comptes Next Up (Supabase) |
| `supabase/functions/tmdb` | Passerelle serveur vers TMDB (garde la clé secrète) |
| `supabase/schema.sql` | Table des bibliothèques, accès limité à chaque utilisateur |
| `js/platforms.js` | Plateformes de streaming |
| `css/app.css` | Design (palette Néon) |
| `sw.js`, `manifest.webmanifest` | App installable et hors ligne |
