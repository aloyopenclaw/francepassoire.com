// workers/email-probe/src/index.ts — sonde pré-vol send_email (T29, Wave 4).
//
// Discipline identique aux autres workers : interfaces structurelles
// minimales (pas de dépendance @cloudflare/workers-types), donc le fichier
// passe `tsc --noEmit` du dépôt et reste lisible comme documentation.
//
// Protocole de la sonde (docs/email-infra.md § Pré-vol) :
//   1. le déploiement de wrangler.jsonc (destination_address non vérifiée)
//      est la première moitié du test ;
//   2. ce handler est la seconde moitié : GET / déclenche UN envoi de test
//      via le binding et retourne le verdict brut (succès OU message
//      d'erreur exact du runtime — les deux sont des résultats valides,
//      aucun n'est masqué).
//
// CONSTAT DÉJÀ ÉTABLI PAR LA SONDE (premier déploiement, 2026-08-20) : la
// classe globale EmailMessage de l'API classique n'existe PLUS au runtime
// (ReferenceError: EmailMessage is not defined, erreur 1101, log tail wrangler).
// Le binding 2026 prend un objet message simple {from, to, subject, text} —
// c'est cette forme, documentée Email Service, que la sonde utilise.

interface MessageEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

interface SendEmailBinding {
  send(message: MessageEmail): Promise<unknown>;
}

export interface Env {
  SEND_EMAIL: SendEmailBinding;
}

// Adresse unique câblée dans wrangler.jsonc (destination_address) : le
// binding n'est censé pouvoir envoyer QUE vers elle.
const DESTINATION = 'contact@francepassoire.com';
const EMETTEUR = 'contact@francepassoire.com';

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const envoyeA = new Date().toISOString();
    const message: MessageEmail = {
      from: EMETTEUR,
      to: DESTINATION,
      subject: '[sonde-pre-vol] test binding send_email',
      text:
        `Sonde pré-vol T29 — envoyée à ${envoyeA}. ` +
        `Si vous lisez ce message, le chemin Worker -> binding send_email -> ` +
        `Email Routing -> destination fonctionne.`,
    };

    try {
      await env.SEND_EMAIL.send(message);
      return Response.json({
        ok: true,
        phase: 'runtime.send',
        destination: DESTINATION,
        envoyeA,
        constat:
          'binding.send(message objet) accepté — voir docs/email-infra.md pour la suite du chemin (règle de transfert)',
      });
    } catch (erreur) {
      const detail = erreur instanceof Error ? erreur.message : String(erreur);
      return Response.json(
        {
          ok: false,
          phase: 'runtime.send',
          destination: DESTINATION,
          envoyeA,
          constat:
            'binding.send refusé au runtime — message exact conservé tel quel (preuve brute)',
          erreur: detail,
        },
        { status: 502 },
      );
    }
  },
};
