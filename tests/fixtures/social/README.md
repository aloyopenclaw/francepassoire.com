# Cassettes sociales (T38–T40)

Paires requête/réponse écrites À LA MAIN d'après les formes d'API réelles
documentées dans `docs/social-setup.md` (pages officielles citées en bas de
ce document). Aucune cassette n'est un enregistrement live : les workers ne
touchent JAMAIS le réseau dans les tests — le `fetchFn` injecté rejoue la
réponse et vérifie que la requête sortante correspond exactement à la forme
enregistrée (URL, méthode, en-têtes, corps JSON). Le joker `<DATE_ISO>`
dans un corps épingle la FORME d'un horodatage (ISO 8601 UTC), pas sa
valeur. Nostr n'a pas de cassette : la note est signée et vérifiée en pur,
l'envoi relais passe par un WebSocket factice injecté.

| Fichier | Appel | Usage |
|---------|-------|-------|
| `x-post-create-201.json` | `POST https://api.x.com/2/tweets` | X : envoi réussi (201 + `data.id`) |
| `x-post-create-401.json` | `POST https://api.x.com/2/tweets` | X : token utilisateur invalide → lettre morte immédiate |
| `x-post-create-500.json` | `POST https://api.x.com/2/tweets` | X : erreur plateforme → retry au cron suivant |
| `linkedin-ugcposts-201.json` | `POST https://api.linkedin.com/v2/ugcPosts` | LinkedIn : UGC post publié (201 + URN) |
| `createSession-200.json` | `POST https://bsky.social/xrpc/com.atproto.server.createSession` | Bluesky : session ouverte (200 + `accessJwt` + `did`) |
| `createRecord-201.json` | `POST https://bsky.social/xrpc/com.atproto.repo.createRecord` | Bluesky : post créé (201 + `uri` at://…) |
| `createSession-401.json` | `POST https://bsky.social/xrpc/com.atproto.server.createSession` | Bluesky : identifiants morts → erreur permanente |

Sources des formes (vérifiées 2026-08-20, cf. docs/social-setup.md) :
- X : https://docs.x.com/x-api/posts/create-post (scopes, corps `{text}`, réponse `{data:{id,text}}`)
- LinkedIn : https://learn.microsoft.com/en-us/linkedin/shared/sharing/ugc-post (corps shareContent + media ARTICLE)
- Bluesky : https://atproto.com/specs/xrpc (enveloppe XRPC) + https://docs.bsky.app/docs/tutorials/creating-a-post (`createSession`, `createRecord` `app.bsky.feed.post`, embed `app.bsky.embed.external`)
