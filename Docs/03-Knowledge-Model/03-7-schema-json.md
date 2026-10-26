# 03-7. schema.json — единый источник словаря

> **Описывает:** [[Knowledge-OS/Schema/schema.json]], его чтение в [[Knowledge-OS/Tools/validate-vault.mjs]] и [[Knowledge-OS/Tools/validate-vault.test.mjs]], парные описания в `Knowledge-OS/Schema/*.md`, раздел Knowledge OS Integrity в [[Knowledge-OS/Protocols/Knowledge-Maintenance-Protocol]].
> **Связано:** [[Docs/03-Knowledge-Model/03-1-Entity-Types]], [[Docs/03-Knowledge-Model/03-2-Metadata-and-Status]], [[Docs/03-Knowledge-Model/03-3-Lifecycle]], [[Docs/03-Knowledge-Model/03-4-Evidence]], [[Docs/03-Knowledge-Model/03-5-Relationships-and-Links]] — смысл каждого словаря, [[Docs/06-Tooling/06-1-Validator]] — где значения используются в коде, [[Docs/06-Tooling/06-6-Tests-and-Fixtures]] — как тестируется изменение, [[Docs/10-Extending]] — другие рецепты расширения, [[Docs/08-Distribution/08-4-Versioning-and-Changelog]] — как объявлять изменение словаря.

## Назначение

Вся модель знания — типы, статусы, состояния, уровни, пороги, связи, допустимые ключи — это набор закрытых словарей. Словарь должен существовать **в одном месте**. Иначе валидатор, документация схемы и любой генератор держат по своей копии, и копии расходятся: валидатор пропускает значение, которое документация запрещает, или наоборот.

Разделение ответственности:

- `schema.json` — **значения**. Его читает программа.
- `Schema/*.md` — **смысл** каждого значения. Их читают человек и ассистент.

Каждая `.md`-страница схемы заканчивается фразой того же вида: «точный список, который проверяет валидатор, живёт в `schema.json`; эта страница объясняет, что значит каждое значение».

## Как работает

### Ключи

| Ключ | Форма | Смысл | Где описан смысл | Кто читает в коде |
|---|---|---|---|---|
| `metadataKeys` | список | допустимые ключи frontmatter | [[Knowledge-OS/Schema/Metadata-Schema]] | `METADATA_KEYS` → `unknown-metadata-key` |
| `coreTypes` | список | core-типы | [[Knowledge-OS/Schema/Knowledge-Types]] | `CORE_TYPES` → `ALL_TYPES`, `PROJECT_TYPES_OUTSIDE_KNOWLEDGE_OS` |
| `operationalTypes` | список | операционные типы | Knowledge-Types | `OPERATIONAL_TYPES` → то же |
| `metaTypes` | список | метатипы | Knowledge-Types | `META_TYPES` → `KNOWLEDGE_OS_ONLY`, исключения `missing-evidence-for-active` и `orphaned-note` |
| `lifecycles` | список | состояния жизненного цикла | [[Knowledge-OS/Schema/Knowledge-Lifecycle]] | `LIFECYCLES` → `unknown-lifecycle` |
| `statusByType` | `{тип: [статусы]}` | допустимые статусы по типу; типа нет в карте — у него нет `status` | Metadata-Schema, раздел Status | `STATUS_BY_TYPE` → `invalid-status`, `status-not-allowed-for-type`, обязательность `status` |
| `activeLifecycleStatuses` | `{тип: [статусы]}` | статусы, после которых `lifecycle: draft` запрещён | Metadata-Schema, раздел Status | `ACTIVE_LIFECYCLE_STATUSES` → `lifecycle-behind-status` |
| `priorities` | список | значения `priority` | Metadata-Schema | `PRIORITIES` → `unknown-priority` |
| `relationshipTypes` | список | имена inline-полей связей | [[Knowledge-OS/Schema/Relationship-Types]] | `RELATIONSHIP_TYPES` → `unknown-relationship-field` |
| `evidenceLevels` | **упорядоченный** список | лестница L1–L4 | [[Knowledge-OS/Schema/Evidence-Schema]] | `EVIDENCE_LEVELS` → сравнение с порогом по индексу |
| `evidenceActionMap` | `{действие: уровень}` | запись уровня через действие | Evidence-Schema | валидатор не читает; читают `/mv-note`, ритуал закрытия в `AI.md` (часть 1 и 2), шаблон Finding (ассистент по тексту) |
| `evidenceFloorByType` | `{тип: уровень}` | минимум для `active` | Evidence-Schema, раздел Floors | `EVIDENCE_FLOOR` → `below-evidence-floor` |
| `evidenceAlternativeByType` | `{тип: [значения]}` | значения вне лестницы, удовлетворяющие порогу, — и только для перечисленных типов | Evidence-Schema | `EVIDENCE_ALTERNATIVES` (по умолчанию `{}`) → `evidence-not-allowed-for-type`, `below-evidence-floor`; `ALL_EVIDENCE_VALUES` → `unknown-evidence-level` |
| `origins` | `{происхождение: {types, evidenceAlternatives, requiredFields, requiredFieldsWhenActive}}` | значения поля `origin`: для каких типов, какую альтернативу порогу дают, каких полей требуют (всегда и при `active`) | Evidence-Schema, «A Decision inherited from the host»; Metadata-Schema | `ORIGINS` (по умолчанию `{}`) → `invalid-metadata-value`, `origin-incomplete`, альтернативы в `evidence-not-allowed-for-type` и `below-evidence-floor` |

