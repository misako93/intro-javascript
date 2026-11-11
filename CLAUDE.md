# Wakil — consignes pour Claude Code

Le projet en cours est dans `saas/` : le MVP d'un SaaS d'agents IA pour boutiques en ligne. Le reste du dépôt est un ancien cours JavaScript, sans rapport.

**Lis `saas/REPRISE.md` avant toute chose.** Il dit où en est le projet, ce qui a été vérifié, ce qui ne l'a pas été, et quoi faire en premier.

## Règles

- Réponds en français, en tutoyant, de façon courte. L'utilisatrice n'est pas développeuse.
- La clé API Claude reste sur l'ordinateur, dans `saas/.env.local` (ignoré par Git). Ne l'affiche pas, ne la committe pas, ne la mets dans aucun message.
- Ne fusionne pas la pull request et ne pousse rien sur `gh-pages` sans demande explicite. Travaille sur la branche `claude/claude-code-vs-n8n-6ftwem`.
- Dis ce qui est vérifié et ce qui ne l'est pas. Le mode démo rejoue des réponses préenregistrées : ne le présente jamais comme de vraies réponses.
- Les chiffres montrés au client (scores SEO, prix, données Search Console) sont calculés par le code, jamais par le modèle. Garde ce principe.
- Pas de faux témoignage, de fausse urgence ni d'allégation santé dans ce que produisent les agents.

## Commandes (dans `saas/`)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 30 tests
npm run typecheck
npm run build
```

Sans `ANTHROPIC_API_KEY`, l'application tourne en mode démo.
