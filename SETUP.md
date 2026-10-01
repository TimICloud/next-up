# Activer les comptes Next Up et le catalogue complet

Une seule fois, pour toute l'app. Ensuite, chaque utilisateur crée simplement son compte Next Up
et a automatiquement accès à tous les films et séries. Il ne voit jamais TMDB.

```
Utilisateur ──(compte Next Up)──▶ Serveur Next Up (Supabase) ──(ta clé TMDB, secrète)──▶ TMDB
```

Compte environ 20 minutes. Tout se fait dans le navigateur, sans rien installer.

## 1. Clé TMDB de Next Up

1. Crée un compte sur themoviedb.org (c'est le compte « développeur » de Next Up, à ton nom).
2. Paramètres → API → demande une clé. Type : **Personnel / développeur** tant que l'app est gratuite.
3. Copie le **Jeton d'accès en lecture à l'API** (long texte qui commence par `eyJ`).

> Si un jour Next Up devient payante ou affiche de la publicité, TMDB demande une licence commerciale.

## 2. Projet Supabase

1. Crée un compte sur supabase.com, puis **New project** :
   - Nom : `next-up`
   - Région : **Europe (Frankfurt ou Paris)**
   - Mot de passe de base de données : génère-le et garde-le dans un endroit sûr.
2. Attends 1 à 2 minutes que le projet soit prêt.

## 3. Base de données (bibliothèques des utilisateurs)

1. Menu **SQL Editor** → **New query**.
2. Colle tout le contenu du fichier `supabase/schema.sql`, puis **Run**.
3. Résultat attendu : « Success. No rows returned ».

## 4. Passerelle TMDB (le serveur qui garde ta clé)

1. Menu **Edge Functions** → **Secrets** → ajoute :
   - Nom : `TMDB_TOKEN` (le nom `TMDB-token` est aussi accepté)
   - Valeur : le jeton TMDB de l'étape 1
2. **Edge Functions** → **Deploy a new function** → **Via Editor**.
3. Nom de la fonction : `tmdb` (exactement).
4. Remplace le code proposé par tout le contenu de `supabase/functions/tmdb/index.ts`, puis **Deploy**.

## 5. Comptes utilisateurs

Menu **Authentication** → **Sign In / Providers** → **Email** : activé par défaut.

- **Pendant les tests**, tu peux désactiver « Confirm email » pour créer des comptes sans devoir cliquer sur un lien.
- **Avant la publication**, réactive-le, et dans **URL Configuration** indique l'adresse de l'app en ligne.

## 6. Relier l'app au serveur

Menu **Project Settings** → **API** (ou **API Keys**), copie :

- **Project URL** (ex. `https://abcdxyz.supabase.co`)
- la clé **anon / publishable**, qui est publique par nature (ne copie jamais la clé `service_role` / `secret`)

Puis donne-les à Claude, ou colle-les toi-même dans `js/config.js` :

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'ta-clé-anon';
```

C'est tout : l'app affiche alors « Crée ton compte Next Up », et une fois connecté, la recherche porte sur tout le catalogue.