### Как его читает валидатор

`validate-vault.mjs` один раз читает `../Schema/schema.json` относительно собственного расположения (не `cwd`) функцией `loadSchema()` и раскладывает ключи в константы в начале файла. До раскладки схема проверяется: восемь списков (`metadataKeys`, `coreTypes`, `operationalTypes`, `metaTypes`, `lifecycles`, `priorities`, `relationshipTypes`, `evidenceLevels`) — массивы строк; `statusByType`, `evidenceFloorByType` и `activeLifecycleStatuses` — объекты; каждый тип, названный ключом в `statusByType`, `evidenceFloorByType`, `evidenceAlternativeByType` или `activeLifecycleStatuses`, существует; списки статусов непусты; каждый статус в `activeLifecycleStatuses` есть в `statusByType` своего типа; пороги — уровни из `evidenceLevels`; у каждого происхождения в `origins` четыре списка строк, его `types` — существующие типы, а требуемые поля есть в `metadataKeys`. Нарушение — сообщение `Knowledge-OS/Schema/schema.json is invalid: …` в stderr и код выхода `2`. Дальше весь код работает с константами. Отсюда следствие, проверенное тестом QA `SCHEMA-1`: значение, изменённое в `schema.json`, сразу отражается в проверках, без правки кода.

Соглашения, которые код предполагает:

- все значения типов — **строчные**; валидатор приводит `type` к нижнему регистру (`typeOf()`) во всех проверках, а `lifecycle`, `status`, `priority`, `evidence` сравнивает как есть;
- ключи `statusByType`, `evidenceFloorByType`, `evidenceAlternativeByType`, `activeLifecycleStatuses` — те же строчные имена типов;
- порядок `evidenceLevels` — от слабого к сильному;
- `evidenceAlternativeByType` и `origins` — необязательные ключи (`?? {}`); отсутствие любого из остальных останавливает прогон через `loadSchema()` с названием ключа. `evidenceActionMap` валидатор не читает и не проверяет.

### Как его читают тесты

Фикстуры не содержат собственной копии схемы. `runFixture()` в [[Knowledge-OS/Tools/validate-vault.test.mjs]] копирует фикстуру во временный каталог и кладёт рядом **настоящие** `schema.json` и `validate-vault.mjs`. Поэтому фикстура всегда проверяется против текущего словаря — и поэтому изменение словаря может сломать существующую фикстуру, что и есть сигнал.

### Что в схему не входит

Часть словаря зашита в код, и это стоит знать до правки:

