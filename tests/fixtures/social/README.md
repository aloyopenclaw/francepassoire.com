# Cassettes sociales (T39+T40)

Paires requête/réponse écrites À LA MAIN d'après les formes d'API réelles
documentées dans `docs/social-setup.md` (pages officielles citées en bas de
ce document). Aucune cassette n'est un enregistrement live : les workers ne
touchent JAMAIS le réseau dans les tests — le `fetchFn` injecté rejoue la
réponse et vérifie que la requête sortante correspond exactement à la forme
enregistrée (URL, méthode, en-têtes, corps JSON).

| Fichier | Appel | Usage |
|---------|-------|-------|
| `x-post-create-201.json` | `POST https://api.x.com/2/tweets` | X : envoi réussi (201 + `data.id`) |
| `x-post-create-401.json` | `POST https://api.x.com/2/tweets` | X : token utilisateur invalide → lettre morte immédiate |
| `x-post-create-500.json` | `POST https://api.x.com/2/tweets` | X : erreur plateforme → retry au cron suivant |
| `linkedin-ugcposts-201.json` | `POST https://api.linkedin.com/v2/ugcPosts` | LinkedIn : UGC post publié (201 + URN) |

Sources des formes (vérifiées 2026-08-20, cf. docs/social-setup.md) :
- X : https://docs.x.com/x-api/posts/create-post (scopes, corps `{text}`, réponse `{data:{id,text}}`)
- LinkedIn : https://learn.microsoft.com/en-us/linkedin/shared/sharing/ugc-post (corps shareContent + media ARTICLE)
