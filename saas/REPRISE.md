# Reprise du projet Wakil

Ce fichier est écrit pour la session Claude Code qui prend le relais sur l'ordinateur de l'utilisatrice. Il dit où en est le projet, ce qui a été vérifié, ce qui ne l'a pas été, et quoi faire en premier.

Rédigé le 11 novembre 2026 vers 11 h 30, heure du Caire.

## L'essentiel en cinq lignes

1. Wakil est le MVP d'un SaaS : quatre agents IA (Webmaster, SEO, Emailing, Réseaux & Vidéo) qui travaillent sur une boutique en ligne. Tout le code est dans `saas/`.
2. L'utilisatrice le présente **ce soir, 11 novembre 2026, entre 20 h et 21 h heure du Caire**, en webinaire, en partage d'écran.
3. **Aucun agent n'a encore tourné avec la vraie API Claude.** Tout a été vérifié en mode démo et contre un faux serveur. C'est le seul gros risque.
4. La première chose à faire : lancer l'application sur cet ordinateur avec la clé API de l'utilisatrice, tester chaque agent, corriger ce qui casse.
5. Ne rien ajouter de nouveau avant que ce test soit passé.

## Avec qui tu travailles

- Solopreneure, spécialiste SEO et e-commerce. Elle n'est pas développeuse : pas de jargon, pas de commandes à lui faire taper si tu peux les lancer toi-même.
- Elle écrit en français, souvent en dictant. Réponds en français, en la tutoyant, de façon courte.
- Elle veut des réponses honnêtes : ni faux espoir, ni découragement. Dis ce qui marche, ce qui ne marche pas, et ce que tu n'as pas vérifié.
- Elle tient à ce que tout soit honnête (halal) : pas de faux témoignage, pas de fausse urgence, pas de promesse non tenue. C'est aussi écrit dans les consignes des agents.
- Son objectif ce soir : montrer la démo et vendre un accès anticipé. Pas vendre un produit fini.

## Où est le code

- Dépôt : `https://github.com/misako93/intro-javascript`
- Branche : `claude/claude-code-vs-n8n-6ftwem`
- Dossier : `saas/` (le reste du dépôt est un ancien cours JavaScript, sans rapport)
- Pull request n° 2, en brouillon, vers `gh-pages` (la branche par défaut du dépôt)

**Ne fusionne pas la pull request et ne pousse rien sur `gh-pages` sans que l'utilisatrice le demande explicitement.** Elle ne l'a pas demandé. La fusion ne sert que pour un déploiement sur Vercel, qui n'est pas nécessaire ce soir.

## Première mission : lancer avec la vraie clé

1. Vérifie Node.js : version 20.9 ou plus récente (`node -v`). Installe-le si besoin.
2. Trouve la clé API Claude de l'utilisatrice. Elle dit qu'elle est dans son dossier **Téléchargements** ou dans son **dossier Claude**.
   - Une clé API commence par `sk-ant-api`. Ne la confonds pas avec les jetons de connexion de Claude Code (`sk-ant-oat…`), qui ne sont pas des clés API.
   - Ne l'affiche jamais, ne la copie dans aucun fichier suivi par Git, ne la mets dans aucun message.
   - Si tu ne la trouves pas : elle en crée une nouvelle sur platform.claude.com, rubrique « API keys ». Une clé ne s'affiche qu'une fois, à sa création.
3. Crée `saas/.env.local` (ce fichier est ignoré par Git) :
   ```
   ANTHROPIC_API_KEY=<la clé>
   ```
4. Lance :
   ```bash
   cd saas
   npm install
   npm run dev
   ```
5. Ouvre `http://localhost:3000`. Le bandeau jaune « Mode démo » doit avoir disparu. S'il est encore là, la clé n'est pas lue.

Pour le webinaire, l'application lancée ainsi sur l'ordinateur suffit : elle se montre en partage d'écran.

Sous Windows, les variables écrites devant une commande (`VARIABLE=valeur commande`) ne fonctionnent pas dans PowerShell : passe par `.env.local`.

## Le test à faire avec le vrai Claude

Clique sur les demandes d'exemple (au centre quand la conversation est vide, puis au-dessus de la zone de saisie). Pour chacune, note la durée et relis le résultat.

