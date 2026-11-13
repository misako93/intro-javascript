# Tarjem — Chat bilingue en temps réel

Messagerie type WhatsApp où chacun écrit (ou parle) dans sa langue : l'interlocuteur voit le message original **et** sa traduction instantanée. Les vocaux sont transcrits (Whisper) puis traduits (Claude ou GPT-4o-mini).

- 📱 **Application mobile installable** (Android + iPhone) avec notifications push — sans passer par les stores.
- 💳 **Un seul abonnement par conversation** : si l'un des deux participants est abonné, les deux discutent en illimité.
- 🏨 **Mode hôtel** : une affiche QR à l'accueil (+ un QR par chambre en option). Le client scanne, écrit dans sa langue **sans créer de compte**, et **toute l'équipe** de réception reçoit le message traduit sur son téléphone, avec alerte sonore.
- 🧠 **Détection de langue** : si le client écrit déjà dans la langue du réceptionniste, le message s'affiche tel quel, sans appel à l'IA.

**Stack :** Next.js 16 (App Router) · Tailwind CSS 4 · Supabase (Auth Magic Link/Google, Postgres, Realtime, Storage) · OpenAI Whisper · Claude / GPT-4o-mini · Stripe · Web Push

---

## 🚀 Mise en route (≈ 15 minutes)

### 1. Créer la base Supabase

