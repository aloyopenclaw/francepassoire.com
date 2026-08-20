# Mise en route Search Console — USER-ACTION (tâche 48)

> Document pour le propriétaire. Aucune action de votre part n'est bloquante
> pour le site lui-même ; c'est l'observabilité dans Google (indexation,
> requêtes, sitemap) qui s'active avec ces étapes. Le DNS du domaine est géré
> dans **Cloudflare** (même compte que l'hébergement Pages).

## 1. Créer la propriété (type Domaine)

1. Ouvrir <https://search.google.com/search-console> et se connecter avec le
   compte Google propriétaire.
2. « Ajouter une propriété » → choisir **Domaine** → saisir
   `francepassoire.com`.
3. Google affiche un enregistrement de vérification unique, de la forme :

   ```
   google-site-verification=TOKEN
   ```

   (remplacer `TOKEN` par la valeur exacte affichée — elle est propre à votre
   propriété.)

## 2. Publier l'enregistrement DNS TXT dans Cloudflare

1. <https://dash.cloudflare.com> → compte du domaine → zone
   `francepassoire.com` → **DNS → Records → Add record**.
2. Créer exactement :

   | Champ | Valeur |
   |---|---|
   | Type | `TXT` |
   | Name | `@` |
   | Content | `google-site-verification=TOKEN` (le TOKEN copié à l'étape 1) |
   | TTL | `Auto` |

   Les enregistrements TXT ne sont jamais proxifiés — laisser « DNS only ».

3. Enregistrer. Cloudflare est autoritaire sur la zone : la propagation est
   quasi immédiate (quelques minutes au pire).

## 3. Vérifier

1. Retour dans Search Console → bouton **Verify** sur la propriété.
   - Si « vérification échouée » : attendre 2–3 minutes et réessayer
     (cache DNS de Google).
2. Une fois vérifiée : menu **Sitemaps** → champ « Add a new sitemap » →
   saisir exactement :

   ```
   sitemap-index.xml
   ```

   → **Submit**. Statut attendu : « Success », 164 URLs découvertes.

## 4. Contrôles de la première semaine (5 min)

- **Pages / Rapport d'indexation** : les premières pages `francepassoire.com`
  apparaissent en « Indexed » sous quelques jours.
- **URL Inspection** : coller `https://francepassoire.com/` → « Request
  indexing » pour amorcer la découverte de l'accueil.
- **Enhancements** : aucun élément riche n'est attendu (Dataset/Article sont
  des types de données, pas des rich results d'affichage).
- Re-passérer l'accueil et une fiche dans le
  [Rich Results Test](https://search.google.com/test/rich-results) — le
  JSON-LD est validé structurellement côté build (voir
  `docs/seo-audit.md`), l'outil Google consomme l'URL live.

## Sécurité

- Le jeton `google-site-verification=…` n'est **pas un secret d'authentification**
  (il ne fait que prouver la maîtrise du DNS). Pas de rotation nécessaire.
- Ne jamais supprimer l'enregistrement TXT : la propriété repasserait « non
  vérifiée » aux prochains contrôles Google.