| Значение в коде | Где | Что значит |
|---|---|---|
| `"epic"`, `"task"` | правила `epic-status-behind-tasks` / `epic-status-ahead-of-tasks` | сведение статуса эпика по задачам |
| `EPIC_TERMINAL_TASK_STATUS = ["done", "cancelled"]` | валидатор | какие статусы задачи считаются завершёнными |
| `"active"`, `"draft"` | правила порога, скелета, `stale-source`, задач и эпиков | смысл состояний |
| `"index"` | `KNOWLEDGE_OS_ONLY` | единственный метатип, разрешённый в Project-OS |
| `CORE_TEMPLATE_PLACEHOLDERS = ["title", "date"]` | `checkTemplate()` | что подставляет Obsidian |
| `contains` | правила эпиков | связь Epic → Task |
| маркеры `open` / `yes` | `blocking-uncertainty-on-active` | словарь реестра неопределённостей |
| регулярное выражение «открытых» статусов задачи (ниже) | [[Project-OS/06-AI/AI]], `/mv-resume` | grep следующей задачи |

Регулярное выражение из последней строки: `^status: (todo|in-progress|blocked|review)`.

## Почему так

**Три копии уже были.** До выноса словаря в JSON значения жили в валидаторе, в `.md`-страницах схемы и во встроенной копии генератора. Три места, поддерживаемые намерением, расходятся; одно место, которое читает программа, — нет. Комментарий в начале валидатора называет именно эту причину.

**JSON, а не YAML или `.md`.** JSON читается в Node без зависимостей, не допускает двусмысленностей вроде «YAML превратил дату в объект» и не выглядит как заметка — его нельзя по ошибке «отредактировать в Obsidian» как текст.

**Смысл остаётся в `.md`.** JSON не умеет объяснять, почему `user-provided` — не уровень и почему у `task` есть порог. Разделение «значения / смысл» позволило менять значение без переписывания прозы и наоборот. README говорит прямо: при изменении словаря правьте `schema.json`; `.md` правятся, только когда меняется смысл.

**Расширение схемы в истории.** В апстримном `os-v1` у схемы не было `metadataKeys` и `evidenceActionMap`, а `statusByType` покрывал 10 типов из 16. Локальный дрейф добавил оба ключа и словари для всех типов; позже — `evidenceAlternativeByType` (`os-v2`), порог `task` (закрытие B4) и `origins` с ключами `origin`/`ratified` (2026-10-26, унаследованные правила хоста). Каждое добавление шло с фикстурой, и CHANGELOG фиксирует, что оно заставило мигрировать.

**Двусторонняя сверка — ручная.** Значение в заметке, которого нет в `schema.json`, падает в валидаторе. Значение в `schema.json`, не описанное в `.md`, ничего не роняет — оно только вводит читателя в заблуждение. Knowledge-Maintenance-Protocol §6 требует проверять оба направления руками; автоматической проверки «каждое значение задокументировано» нет.

## Разобранный пример 1: новое значение статуса

Задача: у задач должен появиться статус `deferred` — «отложена сознательно, не в работе и не отменена».

**1. `schema.json`.** Добавить значение в словарь типа:

```json
"task": [
  "todo",
  "in-progress",
  "blocked",
  "review",
  "deferred",
  "done",
  "cancelled"
],
```

С этого момента `status: deferred` на задаче проходит `invalid-status` — в коде менять ничего не нужно.

**2. Решить смысл для зашитых в код мест.** Это самый важный шаг, и его легко пропустить:

- считается ли `deferred` завершённой для эпика? Если нет — ничего не менять, и эпик с отложенной задачей не станет `done` (`epic-status-behind-tasks` не сработает, `epic-status-ahead-of-tasks` сработает, если эпик объявят `done`). Если да — добавить в `EPIC_TERMINAL_TASK_STATUS` в [[Knowledge-OS/Tools/validate-vault.mjs]];
- должна ли она находиться grep'ом следующей задачи? Решение «нет» не требует правок — `^status: (todo|in-progress|blocked|review)` её не найдёт. Решение «да» требует правки регулярного выражения в [[Project-OS/06-AI/AI]], [[Knowledge-OS/Dist/commands/mv-resume]] и его развёрнутой копии в `.claude/commands/` (иначе `deployed-command-drift`), а также в хабе разработки проекта;
- фильтры `.base` в Project-OS (представления «Open tasks», «Blocked»).