| Agent | Demande | Ce qui doit se passer |
|---|---|---|
| SEO | Audit SEO complet du catalogue | Un livrable « Audit SEO du catalogue », score 20/100 au départ |
| SEO | Rapport SEO à partir de la Search Console | Un livrable « Rapport SEO » ; les chiffres cités dans le texte sont ceux des tuiles (753 clics, 51 830 impressions, 1,5 %, 12,7) ; il dit que ce sont des données de démonstration |
| SEO | Optimise les balises des 3 produits prioritaires | Des propositions à valider, titles de 60 caractères au plus |
| Webmaster | Réécris la fiche de l'huile de nigelle | Une proposition avant / après ; il signale ce qu'il ne sait pas (origine) au lieu de l'inventer |
| Webmaster | Baisse de 15 % les prix des Huiles, arrondis à ,90 | Nigelle 14,90 → 12,90 € et argan 16,90 → 13,90 € : ces prix sont calculés par l'outil, l'agent doit les reprendre tels quels |
| Webmaster | Code promo BIENVENUE10 | Le code avec ses conditions (10 %, dès 30 €, une fois par client) |
| Webmaster | Barre défilante livraison offerte dès 49 € | Une barre avec ce seul message, sans offre inventée |
| Emailing | Séquence de bienvenue de 3 emails | Trois emails avec aperçu ; un code promo n'est cité que s'il a été validé avant |
| Réseaux & Vidéo | Script TikTok pour le miel de sidr | Un script plan par plan, sans vertu santé |
| Réseaux & Vidéo | Vidéo avec présentatrice IA | Un script avec le bloc « Présentateur généré par IA » ; il dit qu'il ne génère pas la vidéo |

Valide ensuite quelques propositions et regarde « Aperçu du site » : la barre défile, les prix sont barrés, le code est actif.

Ce qu'il faut juger en plus du bon fonctionnement :
- **La durée** d'une demande. Au-delà d'une minute, c'est long pour une démo en direct.
- **La qualité des textes.** C'est le métier de l'utilisatrice : montre-lui deux ou trois résultats et demande-lui ce qu'elle veut changer.
- **Le respect des règles** : rien d'inventé, pas d'allégation santé, le contenu passe par les outils et pas dans le chat.

## Si ça casse au premier appel

L'erreur s'affiche en rouge dans le chat, et le détail dans le terminal où tourne `npm run dev`.

| Symptôme | Cause probable | Où regarder |
|---|---|---|
| « La clé API Claude est refusée » | Mauvaise clé, ou jeton de connexion pris pour une clé | `saas/.env.local` |
| « L'API Claude a refusé la requête : … » | Un paramètre de la requête n'est pas accepté | `lib/server/run-agent.ts`, l'appel `createStream`. Le message nomme le paramètre. Candidats : `cache_control`, `fallbacks` avec son en-tête bêta, `eager_input_streaming` sur les outils, `output_config.effort` |
| « Modèle introuvable » ou accès refusé | La clé n'a pas accès au modèle par défaut | Variable `CLAUDE_MODEL` dans `.env.local` |
| Crédit insuffisant | Le message de l'API le dit | Console Anthropic, facturation |
| L'agent écrit tout dans le chat et ne crée pas de livrable | Les consignes ne le poussent pas assez vers les outils | `lib/server/prompts.ts`, section « Ta façon de travailler » |
| Étiquette « Entrée invalide, nouvel essai » qui se répète | Le modèle remplit mal un outil | Le schéma de cet outil dans `lib/server/tools.ts` |
| Réponses trop lentes | Effort de réflexion | `CLAUDE_EFFORT=low` est déjà la valeur par défaut ; sinon réduire la demande (moins de produits à la fois) |

À savoir sur la requête :
- Le modèle par défaut est `claude-opus-5-5`, effort `low`. Ne pas envoyer `temperature`, `top_p`, `top_k`, `tool_choice` forcé ni `thinking` désactivé : ce modèle les refuse.
- Si la première requête est refusée avec le repli automatique (`fallbacks`), la boucle réessaie une fois sans lui. `CLAUDE_FALLBACKS=off` le coupe.
- Le SDK (`@anthropic-ai/sdk` 1.8) envoie la clé en `Authorization: Bearer`.
- L'historique est renvoyé en texte simple d'un tour à l'autre ; les blocs de réflexion ne sont repassés qu'à l'intérieur d'un même tour.

Après chaque correction : `npm test`, `npm run typecheck`, puis un commit et un push sur la branche.

## Plan de secours pour ce soir

Si le vrai Claude ne marche pas à temps : lancer sans clé (ou avec `DEMO_MODE=1`). Le mode démo fonctionne de bout en bout avec des scénarios préenregistrés. Le bandeau jaune le dit à l'écran, et l'utilisatrice doit le dire aussi à son public.

Le déroulé de la démo, écran par écran, est dans `saas/DEMO.md`.

## Ce qui existe

