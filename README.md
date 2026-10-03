# Manwha Rank Site

Un site web public pour classer les manwhas, avec:
- photo de couverture
- titre
- genre (Isekai, monde moderne, Murim, etc.)
- description personnelle
- nombre de chapitres
- statut détaillé
- accès de modification réservé aux comptes autorisés

## Fonctionnalités

- classement public des manwhas
- sections par statut
- gestion des abandons : introuvable, abandon par la team de traduction, abandon par le créateur, abandon manuel
- suivi des titres avec moins de 30 chapitres
- liste des titres à analyser
- authentification sécurisée avec mot de passe hashé
- comptes admin / éditeur

## Démarrage rapide

1. Installer les dépendances :
   npm install

2. Copier le fichier d'environnement :
   cp .env.example .env

3. Modifier les valeurs sensibles si besoin.

4. Lancer le site :
   npm start

5. Ouvrir :
   http://localhost:3000

## Compte admin par défaut

- nom d'utilisateur : admin
- mot de passe : ChangeMe123!

Important : modifiez immédiatement ceci dans votre fichier `.env` pour la sécurité.

## Réglages de sécurité

- mots de passe hashés avec bcrypt
- sessions sécurisées côté serveur
- protection du site avec Helmet
- limitation de débit des requêtes API
- validation des entrées utilisateur

## Structure

- `server.js` : backend Express
- `public/` : interface web publique
- `data/` : base SQLite locale
