/**
 * Ukrainian.
 *
 * Four plural forms, on the same shape as Russian but a different language —
 * and it does not fall back to Russian for a missing key. That substitution is
 * read as a political statement by a large part of the audience, so a gap here
 * falls to English instead. See `LOCALE_SPECS.uk.fallbacks`.
 */
import type { en } from "./en";

export const uk: Partial<Record<keyof typeof en, string>> = {
  "workstation.title": "Робоча станція",
  "workstation.subtitle":
    "{live, plural, =0 {Жодна станція ще не відповіла} one {# з {total} перевірюваних станцій відповіла} few {# з {total} перевірюваних станцій відповіли} many {# з {total} перевірюваних станцій відповіли} other {# з {total} перевірюваних станцій відповіло}}",
  "workstation.next": "Наступний крок",
  "workstation.check": "Перевірити",
  "workstation.online": "мережа є · синхронізація доступна",
  "workstation.offline": "без мережі · працює повністю",

  "stage.ignition": "Запуск",
  "stage.core": "Ядро",
  "stage.workstation": "Робоча станція",
  "stage.field": "Поле",
  "stage.ready": "готово",
  "stage.blocked": "заблоковано",
  "stage.pending": "очікування",

  "station.required": "обов'язково",
  "station.open": "Відкрити",
  "station.offlineFull": "працює без мережі",
  "station.offlineSync": "працює без мережі, синхронізується за нагоди",
  "station.offlineNone": "потрібна мережа",
  "state.live": "на зв'язку",
  "state.declared": "заявлено",
  "state.absent": "не відповідає",
  "state.unknown": "перевіряється",

  "partitions.title": "Автономні розділи",
  "partitions.budget": "Виділено {granted}, потрібно {needed} на всі мінімуми, вільно {spare}.",
  "partitions.noQuota": "Квота сховища недоступна: {reason}",
  "partitions.reading": "Читаємо квоту сховища пристрою…",
  "partitions.backupNote":
    "Резервні копії лежать поруч із самими записами, тож відновлення не потребує мережі.",
  "partitions.durable": "захищено від витіснення",
  "partitions.evictable": "може бути витіснено",
  "partitions.sync": "Копія та синхронізація",
  "partitions.belowFloor":
    "Нижче мінімуму — на цьому пристрої розділ не зможе виконувати своє завдання.",
  "partitions.records":
    "{count, plural, =0 {нічого не збережено} one {# запис} few {# записи} many {# записів} other {# запису}}",
  "partitions.backups":
    "{count, plural, =0 {копій немає} one {# копія} few {# копії} many {# копій} other {# копії}} з {depth}",

  "squads.title": "Загони",
  "squads.intro":
    "Маршрутизатори, зібрані в підрозділи з ведучим і підтримкою. Кожен підрозділ будує план один раз за спільним знімком обстановки й тримає маршрут, доки виконується короткий перелік умов.",
  "squads.operational": "боєздатний",
  "squads.grounded": "без маршруту",
  "squads.lookAgain": "Оглянути знову",
  "squads.efficiency":
    "{units} з {total} підрозділів боєздатні · {looks, plural, one {# огляд} few {# огляди} many {# оглядів} other {# огляду}} закрив {questions, plural, one {# запит} few {# запити} many {# запитів} other {# запиту}} ({held}% без перерахунку)",
  "squads.replanned":
    "{count, plural, =0 {нічого не перераховано} one {# маршрутизатор перераховано} few {# маршрутизатори перераховано} many {# маршрутизаторів перераховано} other {# маршрутизатора перераховано}} у цьому проході",
  "squads.held": "без змін",
  "squads.rePlanned": "перераховано",
  "squads.noPath": "немає маршруту",
  "squads.watching": "стежимо за",

  "routers.title": "Контекстні маршрутизатори мікро-ШІ",
  "routers.intro":
    "Кожен маршрутизатор поєднує одну невелику модель із розділами, на яких він знається, і відповідає через найближчий доступний рушій.",
  "routers.ask": "Запитайте маршрутизатор — він визначиться сам за запитанням",
  "routers.askButton": "Запитати",
  "routers.nothingReady":
    "Локально відповісти нічим. Запустіть Ollama або увімкніть мережу для тих маршрутизаторів, яким її дозволено.",
  "routers.context": "контекст",

  "crew.title": "Команда",
  "crew.intro":
    "По одному фахівцю на напрям, а не один інструмент на все. Просто зараз на цій машині запуститься {ready} з {total}.",
  "crew.ready": "готовий",
  "crew.blocked": "заблокований",
  "crew.needs": "потрібно {capabilities}",

  "locale.title": "Мова",
  "locale.change": "Змінити мову",

  "common.retry": "Повторити",
  "common.close": "Закрити",
  "common.copied": "Скопійовано",
  "common.lastChecked": "остання перевірка {when}",
};