- **Agent Webmaster** : fiches produits, pages, prix en masse à partir d'une règle, codes promo, barre d'annonce fixe ou défilante.
- **Agent SEO** : audit du catalogue, audit d'une page publique, rapport à partir des données Search Console, balises title et meta, articles.
- **Agent Emailing** : emails et séquences avec aperçu, second objet à tester.
- **Agent Réseaux & Vidéo** : scripts de vidéos courtes (avec ou sans présentateur IA), posts, calendrier.
- **Validation** : tout changement sur la boutique (fiche, prix, code, barre) est une proposition, appliquée seulement au clic sur « Valider ».
- **Écrans** : tableau de bord, un chat par agent, brief de marque, catalogue, aperçu du site, Search Console (import d'un export), livrables.
- **Brief de marque** : cible, voix, promesse, infos pratiques vérifiées, interdits. Envoyé aux quatre agents à chaque demande.
- **Méthodes des agents** : `lib/server/playbooks.ts`, en français et sans code. C'est le fichier à modifier pour changer leur façon d'écrire.
- **Chiffres** : scores SEO, prix et tableaux Search Console sont calculés par le code, jamais par le modèle.
- **Mode démo**, **code d'accès** optionnel (`ACCESS_CODE`).

## Ce qui n'existe pas (à ne pas promettre)

- **Connexion à une vraie boutique Shopify.** La boutique « Maison Nour » est fictive ; valider une proposition modifie cette boutique de démonstration, gardée dans le navigateur.
- **Connexion directe à Google Search Console.** Les données entrent par import du fichier ZIP exporté. La connexion directe demande des identifiants Google (application à déclarer dans Google Cloud) et des comptes clients.
- **Génération de vidéo.** L'agent écrit le script, la voix off et le brief du présentateur IA. Brancher un outil vidéo demande son nom et sa clé : l'utilisatrice ne les a pas encore donnés.
- **Envoi d'emails, publication sur les réseaux.** Les livrables se copient.
- **Comptes clients et paiement.**

## Ce qui a été vérifié, et comment

- `npm test` : 30 tests passent (outils, règles de prix, codes promo, audit, import Search Console, garde-fous réseau, boucle d'agent).
- `tests/sdk-integration.test.ts` : le vrai SDK et la vraie boucle contre `tests/fake-claude.ts`, un faux serveur qui parle le protocole de streaming de l'API. Vérifie la requête envoyée et la lecture du flux, pas la qualité du modèle.
- `npm run typecheck` et `npm run build` passent.
- Deux parcours joués dans un navigateur (scripts dans `tests/e2e/`, mode d'emploi en tête de chaque fichier) : le mode démo complet, et le chemin hors démo contre le faux serveur (code d'accès, quatre agents, bouton Stop, clé refusée).

**Jamais vérifié** : un appel à la vraie API. Donc ni l'acceptation de la requête, ni la qualité des textes, ni la durée d'un tour.

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `app/api/chat/route.ts` | Reçoit une demande, valide les données, renvoie le flux d'événements |
| `lib/server/run-agent.ts` | La boucle de l'agent : appel à Claude, outils, messages d'erreur |
| `lib/server/tools.ts` | Tous les outils, leur validation, la liste par agent |
| `lib/server/playbooks.ts` | La méthode de chaque agent et les règles d'écriture |
| `lib/server/prompts.ts` | Assemble mission, brief de marque, méthode et interdits |
| `lib/server/mock-agent.ts` | Les scénarios du mode démo |
| `lib/server/seo-page.ts` | Audit d'une page publique, blocage des adresses internes |
| `lib/audit.ts`, `lib/search.ts` | Calculs : scores SEO, lecture et analyse d'un export Search Console |
| `lib/store-changes.ts` | Application d'un changement validé à la boutique |
| `lib/demo-store.ts` | La boutique de démonstration, son brief et ses chiffres d'exemple |
| `lib/client/state.tsx` | L'état côté navigateur (sauvegardé dans le navigateur) |
| `components/` | Les écrans |
| `lib/config.ts` | Le nom du produit (« Wakil », provisoire) |

Le détail est dans `saas/README.md`.

## Décisions qui attendent l'utilisatrice

- Fusionner ou non la pull request (utile seulement pour Vercel).
- Quel outil de génération vidéo brancher.
- Le nom définitif du produit.
- Ses corrections sur les méthodes des agents (`lib/server/playbooks.ts`) : c'est son métier, elle a été invitée à les relire.

## Règles à tenir

- La clé API ne quitte pas l'ordinateur : ni commit, ni message, ni affichage.
- Pas de fusion ni de push sur `gh-pages` sans demande explicite.
- Dire ce qui est vérifié et ce qui ne l'est pas. Ne jamais présenter le mode démo comme de vraies réponses.
- Les chiffres montrés au client restent calculés par le code.
- Pas de nouvelle fonction avant que le test avec le vrai Claude soit passé.