**3. `Schema/*.md`.** Строка в разделе Status в [[Knowledge-OS/Schema/Metadata-Schema]]:

```markdown
- Task → `todo`, `in-progress`, `blocked`, `review`, `deferred`, `done`, `cancelled`
```

и, если смысл не очевиден, фраза о том, чем `deferred` отличается от `blocked` (ждёт внешнего) и `cancelled` (не будет сделана).

**4. Шаблоны.** [[Project-OS/Templates/Task]] стартует с `todo` — не меняется. Если бы новое значение стало стартовым, `checkTemplate()` проверил бы его по тому же `statusByType`.

**5. Фикстура и тест.** Отрицательный случай уже есть (`invalid-status`). Добавить положительный, чтобы значение не исчезло незаметно при следующей правке:

```text
Knowledge-OS/Tools/__fixtures__/task-deferred-status/
  Knowledge-OS/README.md            # type: readme, ссылается на Project-OS/T01
  Project-OS/T01.md                 # type: task, status: deferred, lifecycle: draft
```

```js
test("deferred is an allowed Task status", () => {
  const report = runFixture("task-deferred-status");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});
```

и имя фикстуры — в список `covered` теста `every fixture directory under __fixtures__ is covered by a case`, иначе тот упадёт. README фикстуры должен ссылаться на задачу, иначе `orphaned-note` даст предупреждение и тест «без предупреждений» провалится. Новых строк в [[Knowledge-OS/os-manifest]] не нужно: `Knowledge-OS/Tools/__fixtures__/**` уже покрыт.

**6. Прогон** из корня хранилища:

```text
node --test "Knowledge-OS/Tools/validate-vault.test.mjs"
node "Knowledge-OS/Tools/validate-vault.mjs"
```

**7. [[CHANGELOG]].** Добавление значения ничего не заставляет мигрировать — так и написать. Удаление или переименование значения — наоборот, миграция: перечислить, какие заметки упадут на `invalid-status`.

## Разобранный пример 2: новый тип

Задача: операционный тип `incident` — запись об инциденте в эксплуатации, со статусами `open` / `resolved`, рождается `draft`, становится `active` при `L2` (инцидент воспроизведён или наблюдался в логе).

**1. `schema.json`:**

```json
"operationalTypes": ["prompt", "log", "resource", "finding", "incident"],
"statusByType": {
  "incident": ["open", "resolved"]
},
"evidenceFloorByType": {
  "incident": "L2"
}
```

(фрагменты; остальные значения ключей не меняются.) Валидатор автоматически:

- принимает `type: incident` (`ALL_TYPES`);
- запрещает его в `Knowledge-OS/` (`project-type-inside-knowledge-os`, через `PROJECT_TYPES_OUTSIDE_KNOWLEDGE_OS`);
- проверяет `status` по новому словарю;
- требует `evidence` при `active` и порог `L2`;
- предупреждает `orphaned-note`, если на запись никто не ссылается.

**2. `Schema/*.md`:**

- [[Knowledge-OS/Schema/Knowledge-Types]] — строка в Operational Types и, по правилам выбора, чем `incident` отличается от `finding` (воспроизводимый эпизод против одной строки наблюдения) и от `log`;
- [[Knowledge-OS/Schema/Metadata-Schema]] — строка статусов;
- [[Knowledge-OS/Schema/Evidence-Schema]] — строка порога в Floors и тип в перечислении раздела Scope;
- [[Knowledge-OS/Schema/Provider-Mapping]] — сейчас кандидат `incident` провайдера отображается в `finding`; решить, отображать ли его в новый тип.

**3. Шаблон** `Project-OS/Templates/Incident.md`:

```yaml
---
type: incident
status: open
lifecycle: draft
created: {{date}}
updated: {{date}}
---
```