1. Créez un projet gratuit sur [supabase.com](https://supabase.com).
2. **SQL Editor → New query** : collez le contenu de [`supabase/schema.sql`](supabase/schema.sql) puis **Run**.
   (Crée les tables, la sécurité RLS, le temps réel et le stockage des vocaux.)
3. **Project Settings → API** : notez `Project URL`, la clé `anon public` et la clé `service_role` (secrète).

> Vous mettez à jour une installation existante ? Ré-exécutez simplement `schema.sql` : il est ré-exécutable sans risque.

### 2. Récupérer les clés IA

| Clé | Où | Obligatoire ? |
|---|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Oui** (vocaux Whisper + traduction de secours) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Non — si présente, Claude traduit (meilleur sur les dialectes arabes) |

### 3. Déployer sur Vercel (2 clics)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmisako93%2Fintro-javascript&root-directory=bilingual-chat&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,OPENAI_API_KEY,ANTHROPIC_API_KEY&envDescription=Cl%C3%A9s%20Supabase%20et%20IA%20(voir%20README))

1. Cliquez le bouton ci-dessus → collez vos clés → **Deploy**.
   (Si vous importez le dépôt à la main : **Root Directory = `bilingual-chat`**.)
2. Une fois en ligne, dans **Supabase → Authentication → URL Configuration** :
   - **Site URL** : `https://votre-app.vercel.app`
   - **Redirect URLs** : ajoutez `https://votre-app.vercel.app/**` (et `http://localhost:3000/**` pour le dev)

C'est prêt. 🎉 Sans Stripe configuré, l'app est entièrement gratuite (pas de paywall). Ajoutez les sections 4 et 5 quand vous êtes prêt·e.

### 4. Activer les abonnements (Stripe)

1. Sur [dashboard.stripe.com](https://dashboard.stripe.com) : **Catalogue de produits → Ajouter un produit** (ex. « Tarjem Illimité », 9,99 €/mois, récurrent). Copiez l'ID du prix (`price_…`).
2. **Développeurs → Clés API** : copiez la clé secrète (`sk_live_…`).
3. **Développeurs → Webhooks → Ajouter un endpoint** :
   - URL : `https://votre-app.vercel.app/api/billing/webhook`
   - Événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copiez le « secret de signature » (`whsec_…`).
4. **Paramètres → Portail client** : activez-le (résiliation, changement de carte, factures).
5. Sur Vercel → Settings → Environment Variables : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_PRICE_LABEL` (ex. `9,99 € / mois`), `FREE_MESSAGES_PER_ROOM` (ex. `20`) → **Redeploy**.

**Règle :** chaque conversation offre `FREE_MESSAGES_PER_ROOM` messages. Ensuite, il suffit qu'**un seul** des deux participants soit abonné pour que **les deux** écrivent et envoient des vocaux en illimité. L'abonnement couvre toutes les conversations de l'abonné. L'interlocuteur voit « Conversation illimitée, offerte par … ».

Testez d'abord en mode test Stripe (clés `sk_test_…`, carte `4242 4242 4242 4242`).

### 5. Activer l'application mobile + notifications

L'app est déjà installable (PWA) : sur Android, un bouton « Installer l'application » apparaît ; sur iPhone, un encart explique « Partager → Sur l'écran d'accueil ». Pour les **notifications** des nouveaux messages :

```bash
npx web-push generate-vapid-keys
```
Ajoutez sur Vercel : `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Public Key), `VAPID_PRIVATE_KEY` (Private Key), `VAPID_SUBJECT` (`mailto:votre@email.com`) → **Redeploy**.

La notification affiche le message **déjà traduit** dans la langue du destinataire.

**Pour la réception de l'hôtel :**
- 🛎️ « Nouvelle conversation » dès qu'un client ouvre le lien d'invitation : la notification **reste affichée** jusqu'à ce qu'on la touche (triple vibration).
- 💬 Chaque nouveau message **sonne et vibre** (son de notification du téléphone), même app fermée ou écran verrouillé.
- 🔔 App ouverte : un carillon retentit et le tableau de bord se met à jour en direct. Pas de double alerte si la conversation est déjà affichée à l'écran.
- Le son exact dépend du téléphone (Android : Paramètres → Notifications → nom de l'app → Son ; iPhone : son de notification système). Le mode silencieux / « Ne pas déranger » du téléphone reste prioritaire.

| | Android | iPhone |
|---|---|---|
| Installation | Bouton « Installer » (Chrome) | Safari → Partager → « Sur l'écran d'accueil » |
| Notifications | ✅ | ✅ iOS 16.4+, une fois l'app ajoutée à l'écran d'accueil |
| Micro / vocaux | ✅ | ✅ |

### En local

```bash
cd bilingual-chat
cp .env.example .env.local   # puis remplissez les valeurs
npm install
npm run dev                  # → http://localhost:3000
```

---

## ⚙️ Options

**Connexion Google** — Supabase → Authentication → Providers → Google (client ID/secret Google Cloud), puis `NEXT_PUBLIC_GOOGLE_AUTH=true` sur Vercel.

**Lien magique ouvert sur un autre appareil** — Par défaut, le lien doit être ouvert dans le même navigateur que celui où l'e-mail a été demandé. Pour que ça marche partout (ex. demandé sur PC, ouvert sur téléphone), dans Supabase → Authentication → Email Templates → *Magic Link*, remplacez le lien par :
```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Me connecter</a>
```

**E-mails en production** — Le serveur e-mail intégré de Supabase est limité (quelques e-mails/heure). Branchez un SMTP (Resend, Brevo…) dans Authentication → SMTP Settings avant d'avoir de vrais utilisateurs.

**Choix du traducteur** — `TRANSLATION_PROVIDER=anthropic|openai`, `ANTHROPIC_MODEL` (défaut `claude-haiku-5-5`), `OPENAI_TRANSLATION_MODEL` (défaut `gpt-4o-mini`).

### 6. Activer le mode hôtel

1. **Supabase → Authentication → Sign In / Providers → « Allow anonymous sign-ins » : ON.** C'est ce qui permet au client de l'hôtel d'écrire sans e-mail ni compte. (Recommandé ensuite : activer le CAPTCHA Turnstile dans Authentication → Attack Protection pour limiter les abus.)
2. Ré-exécutez `supabase/schema.sql` (sans risque).
3. Dans l'app : tableau de bord → **« Vous êtes un hôtel ? »** → nom de l'hôtel + langue de la réception.
4. Sur la page **Mon hôtel** :
   - **Imprimer l'affiche** de l'accueil (A4, phrase d'accroche en 8 langues) ;
   - ajouter des chambres (`101-120, 201-220, Suite Royale`) puis **imprimer la planche de QR** à découper ;
   - **ajouter des réceptionnistes** en leur envoyant le lien d'équipe (WhatsApp / copier).
5. Chaque réceptionniste installe l'app sur son téléphone et active les notifications.

**Parcours du client :** il scanne → la page s'ouvre **directement dans la langue de son téléphone**, dès le premier affichage. Les 26 langues de l'application ont leur interface (arabe avec le dialecte du pays : Qatar/Koweït → arabe du Golfe, Égypte → égyptien… ; persan, ourdou, bengali, malais, tagalog, swahili, chinois, russe…). Langue du téléphone non prise en charge → anglais. → il écrit ou envoie un vocal → la réception reçoit « 🛎️ Nouveau client — Ahmed · Ch. 204 » traduit en français. S'il rescanne, il retrouve sa conversation. Il n'a jamais rien à payer et ne voit jamais d'écran d'abonnement.

> 🇫🇷 **Pendant le développement, l'écran du client est en français** (`NEXT_PUBLIC_GUEST_UI_LANGUAGE=fr`, valeur par défaut). Au lancement, passez-le à `auto` pour l'afficher dans la langue du téléphone du client. Dans les deux cas, la langue du client est pré-sélectionnée et ses messages sont traduits.

**Équipe :** tous les réceptionnistes voient toutes les conversations de l'hôtel et peuvent répondre. Un message de client sonne chez toute l'équipe ; une réponse de la réception n'est envoyée qu'au client. Le responsable peut retirer un membre : il perd l'accès immédiatement.

**Abonnement :** pour un hôtel, l'abonnement du responsable couvre toute l'équipe et tous les clients ; l'essai gratuit est de `FREE_MESSAGES_PER_HOTEL` messages (200 par défaut) pour l'ensemble de l'hôtel.

---

## 📲 Et les App Store / Play Store ?

Possible plus tard (en enveloppant l'app avec Capacitor), mais à faire **quand le produit a trouvé ses clients**, pour 3 raisons :
1. Apple et Google imposent leur propre système de paiement pour les abonnements vendus dans l'app (15 à 30 % de commission, code à part, par ex. avec RevenueCat).
2. Apple refuse souvent les apps qui ne sont « qu'un site dans une coque » : il faudra des fonctions natives (notifications natives, contacts…).
3. Comptes développeur : 99 $/an (Apple) + 25 $ (Google), et des délais de validation à chaque mise à jour.

La version PWA permet de vendre via Stripe (~3 à 5 % de frais au total) et de mettre à jour l'app instantanément.

---

## 🗂️ Arborescence

```
bilingual-chat/
├── .env.example                 # Modèle des variables d'environnement
├── proxy.ts                     # Rafraîchit la session + protège /dashboard et /chat (ex-middleware)
├── supabase/schema.sql          # Tables, RLS, fonctions RPC, Realtime, bucket des vocaux
├── app/
│   ├── layout.tsx · globals.css · manifest.ts (installable sur mobile)
│   ├── login/page.tsx           # Connexion par lien magique / Google
│   ├── auth/callback/route.ts   # Retour du lien magique (code PKCE ou token_hash)
│   ├── auth/signout/route.ts
│   ├── dashboard/page.tsx       # Liste des conversations
│   ├── dashboard/actions.ts     # Création d'un salon (Server Action)
│   ├── invite/[token]/page.tsx  # Lien d'invitation → inscription 1 clic → salon
│   ├── chat/[id]/page.tsx       # Écran de conversation (vue classique, réception ou client d'hôtel)
│   ├── q/[token]/page.tsx       # Page ouverte par le QR code (accueil ou chambre)
│   ├── hotel/                   # Espace hôtel : QR, chambres, équipe + affiche et planche à imprimer
│   ├── staff/[token]/page.tsx   # Lien pour rejoindre l'équipe de réception
│   └── api/
│       ├── translate/route.ts   # Envoi d'un message texte + traduction (ou retraduction)
│       ├── transcribe/route.ts  # Upload du vocal + transcription Whisper + traduction
│       ├── billing/checkout/    # → page de paiement Stripe
│       ├── billing/portal/      # → espace client Stripe (factures, résiliation)
│       ├── billing/webhook/     # Stripe → table subscriptions
│       ├── billing/room/        # La conversation est-elle couverte par un abonnement ?
│       └── push/subscribe/      # Enregistre le téléphone pour les notifications
├── components/
│   ├── ChatRoom.tsx             # Temps réel, sélecteur de langues, envoi
│   ├── MessageBubble.tsx        # Bulle : texte/lecteur audio + traduction + 🔊
│   ├── Composer.tsx             # Champ texte + bouton micro (MediaRecorder)
│   ├── InviteButton.tsx         # Partage WhatsApp / SMS / copie du lien
│   ├── Billing.tsx              # Bandeau d'essai, paywall, encart « Mon abonnement »
│   ├── InstallBanner.tsx        # « Installer l'application » (Android / iPhone)
│   ├── NotificationsBanner.tsx  # Activation des notifications
│   ├── PwaSetup.tsx             # Enregistre le service worker + débloque le son
│   ├── DashboardLive.tsx        # Tableau de bord en direct (réception)
│   ├── GuestStart.tsx           # Accueil du client d'hôtel (langue, prénom, sans compte)
│   ├── I18n.tsx                 # Interface traduite pour les clients
│   ├── NewRoomForm.tsx · LanguageSelect.tsx · LoginForm.tsx
└── lib/
    ├── ai/transcribe.ts         # Appel Whisper
    ├── ai/translate.ts          # Traduction contextuelle (Claude ou GPT-4o-mini)
    ├── messages.ts              # Quelles langues traduire + enregistrement
    ├── billing.ts · stripe.ts   # Règle « un abonné suffit » + synchro Stripe
    ├── push.ts · pwa.ts         # Notifications (serveur / navigateur)
    ├── detect-language.ts       # Détection de la langue réelle d'un message
    ├── sound.ts                 # Carillon d'alerte dans l'app
    ├── languages.ts             # 26 langues dont 8 dialectes arabes
    ├── i18n.ts                  # Textes de l'interface client en 13 langues
    ├── participants.ts · hotel.ts · qr.ts
    └── supabase/{client,server,proxy,admin}.ts
public/
    ├── sw.js · offline.html     # Service worker : notifications + page hors-ligne
    └── icons/                   # Icônes Android, iPhone, maskable, badge
```

## 🧠 Fonctionnement

- **Ma langue** = la langue que je parle et dans laquelle je lis les messages reçus.
  **Langue de traduction** = la langue dans laquelle mes messages sont traduits (pré-réglée sur celle de l'interlocuteur).
- Envoi → le message original apparaît instantanément chez les deux participants (Supabase Realtime) ; la traduction arrive ~1 s après, dans la même bulle.
- Vocal → upload dans un bucket **privé** → transcription Whisper → traduction. Le lecteur audio reste disponible.
- La traduction tient compte des 6 derniers messages (genre, pronoms, argot).
- **Pas de traduction inutile** : avant d'appeler l'IA, la langue réelle du message est détectée (localement et gratuitement pour le texte avec `tinyld`, par Whisper pour les vocaux). Si elle est identique à celle du destinataire — ex. un client arabophone qui écrit en français à une réception francophone — seul l'original est affiché. Les messages sans lettres (👍, numéro de chambre) ne sont jamais traduits. Les mots très courts et ambigus (« oui », « ok ») sont rapprochés des langues de la conversation pour éviter les erreurs.
- Si une traduction n'arrive pas, l'app la redemande automatiquement ; un bouton « Réessayer » apparaît en dernier recours.
- Sécurité : chaque table est protégée par RLS — seuls les 2 membres d'un salon peuvent lire ses messages et écouter ses vocaux. Le paywall est vérifié côté serveur, et seul le webhook Stripe signé peut activer un abonnement. Les clés IA, Stripe et `service_role` restent côté serveur.

## 💶 Coûts indicatifs

Supabase et Vercel : gratuits pour démarrer. Stripe : ~1,5 % + 0,25 € par paiement (cartes européennes) + 0,7 % pour la gestion des abonnements (Stripe Billing). Whisper : ~0,006 $ / minute d'audio. GPT-4o-mini : quelques centimes pour des milliers de messages. Claude : vérifiez la grille tarifaire du modèle choisi sur anthropic.com.
