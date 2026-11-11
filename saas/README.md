# Wakil — une équipe d'agents IA pour boutiques en ligne

MVP d'un SaaS où quatre agents IA travaillent sur une boutique e-commerce. Le client discute avec un agent, l'agent produit des livrables, et **rien n'est appliqué à la boutique sans validation**.

| Agent | Ce qu'il fait |
|---|---|
| **Webmaster** | Réécrit les fiches produits, crée les pages (FAQ, À propos, Livraison et retours), change les prix en masse, prépare les codes promo et la barre d'annonce |
| **SEO** | Audite le catalogue ou une page publique, propose balises title et meta descriptions, rédige des articles |
| **Emailing** | Écrit séquences de bienvenue, relances de panier, newsletters, avec aperçu HTML |
| **Réseaux & Vidéo** | Écrit scripts TikTok/Reels plan par plan (avec ou sans présentateur IA), posts, calendrier éditorial |

Le client n'a jamais accès à Claude Code : il utilise cette interface, et les agents appellent l'API Claude côté serveur.

## Lancer en local

```bash
cd saas
npm install
cp .env.example .env.local   # puis renseigner ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Sans clé API, l'application démarre en **mode démo** : les agents rejouent un scénario préenregistré (un bandeau l'indique à l'écran). Les outils, les livrables et la validation fonctionnent comme en réel.

## Lancer sur son ordinateur avec Claude Code

Dans une conversation Claude Code ouverte sur un dossier de l'ordinateur, coller :

```
Récupère le projet https://github.com/misako93/intro-javascript, branche claude/claude-code-vs-n8n-6ftwem, et va dans le dossier saas. Lis saas/README.md.
Trouve ma clé API Claude (elle commence par sk-ant-) dans mon dossier Téléchargements ou dans mon dossier Claude, sans jamais l'afficher. Crée le fichier saas/.env.local avec ANTHROPIC_API_KEY=<la clé>.
Lance npm install puis npm run dev, et ouvre http://localhost:3000.
Teste une demande par agent avec les boutons de suggestion, puis les demandes de prix, de code promo et de barre défilante du Webmaster. Corrige ce qui ne marche pas et dis-moi ce que tu as trouvé.
```

`.env.local` n'est jamais envoyé sur GitHub : la clé reste sur l'ordinateur.

## Mettre en ligne sur Vercel

1. Sur [vercel.com](https://vercel.com), **Add New → Project** et importer ce dépôt GitHub.
2. **Root Directory** : `saas`.
3. **Environment Variables** :
   - `ANTHROPIC_API_KEY` : votre clé, créée sur [platform.claude.com](https://platform.claude.com).
   - `ACCESS_CODE` : un code de votre choix. Il sera demandé à l'ouverture, pour que personne d'autre ne consomme votre crédit API.
4. **Deploy**.

Un tour d'agent peut durer plus d'une minute : la route `/api/chat` demande jusqu'à 300 secondes (`maxDuration`). Si Vercel refuse cette valeur au déploiement, activer **Fluid Compute** dans les réglages du projet.

Vercel déploie la branche par défaut du dépôt : le dossier `saas/` doit donc s'y trouver (fusionner la pull request), ou bien choisir cette branche comme branche de production dans les réglages du projet.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clé API Claude. Absente : mode démo. | — |
| `ACCESS_CODE` | Code demandé à l'ouverture de l'application. | aucun |
| `CLAUDE_MODEL` | Modèle utilisé par les agents. | `claude-opus-5-5` |
| `CLAUDE_EFFORT` | `low` (rapide) à `max` (poussé). | `low` |
| `CLAUDE_FALLBACKS` | `off` pour désactiver le repli automatique sur un autre modèle quand une demande est refusée par erreur. | activé |
| `DEMO_MODE` | `1` pour forcer le mode démo même avec une clé. | — |

## Comment ça marche

- `app/api/chat/route.ts` reçoit le message, la boutique et l'historique, et renvoie un flux d'événements (texte, activité des outils, livrables).
- `lib/server/run-agent.ts` contient la boucle de l'agent : Claude répond en streaming, appelle des outils, lit leurs résultats et recommence jusqu'à avoir terminé.
- `lib/server/tools.ts` définit les outils de chaque agent. Chaque entrée est validée avant exécution ; une entrée invalide est renvoyée à Claude pour correction.
- `lib/server/playbooks.ts` contient la méthode de chaque agent, en français et sans code : structure d'une fiche produit, règles des balises et des articles SEO, séquences d'emails, construction d'une vidéo courte. **C'est le fichier à modifier pour changer la façon d'écrire des agents.**
- Le **brief de marque** (écran « Brief de marque ») dit à qui la boutique parle, sa voix, ce qui la distingue, les informations pratiques vérifiées et ce qu'il ne faut jamais écrire. Les quatre agents le reçoivent à chaque demande, et n'affirment rien sur la livraison ou les retours qui n'y figure pas.
- `lib/server/prompts.ts` assemble le tout : mission, brief de marque, méthode, règles d'écriture, interdits (inventer des chiffres ou des avis, fausse urgence, allégations santé).
- `lib/audit.ts` calcule les scores SEO avec des règles fixes : le score affiché ne vient jamais du modèle.
- Les prix en masse suivent le même principe : l'agent choisit une règle (« -15 % sur la catégorie Huiles, arrondi à ,90 ») et c'est `propose_price_rule` qui calcule chaque prix. L'écran de validation montre la variation réelle après arrondi.
- `lib/store-changes.ts` applique à la boutique les changements validés : fiche, prix, code promo, barre d'annonce. L'écran « Aperçu du site » les montre aussitôt.
- `lib/server/seo-page.ts` télécharge une page publique pour l'auditer et bloque les adresses internes.
- L'état (boutique de démo, conversations, livrables) est gardé dans le navigateur. Le serveur ne stocke rien.

Le nom du produit se change dans `lib/config.ts`.

## Tests

```bash
npm test          # outils, audit, boucle de l'agent, garde-fous réseau
npm run typecheck
```

`tests/sdk-integration.test.ts` fait tourner le vrai SDK Claude et la vraie boucle d'agent contre un faux serveur local (`tests/fake-claude.ts`) qui parle le même protocole de streaming que l'API. Il vérifie la requête réellement envoyée et la lecture du flux, pas la qualité des réponses du modèle.

Pour essayer l'interface hors mode démo sans dépenser de crédit :

```bash
FAKE_PORT=4010 npx tsx tests/fake-claude.ts
ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=test npm run dev
```

## Limites de ce MVP

- **Une seule boutique, fictive** (« Maison Nour »). La connexion à une vraie boutique Shopify n'est pas faite : valider une proposition modifie le catalogue de démonstration, pas un site réel.
- **Pas de comptes clients ni de paiement.** Le code d'accès unique protège l'URL, il ne sépare pas plusieurs clients.
- **Pas d'envoi d'emails ni de publication sur les réseaux.** Les livrables sont à copier dans l'outil du client.
- **Pas de génération de vidéo.** Pour une vidéo avec présentateur IA, l'agent écrit le script, la voix off et le brief du personnage, à donner à un outil de génération vidéo. Brancher un tel outil demande un compte et une clé chez ce fournisseur.
- **Pas de données de recherche** (volumes, positions) : l'agent SEO raisonne par intention et le dit.