с разделами тела. `checkTemplate()` проверит ключи, значения и плейсхолдеры. Строка `Project-OS/Templates/*.md` в [[Knowledge-OS/os-manifest]] уже покрывает новый файл — иначе `os-layer-outside-manifest` не дал бы забыть.

**4. Место в Project-OS.** Папка (например, под `03-Development/`) и хаб-заметка `index`, ссылающаяся на записи, — см. [[Docs/05-Project-OS/05-1-Sections]]. Если запись должна находиться по маршруту, — строка в [[Knowledge-OS/Context-Index]].

**5. Фикстуры:** `incident-below-floor` (`active` на `L1` → `below-evidence-floor`) в `CASES`, и чистая `incident-clean` с отдельным тестом без ошибок и предупреждений; обе — в `covered`.

**6. Прогон** — как в примере 1; затем полный `npm test` из корня репозитория.

**7. [[CHANGELOG]]** — «Что изменилось внутри»: новый тип и шаблон; «Что валидатор начал требовать»: ничего для существующих заметок.

## Подводные камни

- **Раньше сам `schema.json` не валидировался.** Синтаксическая ошибка JSON или отсутствующий ключ роняли валидатор исключением со стеком, а опечатка в имени типа внутри `statusByType` (`"incidnet"`) не была ошибкой — тип молча оставался без словаря и принимал любой статус. Теперь `loadSchema()` останавливает прогон с причиной и кодом выхода `2` (тест «an invalid schema.json stops the run with the reason»). Проверяется структура и ссылочная целостность, а не смысл. Тип без записи в `statusByType` с os-v5 не принимает никакого статуса (`status-not-allowed-for-type`), так что опечатка в имени типа теперь видна и на заметках: все они упадут.
- **Изменение роняет чужие хранилища.** `schema.json` входит в манифест и доставляется во все проекты. Удалённое значение превращается там в ошибки на заметках, которых вы не видели.
- **Новое значение лестницы меняет все сравнения.** См. [[Docs/03-Knowledge-Model/03-4-Evidence]].
- **Раньше альтернатива становилась допустимой глобально**: значение в `evidenceAlternativeByType` пополняло `ALL_EVIDENCE_VALUES`, и только `unknown-evidence-level` смотрел на этот список. Теперь значение известно всем типам (не `unknown-evidence-level`), но разрешено только перечисленным (`evidence-not-allowed-for-type`). Провайдер контекста держит свою копию (`EVIDENCE_ALTERNATIVES` в `context-provider.mjs`) — её правят отдельно.
- **Зашитые литералы не следуют за схемой.** Переименуйте `task` в схеме — сведение статуса эпика по задачам отключится без единой ошибки. `lifecycle-behind-status` от этого защищён: карта `activeLifecycleStatuses` с неизвестным типом останавливает прогон.
- **Регистр.** Тип в схеме должен быть строчным: валидатор сравнивает с `typeOf()` (нижний регистр) от frontmatter, и тип `Incident` в схеме не совпадёт ни с одной заметкой. `loadSchema()` этого не ловит.

## Как менять

Сводный чек-лист изменения словаря:

1. [[Knowledge-OS/Schema/schema.json]] — значение.
2. Парная страница `Knowledge-OS/Schema/*.md` — смысл (обе стороны сверяются вручную, Maintenance-Protocol §6).
3. Литералы в коде и командах из таблицы «Что в схему не входит» — решить для каждого.
4. Шаблоны `Project-OS/Templates/` — если значение стартовое или тип новый.
5. Фикстура(ы), `CASES` / отдельный тест, список `covered`.
6. `node --test "Knowledge-OS/Tools/validate-vault.test.mjs"`, `node "Knowledge-OS/Tools/validate-vault.mjs"`, `npm test`.
7. [[CHANGELOG]] — что мигрировать проектам.
8. Если затронуты команды — обе копии (`Knowledge-OS/Dist/commands/` и `.claude/commands/`), проверка `node "Knowledge-OS/Tools/adopt.mjs" --verify`.
