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

## Catalogue

- Sans configuration : catalogue de démonstration intégré (les plateformes indiquées y sont fictives).
- Avec une clé **TMDB** gratuite (Profil → Catalogue complet) : tous les films et séries, affiches, noms d'épisodes, nouvelles saisons et plateformes réellement disponibles dans ton pays.

## Structure

| Fichier | Rôle |
|---|---|
| `js/app.js` | Écrans, navigation, actions |
| `js/store.js` | Bibliothèque, progression, sauvegarde (navigateur) |
| `js/catalog.js` | Catalogue démo + API TMDB |
| `js/platforms.js` | Plateformes de streaming |
| `css/app.css` | Design (palette Néon) |
| `sw.js`, `manifest.webmanifest` | App installable et hors ligne |
