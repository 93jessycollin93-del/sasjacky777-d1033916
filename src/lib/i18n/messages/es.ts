/**
 * Spanish.
 *
 * `one`, `many` and `other`. The `many` category is the one people leave out:
 * CLDR added it for exact millions because Spanish genuinely changes there —
 * "un millón DE registros", not "un millón registros". The audit caught it
 * missing from this file, which is the whole reason the audit exists; nobody
 * reviewing six languages by eye would have.
 *
 * Text runs ~20% longer than English. "Back up & sync" becomes "Copia de
 * seguridad y sincronización", which is the string most likely to break a
 * button.
 */
import type { en } from "./en";

export const es: Partial<Record<keyof typeof en, string>> = {
  "workstation.title": "Estación de trabajo",
  "workstation.subtitle":
    "{live, plural, =0 {Ninguna estación ha respondido todavía} one {# de {total} estaciones comprobables ha respondido} many {# de {total} estaciones comprobables han respondido} other {# de {total} estaciones comprobables han respondido}}",
  "workstation.next": "Siguiente paso",
  "workstation.check": "Comprobar",
  "workstation.online": "en línea · sincronización disponible",
  "workstation.offline": "sin conexión · plenamente operativo",

  "stage.ignition": "Arranque",
  "stage.core": "Núcleo",
  "stage.workstation": "Estación",
  "stage.field": "Campo",
  "stage.ready": "listo",
  "stage.blocked": "bloqueado",
  "stage.pending": "pendiente",

  "station.required": "obligatorio",
  "station.open": "Abrir",
  "station.offlineFull": "funciona sin conexión",
  "station.offlineSync": "funciona sin conexión y sincroniza cuando puede",
  "station.offlineNone": "necesita red",
  "state.live": "activa",
  "state.declared": "declarada",
  "state.absent": "no responde",
  "state.unknown": "comprobando",

  "partitions.title": "Particiones sin conexión",
  "partitions.budget": "{granted} concedidos, {needed} necesarios para todos los mínimos, {spare} libres.",
  "partitions.noQuota": "Cuota de almacenamiento no disponible: {reason}",
  "partitions.reading": "Leyendo la cuota de almacenamiento del dispositivo…",
  "partitions.backupNote":
    "Las copias se guardan junto a los registros que copian, así que restaurar no necesita red.",
  "partitions.durable": "protegida frente a desalojo",
  "partitions.evictable": "puede ser desalojada",
  "partitions.sync": "Copiar y sincronizar",
  "partitions.belowFloor":
    "Por debajo de su mínimo: en este dispositivo la partición no puede cumplir su función.",
  "partitions.records":
    "{count, plural, =0 {sin registros} one {# registro} many {# de registros} other {# registros}}",
  "partitions.backups":
    "{count, plural, =0 {sin copias} one {# copia} many {# de copias} other {# copias}} de {depth}",

  "squads.title": "Escuadras",
  "squads.intro":
    "Enrutadores agrupados en unidades con un titular y apoyo. Cada unidad planifica una vez a partir de una única observación compartida y mantiene esa ruta mientras se cumpla una lista breve de condiciones.",
  "squads.operational": "operativa",
  "squads.grounded": "sin ruta",
  "squads.lookAgain": "Volver a mirar",
  "squads.efficiency":
    "{units} de {total} unidades operativas · {looks, plural, one {# observación} many {# de observaciones} other {# observaciones}} han resuelto {questions, plural, one {# consulta} many {# de consultas} other {# consultas}} ({held}% mantenidas)",
  "squads.replanned":
    "{count, plural, =0 {nada replanificado} one {# enrutador replanificado} many {# de enrutadores replanificados} other {# enrutadores replanificados}} en esta pasada",
  "squads.held": "mantenida",
  "squads.rePlanned": "replanificada",
  "squads.noPath": "sin ruta",
  "squads.watching": "vigilando",

  "routers.title": "Enrutadores de contexto de micro-IA",
  "routers.intro":
    "Cada enrutador une un modelo pequeño con las particiones en las que es experto y responde desde el motor más cercano que alcance.",
  "routers.ask": "Pregunta a un enrutador: se elige solo según lo que preguntes",
  "routers.askButton": "Preguntar",
  "routers.nothingReady":
    "No hay nada local listo para responder. Arranca Ollama, o levanta una red para los enrutadores que tienen permiso de usarla.",
  "routers.context": "contexto",

  "crew.title": "Equipo",
  "crew.intro":
    "Un especialista por área en lugar de una herramienta estirada para todo. Ahora mismo arrancarían {ready} de {total} en esta máquina.",
  "crew.ready": "listo",
  "crew.blocked": "bloqueado",
  "crew.needs": "necesita {capabilities}",

  "locale.title": "Idioma",
  "locale.change": "Cambiar idioma",

  "common.retry": "Reintentar",
  "common.close": "Cerrar",
  "common.copied": "Copiado",
  "common.lastChecked": "última comprobación {when}",
};
