/**
 * French.
 *
 * The trap here is that 0 is `one` in French, not `other`: "0 station" takes
 * the singular. A developer testing with English intuition writes the zero case
 * into `other` and it reads wrong to every French speaker. The `=0` forms below
 * sidestep it where the sentence deserves its own wording, and the `one` form
 * carries it where it does not.
 *
 * French also has a `many` category, for exact millions, and it changes the
 * sentence: "un million d'enregistrements", not "un million enregistrements".
 * The audit caught these missing — reviewing six languages by eye would not
 * have.
 *
 * Text runs ~20% longer than English, and French adds a thin space before `:`,
 * `?` and `!` — which is in these strings, not something a component appends.
 */
import type { en } from "./en";

export const fr: Partial<Record<keyof typeof en, string>> = {
  "workstation.title": "Poste de travail",
  "workstation.subtitle":
    "{live, plural, =0 {Aucune station n'a encore répondu} one {# station sur {total} vérifiables a répondu} many {# de stations sur {total} vérifiables ont répondu} other {# stations sur {total} vérifiables ont répondu}}",
  "workstation.next": "Étape suivante",
  "workstation.check": "Vérifier",
  "workstation.online": "en ligne · synchronisation possible",
  "workstation.offline": "hors ligne · pleinement opérationnel",

  "stage.ignition": "Amorçage",
  "stage.core": "Cœur",
  "stage.workstation": "Poste",
  "stage.field": "Terrain",
  "stage.ready": "prêt",
  "stage.blocked": "bloqué",
  "stage.pending": "en attente",

  "station.required": "requis",
  "station.open": "Ouvrir",
  "station.offlineFull": "fonctionne hors ligne",
  "station.offlineSync": "fonctionne hors ligne, se synchronise quand elle peut",
  "station.offlineNone": "nécessite un réseau",
  "state.live": "active",
  "state.declared": "déclarée",
  "state.absent": "sans réponse",
  "state.unknown": "vérification",

  "partitions.title": "Partitions hors ligne",
  "partitions.budget": "{granted} accordés, {needed} nécessaires pour tous les seuils, {spare} disponibles.",
  "partitions.noQuota": "Quota de stockage indisponible : {reason}",
  "partitions.reading": "Lecture du quota de stockage de l'appareil…",
  "partitions.backupNote":
    "Les sauvegardes sont rangées à côté des enregistrements qu'elles copient : restaurer ne demande aucun réseau.",
  "partitions.durable": "protégée contre l'éviction",
  "partitions.evictable": "susceptible d'être évincée",
  "partitions.sync": "Sauvegarder et synchroniser",
  "partitions.belowFloor":
    "Sous son seuil : sur cet appareil, cette partition ne peut pas remplir son rôle.",
  "partitions.records":
    "{count, plural, =0 {aucun enregistrement} one {# enregistrement} many {# d'enregistrements} other {# enregistrements}}",
  "partitions.backups":
    "{count, plural, =0 {aucune sauvegarde} one {# sauvegarde} many {# de sauvegardes} other {# sauvegardes}} sur {depth}",

  "squads.title": "Escouades",
  "squads.intro":
    "Des routeurs réunis en unités avec un chef de file et du soutien. Chaque unité planifie une seule fois à partir d'une observation commune, puis conserve cette route tant qu'une courte liste de conditions tient.",
  "squads.operational": "opérationnelle",
  "squads.grounded": "sans route",
  "squads.lookAgain": "Réobserver",
  "squads.efficiency":
    "{units} unités opérationnelles sur {total} · {looks, plural, one {# observation} many {# d'observations} other {# observations}} ont traité {questions, plural, one {# question} many {# de questions} other {# questions}} ({held}% conservées)",
  "squads.replanned":
    "{count, plural, =0 {aucune replanification} one {# routeur replanifié} many {# de routeurs replanifiés} other {# routeurs replanifiés}} lors de ce passage",
  "squads.held": "conservée",
  "squads.rePlanned": "replanifiée",
  "squads.noPath": "sans route",
  "squads.watching": "sous surveillance",

  "routers.title": "Routeurs de contexte micro-IA",
  "routers.intro":
    "Chaque routeur associe un petit modèle aux partitions qu'il maîtrise et répond depuis le moteur le plus proche qu'il puisse atteindre.",
  "routers.ask": "Posez une question : le routeur se désigne lui-même d'après ce que vous demandez",
  "routers.askButton": "Demander",
  "routers.nothingReady":
    "Rien de local n'est prêt à répondre. Lancez Ollama, ou établissez un réseau pour les routeurs qui ont le droit d'en utiliser un.",
  "routers.context": "contexte",

  "crew.title": "Équipe",
  "crew.intro":
    "Un spécialiste par domaine plutôt qu'un seul outil étiré sur tout. En l'état, {ready} sur {total} démarreraient sur cette machine.",
  "crew.ready": "prêt",
  "crew.blocked": "bloqué",
  "crew.needs": "nécessite {capabilities}",

  "locale.title": "Langue",
  "locale.change": "Changer de langue",

  "common.retry": "Réessayer",
  "common.close": "Fermer",
  "common.copied": "Copié",
  "common.lastChecked": "dernière vérification {when}",
};
