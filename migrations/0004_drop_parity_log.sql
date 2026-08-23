-- 0004_drop_parity_log.sql — retire la table parity_log (T55 abandonnée).
--
-- Décision propriétaire du 23/08 (soir) : le moat FrancePassoire est la
-- fiabilité, l'UX et la notification par email — pas la fraîcheur de
-- détection. La mesure de parité temporelle entre couches sources perd sa
-- raison d'être ; la table créée en 0003 est retirée. La migration 0003
-- n'existe plus dans l'arbre (rien n'a été commité) : IF EXISTS garantit
-- l'idempotence sur toute base.
DROP TABLE IF EXISTS parity_log;
