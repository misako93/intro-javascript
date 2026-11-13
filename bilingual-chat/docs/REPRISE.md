# Note de reprise — où en est le projet

> À lire en premier dans une nouvelle conversation Claude Code (sur le PC).
> Tout le code est sur la branche `claude/bilingual-chat-saas-app-3l1m16` (PR #3 sur GitHub).

## Le produit
Messagerie bilingue pour **hôtels** (nom provisoire « Tarjem ») :
- Une **affiche QR à l'accueil** (+ un QR par chambre en option). Le client scanne, choisit sa langue (pré-remplie), écrit ou envoie un vocal **sans créer de compte** (session invité Supabase).
- **Toute l'équipe de réception** reçoit le message traduit en français sur son téléphone (PWA installable + notifications push avec son).
- **Assistant IA** : répond seul aux questions présentes dans la fiche « Infos pratiques » (Wi-Fi, horaires…) sans réveiller la réception ; transmet le reste.
- **Détection de langue** : pas d'appel IA si le message est déjà dans la langue du lecteur.
- **Abonnement Stripe** pris par l'hôtel ; les clients ne paient jamais. Un seul abonné couvre toute la conversation / tout l'hôtel.
- Aussi : conversations bilingues 1-à-1 classiques (lien d'invitation).

## Stack
Next.js 16 (App Router, `proxy.ts`) · Tailwind 4 · Supabase (Postgres + RLS, Auth lien magique + invités, Realtime, Storage) · IA texte : OpenAI **ou OpenRouter** **ou** Claude (`lib/ai/llm.ts`) · vocaux : Whisper OpenAI **ou Groq** (`lib/ai/transcribe.ts`) · Stripe · Web Push (VAPID).
Schéma complet et idempotent : `supabase/schema.sql`. Variables : `.env.example`.

## Décisions prises avec la fondatrice/le fondateur
- **Interface en français** pendant le développement : `NEXT_PUBLIC_GUEST_UI_LANGUAGE=fr`. Les 19 dictionnaires (26 langues) sont prêts : passer à `auto` au lancement, après relecture par des natifs.
- **Hébergement** : l'app sur le **VPS Hostinger** (Docker + Caddy pour le HTTPS automatique), **pas Vercel** (offre gratuite non commerciale). Le site vitrine pourra aller sur l'hébergement web Hostinger existant.
- **Base de données** : rester sur **Supabase** (gratuit pendant le pilote, Pro ~25 $/mois au 1er hôtel payant). Ne PAS migrer vers MySQL Hostinger (trop de réécriture : auth, temps réel, stockage, RLS).
- **IA** : **OpenRouter** pour le texte (`OPENAI_BASE_URL=https://openrouter.ai/api/v1`, modèle `openai/gpt-4o-mini`), **Groq ou OpenAI** pour les vocaux (`TRANSCRIBE_*`).
- **App mobile** : PWA d'abord ; App Store / Google Play (Capacitor) seulement quand 3–5 hôtels paient (B2B → pas d'achat intégré, règle Apple 3.1.3(c)).
- **Prix visés** : 99 / 199 / 399 € HT par mois et par hôtel ; essai gratuit ; prix « fondateur » 99 € pour les 10 premiers.
- **Nom de domaine** : pas encore acheté. Piste préférée : « AhlanDesk » (autres : Lobbi, PolyDesk, Tarjem). Disponibilité à vérifier sur Hostinger + INPI.

## Ce qui est fait et testé (en local, sans vraies clés)
Règles de sécurité Postgres (RLS) testées avec 5 utilisateurs ; parcours client complet dans un navigateur (téléphone en arabe et en persan) ; paywall et webhook Stripe signé ; notifications push réellement chiffrées et reçues ; assistant IA (3 scénarios) avec une fausse IA ; branchement OpenRouter + Groq.
**Jamais testé avec les vrais services** (Supabase, OpenRouter, Groq, Stripe) ni sur un vrai téléphone : c'est la première chose à faire sur le PC.

## Prochaines étapes, dans l'ordre
1. **Sur le PC** : `git clone`, `git checkout claude/bilingual-chat-saas-app-3l1m16`, `cd bilingual-chat`, `npm install`, `cp .env.example .env.local`, remplir les clés **dans le fichier** (jamais dans la conversation).
2. Créer le projet Supabase (région Francfort), exécuter `supabase/schema.sql`, activer « Allow anonymous sign-ins », renseigner les URL de redirection.
3. `npm run dev` → tester : création d'hôtel, QR, conversation client (navigation privée), assistant IA (zone « Tester comme un client »), vocal.
4. **Déploiement VPS** : vérifier que c'est bien un VPS (pas un hébergement web), puis ajouter `Dockerfile` (Next `output: "standalone"`), `docker-compose.yml`, `Caddyfile`, guide pas à pas. Le nom de domaine est nécessaire pour le HTTPS (sinon tester avec l'adresse `srvXXXX.hstgr.cloud` du VPS si elle existe).
5. CAPTCHA Cloudflare Turnstile sur la page du QR (`/q/[token]`) avant la mise en production.
6. Forfaits 99/199/399 € + compteur de consommation par hôtel.
7. Page d'accueil commerciale (SEO) + pages légales (CGV, confidentialité, contrat de sous-traitance RGPD listant OpenRouter/Groq/Supabase).
8. Hôtel pilote gratuit 30 jours.

## Premier message à envoyer à Claude sur le PC
> Lis `bilingual-chat/docs/REPRISE.md` et `bilingual-chat/README.md`, puis aide-moi à faire l'étape 1 et 2 : lancer l'app en local avec mes vraies clés Supabase et OpenRouter. Ne me demande jamais de coller une clé dans la conversation.
