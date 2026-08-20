# Fixture `recherche-alaxione.json`

Enregistrement **réel et intégral** (aucune retouche) de la réponse de l'API
gouvernementale, capturé une seule fois pendant le développement de la tâche 11 :

- URL : `https://recherche-entreprises.api.gouv.fr/search?q=alaxione`
- Date de capture : 2026-08-20 (heure locale Europe/Paris)
- Statut HTTP : 200
- 3 résultats : ALAXIONE (811197557), ALAXION (414648741),
  ALAXION CONSULTANTS EUROPE (504392861)

L'API ne renvoie pas de score de pertinence : le champ `score` mappé par
`resolveSiren` est calculé localement par `similarity()` du même module.
