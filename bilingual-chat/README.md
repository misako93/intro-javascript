# Tarjem — Chat bilingue en temps réel

Messagerie type WhatsApp où chacun écrit (ou parle) dans sa langue : l'interlocuteur voit le message original **et** sa traduction instantanée. Les vocaux sont transcrits (Whisper) puis traduits (Claude ou GPT-4o-mini).

**Stack :** Next.js 16 (App Router) · Tailwind CSS 4 · Supabase (Auth Magic Link/Google, Postgres, Realtime, Storage) · OpenAI Whisper · Claude / GPT-4o-mini

---

## 🚀 Mise en route (≈ 15 minutes)

### 1. Créer la base Supabase

1. Créez un projet gratuit sur [supabase.com](https://supabase.com).
2. **SQL Editor → New query** : collez le contenu de [`supabase/schema.sql`](supabase/schema.sql) puis **Run**.
   (Crée les tables, la sécurité RLS, le temps réel et le stockage des vocaux.)
3. **Project Settings → API** : notez `Project URL` et la clé `anon public`.

### 2. Récupérer les clés IA

| Clé | Où | Obligatoire ? |
|---|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Oui** (vocaux Whisper + traduction de secours) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Non — si présente, Claude traduit (meilleur sur les dialectes arabes) |

### 3. Déployer sur Vercel (2 clics)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmisako93%2Fintro-javascript&root-directory=bilingual-chat&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,OPENAI_API_KEY,ANTHROPIC_API_KEY&envDescription=Cl%C3%A9s%20Supabase%20et%20IA%20(voir%20README))

1. Cliquez le bouton ci-dessus → collez vos 4 clés → **Deploy**.
   (Si vous importez le dépôt à la main : **Root Directory = `bilingual-chat`**.)
2. Une fois en ligne, dans **Supabase → Authentication → URL Configuration** :
   - **Site URL** : `https://votre-app.vercel.app`
   - **Redirect URLs** : ajoutez `https://votre-app.vercel.app/**` (et `http://localhost:3000/**` pour le dev)

C'est prêt. 🎉

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
│   ├── chat/[id]/page.tsx       # Écran de conversation
│   └── api/
│       ├── translate/route.ts   # Envoi d'un message texte + traduction (ou retraduction)
│       └── transcribe/route.ts  # Upload du vocal + transcription Whisper + traduction
├── components/
│   ├── ChatRoom.tsx             # Temps réel, sélecteur de langues, envoi
│   ├── MessageBubble.tsx        # Bulle : texte/lecteur audio + traduction + 🔊
│   ├── Composer.tsx             # Champ texte + bouton micro (MediaRecorder)
│   ├── InviteButton.tsx         # Partage WhatsApp / SMS / copie du lien
│   ├── NewRoomForm.tsx · LanguageSelect.tsx · LoginForm.tsx
└── lib/
    ├── ai/transcribe.ts         # Appel Whisper
    ├── ai/translate.ts          # Traduction contextuelle (Claude ou GPT-4o-mini)
    ├── messages.ts              # Quelles langues traduire + enregistrement
    ├── languages.ts             # 26 langues dont 8 dialectes arabes
    └── supabase/{client,server,proxy}.ts
```

## 🧠 Fonctionnement

- **Ma langue** = la langue que je parle et dans laquelle je lis les messages reçus.
  **Langue de traduction** = la langue dans laquelle mes messages sont traduits (pré-réglée sur celle de l'interlocuteur).
- Envoi → le message original apparaît instantanément chez les deux participants (Supabase Realtime) ; la traduction arrive ~1 s après, dans la même bulle.
- Vocal → upload dans un bucket **privé** → transcription Whisper → traduction. Le lecteur audio reste disponible.
- La traduction tient compte des 6 derniers messages (genre, pronoms, argot).
- Si une traduction n'arrive pas, l'app la redemande automatiquement ; un bouton « Réessayer » apparaît en dernier recours.
- Sécurité : chaque table est protégée par RLS — seuls les 2 membres d'un salon peuvent lire ses messages et écouter ses vocaux. Les clés IA restent côté serveur.

## 💶 Coûts indicatifs

Supabase et Vercel : gratuits pour démarrer. Whisper : ~0,006 $ / minute d'audio. GPT-4o-mini : quelques centimes pour des milliers de messages. Claude : vérifiez la grille tarifaire du modèle choisi sur anthropic.com.
