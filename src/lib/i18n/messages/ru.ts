/**
 * Russian.
 *
 * Four plural forms, and every count in this file supplies all of them.
 * `one` covers 1, 21, 31 — but not 11. `few` covers 2-4, 22-24 — but not
 * 12-14. `many` covers 0, 5-20, and every teen. `other` catches fractions.
 * A message written with only `one` and `other` renders "5 станция" instead of
 * "5 станций", which reads to a Russian speaker the way "5 station" reads in
 * English.
 */
import type { en } from "./en";

export const ru: Partial<Record<keyof typeof en, string>> = {
  "workstation.title": "Рабочая станция",
  "workstation.subtitle":
    "{live, plural, =0 {Ни одна станция ещё не ответила} one {# из {total} проверяемых станций ответила} few {# из {total} проверяемых станций ответили} many {# из {total} проверяемых станций ответили} other {# из {total} проверяемых станций ответило}}",
  "workstation.next": "Следующий шаг",
  "workstation.check": "Проверить",
  "workstation.online": "сеть есть · синхронизация доступна",
  "workstation.offline": "без сети · работает полностью",

  "stage.ignition": "Запуск",
  "stage.core": "Ядро",
  "stage.workstation": "Рабочая станция",
  "stage.field": "Поле",
  "stage.ready": "готово",
  "stage.blocked": "заблокировано",
  "stage.pending": "ожидание",

  "station.required": "обязательно",
  "station.open": "Открыть",
  "station.offlineFull": "работает без сети",
  "station.offlineSync": "без сети работает, синхронизируется при возможности",
  "station.offlineNone": "нужна сеть",
  "state.live": "на связи",
  "state.declared": "заявлено",
  "state.absent": "не отвечает",
  "state.unknown": "проверяется",

  "partitions.title": "Автономные разделы",
  "partitions.budget": "Выделено {granted}, нужно {needed} на все минимумы, свободно {spare}.",
  "partitions.noQuota": "Квота хранилища недоступна: {reason}",
  "partitions.reading": "Читаем квоту хранилища устройства…",
  "partitions.backupNote":
    "Резервные копии лежат рядом с самими записями, поэтому восстановление не требует сети.",
  "partitions.durable": "защищено от вытеснения",
  "partitions.evictable": "может быть вытеснено",
  "partitions.sync": "Копия и синхронизация",
  "partitions.belowFloor":
    "Ниже минимума — на этом устройстве раздел не сможет выполнять свою задачу.",
  "partitions.records":
    "{count, plural, =0 {ничего не сохранено} one {# запись} few {# записи} many {# записей} other {# записи}}",
  "partitions.backups":
    "{count, plural, =0 {копий нет} one {# копия} few {# копии} many {# копий} other {# копии}} из {depth}",

  "squads.title": "Отряды",
  "squads.intro":
    "Маршрутизаторы, собранные в подразделения с ведущим и поддержкой. Каждое подразделение строит план один раз по общему снимку обстановки и держит маршрут, пока выполняется короткий список условий.",
  "squads.operational": "боеготов",
  "squads.grounded": "без маршрута",
  "squads.lookAgain": "Осмотреться заново",
  "squads.efficiency":
    "{units} из {total} подразделений боеготовы · {looks, plural, one {# осмотр} few {# осмотра} many {# осмотров} other {# осмотра}} закрыл {questions, plural, one {# запрос} few {# запроса} many {# запросов} other {# запроса}} ({held}% без пересчёта)",
  "squads.replanned":
    "{count, plural, =0 {ничего не пересчитано} one {# маршрутизатор пересчитан} few {# маршрутизатора пересчитаны} many {# маршрутизаторов пересчитано} other {# маршрутизатора пересчитано}} в этом проходе",
  "squads.held": "без изменений",
  "squads.rePlanned": "пересчитан",
  "squads.noPath": "нет маршрута",
  "squads.watching": "следим за",

  "routers.title": "Контекстные маршрутизаторы микро-ИИ",
  "routers.intro":
    "Каждый маршрутизатор соединяет одну небольшую модель с разделами, в которых он разбирается, и отвечает через ближайший доступный движок.",
  "routers.ask": "Спросите маршрутизатор — он определится сам по вопросу",
  "routers.askButton": "Спросить",
  "routers.nothingReady":
    "Локально ответить нечем. Запустите Ollama или включите сеть для тех маршрутизаторов, которым она разрешена.",
  "routers.context": "контекст",

  "crew.title": "Команда",
  "crew.intro":
    "По одному специалисту на область, а не один инструмент на всё. Прямо сейчас на этой машине запустится {ready} из {total}.",
  "crew.ready": "готов",
  "crew.blocked": "заблокирован",
  "crew.needs": "требуется {capabilities}",

  "locale.title": "Язык",
  "locale.change": "Сменить язык",

  "common.retry": "Повторить",
  "common.close": "Закрыть",
  "common.copied": "Скопировано",
  "common.lastChecked": "последняя проверка {when}",
};
