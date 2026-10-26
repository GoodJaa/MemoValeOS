# 05.3. Шаблоны сущностей

> **Описывает:** `Project-OS/Templates/` — [[Project-OS/Templates/Architecture]], [[Project-OS/Templates/Decision]], [[Project-OS/Templates/Epic]], [[Project-OS/Templates/Finding]], [[Project-OS/Templates/Idea]], [[Project-OS/Templates/Log]], [[Project-OS/Templates/Product]], [[Project-OS/Templates/Prompt]], [[Project-OS/Templates/Research]], [[Project-OS/Templates/Resource]], [[Project-OS/Templates/Task]]; проверку `checkTemplate()` в [[Knowledge-OS/Tools/validate-vault.mjs]].
> **Связано:** [[Docs/03-Knowledge-Model/03-1-Entity-Types]] — что означает каждый тип, [[Docs/03-Knowledge-Model/03-2-Metadata-and-Status]] — допустимые поля и статусы, [[Docs/03-Knowledge-Model/03-4-Evidence]] — почему в шаблонах нет `evidence`, [[Docs/05-Project-OS/05-2-Delivery-Model]] — как живут Epic, Task и Finding, [[Docs/08-Distribution/08-1-OS-Manifest]] — почему `Task.md` не переносится, [[Docs/09-Obsidian-Integration]] — как шаблон вставляется в Obsidian.

## Назначение

Шаблон задаёт форму сущности при рождении: обязательные поля frontmatter с корректными начальными значениями и набор разделов тела. Без шаблонов форма каждой новой заметки зависит от того, кто её пишет. Тогда одна задача получает `status: open`, которого нет в словаре, а другая — раздел «Итоги» вместо «Result». Шаблоны — это способ сделать так, чтобы сущность с первой минуты удовлетворяла схеме [[Knowledge-OS/Schema/Metadata-Schema]].

Шаблоны входят в слой ОС: строка `Project-OS/Templates/*.md` в [[Knowledge-OS/os-manifest]]. Исключение одно — `Task.md` (см. ниже).

## Как работает

### Общее устройство

Каждый шаблон — markdown-файл с frontmatter и пустыми заголовками разделов. В значениях встречаются только два плейсхолдера: `{{title}}` и `{{date}}`. Их подставляет ядровой плагин Obsidian `templates` при ручной вставке шаблона. Список зафиксирован в валидаторе константой `CORE_TEMPLATE_PLACEHOLDERS = ["title", "date"]`.

```yaml
---
type: epic
status: planned
lifecycle: draft
created: {{date}}
updated: {{date}}
---

# {{title}}
```

Во всех шаблонах есть `created` и `updated`: апстрим до синхронизации этих полей не имел, и при переносе их отправили туда ([[CHANGELOG]]). Поля `evidence` **нет ни в одном шаблоне**. Уровень доказательности, записанный шаблоном, — это утверждение, которого никто не делал. Поле `source` тоже не заполняется заранее: оно появляется, только когда есть реальный файл и коммит.

### Начальные значения и разделы

| Шаблон | `type` | `status` | `lifecycle` | Разделы тела |
|---|---|---|---|---|
| `Architecture.md` | `architecture` | — (поля нет) | `draft` | Purpose, Responsibility, Structure, Dependencies, Constraints, Related |
| `Decision.md` | `decision` | `proposed` | `draft` | Status (с текстом `Proposed`), Context, Problem, Options, Decision, Consequences, Alternatives Rejected, Related. Над Status — комментарий: какие поля (`origin: inherited`, `source`, `ratified`) добавить, если решение — правило, унаследованное от хоста |
| `Environment.md` | `resource` | `active` | `draft` | Runtime, Commands, Services and Access — таблицы, где у каждой строки дата и команда проверки; Related. Заголовок постоянный, `Environment`: заметка у проекта одна, `06-AI/Context/Environment.md` |
| `Epic.md` | `epic` | `planned` | `draft` | Goal, Why, Scope, Tasks, Dependencies, Architecture, Decisions, Related |
| `External-Corpus.md` | `resource` | `active` | `draft` | What It Is, Location, Scope, Who Writes It, How Current It Is, What Is Lifted Into the Vault, Related. Для знания проекта вне хранилища (`docs/`, вики, чужая система): ссылаться, а не копировать |
| `Finding.md` | `finding` | `active` | **`active`** | без заголовка и разделов: строка `{{title}}` и HTML-комментарий |
| `Idea.md` | `idea` | `inbox` | `draft` | Problem, Idea, Value, Risks, Possible Implementation, Related |
| `Log.md` | `log` | `active` | `draft` | Date, Work, Discoveries, Problems, Decisions, Next |
| `Product.md` | `product` | — (поля нет) | `draft` | Purpose, Description, Goals, Constraints, Related |
| `Prompt.md` | `prompt` | `active` | `draft` | Purpose, Context, Prompt, Expected Output, Related |
| `Research.md` | `research` | `open` | `draft` | Question, Context, Investigation, Findings, Recommendation, Decision Impact, Sources, Related |
| `Resource.md` | `resource` | `active` | `draft` | Type, URL, Description, Why Useful, Related |
| `Task.md` | `task` | `todo` | `draft` | Objective, Context, Requirements, Acceptance Criteria, Relevant Architecture, Relevant Decisions, Research, Progress, Implementation, Tests, Result, Discoveries, Follow-up, Related |

Как читать таблицу:

- **`status` — первое значение жизненного пути типа** из `statusByType` в [[Knowledge-OS/Schema/schema.json]]: задача начинается с `todo`, эпик с `planned`, решение с `proposed`, идея с `inbox`, исследование с `open`. У типов с единственным допустимым статусом (`log`, `prompt`, `resource`, `finding`) это `active`. У `product` и `architecture` поля `status` нет: их словарь повторял `lifecycle` (`status-not-allowed-for-type`).
- **`lifecycle: draft` у всех, кроме Finding.** Новая сущность — черновик, пока не наберёт порог доказательности своего типа и не будет повышена по [[Knowledge-OS/Rules/Promotion-Rules]]. Если бы шаблон начинал с `active`, порог пришлось бы обходить уже при рождении.
- **Раздел `## Related`** есть почти везде: туда, по [[Knowledge-OS/Schema/Relationship-Types]], ставятся строки-связи `depends-on::`, `constrained-by::` и другие, если у связи нет более подходящего раздела. В `Epic.md` для этого есть отдельные разделы: `## Tasks` для `contains::`, `## Dependencies` для `depends-on::`, `## Decisions` для `constrained-by::`.
- **Разделы `Task.md` повторяют путь контекста.** Relevant Architecture, Relevant Decisions и Research — это ступени расширения контекста из [[Knowledge-OS/Protocols/Context-Selection-Protocol]] (задача → эпик → архитектура → решения → исследования). Задача сама называет, что ещё нужно читать. Tests, Result и Discoveries заполняются по ходу и в конце работы. Discoveries — то место, откуда растут Findings. Progress переписывается в конце каждой сессии, пока задача открыта: где остановились и следующий шаг. С него начинает тот, кто продолжит (часть 3 ритуала в [[Project-OS/06-AI/AI]]). Раздел появился в os-v8. Апстримный шаблон задачи его не несёт, поэтому ритуал добавляет раздел в заметку сам, если его нет.

### `Finding.md`: шаблон, который проваливает проверку намеренно

Finding — единственный тип, который рождается сразу `lifecycle: active`: в нём ничему не нужно дозревать. Но [[Knowledge-OS/Schema/Evidence-Schema]] требует `evidence` у всего активного. Поэтому заметка, вставленная из этого шаблона и оставленная как есть, получает ошибку `missing-evidence-for-active`. Это предусмотрено, и внутри шаблона это объяснено HTML-комментарием:

```html
<!--
`evidence` is missing on purpose, and a Finding inserted from this template
will fail `missing-evidence-for-active` until you add it.
...
Add it from what you actually did, per `evidenceActionMap` in
`Schema/schema.json`: read → L1, ran → L2, used → L3, confirmed → L4.
-->
```

Альтернатива — заранее записанный `evidence: L1` — выглядит удобнее, но молча присвоила бы каждому наблюдению уровень, которого никто не достигал. Ошибка валидатора здесь честнее, чем тихое значение по умолчанию. [[Knowledge-OS/Dist/commands/mv-note]] эту ошибку не допускает: он задаёт вопрос «что было сделано: `read`/`ran`/`used`/`confirmed`?» и записывает соответствующий уровень. Поэтому вместо ручной вставки шаблона рекомендуется команда.

В теле шаблона нет заголовка `# …` и нет разделов, только строка `{{title}}`. Находка — это одна строка вывода. Разделы подтолкнули бы её разрастись в заметку, которой на деле должна быть Research или Architecture.

### `Task.md`: исключён из манифеста

[[Knowledge-OS/os-manifest]] содержит строку-исключение `!Project-OS/Templates/Task.md`. Это записанное **постоянное расхождение** ([[CHANGELOG]], раздел о сознательных расхождениях):

- апстрим сократил шаблон задачи до 6 разделов (Objective, Context, Acceptance Criteria, Implementation, Result, Follow-up);
- шаблон Archi держал 13 разделов, которыми уже пользовались 50 задач. Ко времени решения у пяти выполненных задач все 13 разделов были заполнены на 100%. С os-v8 разделов 14: добавлен Progress;
- перенос апстримного шаблона дал бы две формы задачи в одном хранилище и удалил бы разделы, которые заполняются каждый раз. Отправка местного в апстрим навязала бы апстриму форму, которую он сознательно отверг.

Решение — не синхронизировать файл ни в одну сторону. Правило `os-layer-outside-manifest` на нём не срабатывает, потому что `!`-строка явно выводит его из слоя. `os-patch.mjs` не включает его в доставку. [[Knowledge-OS/Dist/commands/mv-sync]] перечисляет это расхождение среди тех, которые *must not be "fixed" during a sync*.

### Как валидатор проверяет шаблоны

Шаблоны **не проверяются как заметки**. Их поля по определению содержат плейсхолдеры, поэтому обязательные поля, пороги доказательности и проверка «тела-заготовки» к ним неприменимы. Комментарий у `TEMPLATES_PATH` в [[Knowledge-OS/Tools/validate-vault.mjs]] прямо говорит: все прежние случаи, когда схема «случайно не срабатывала» на шаблоне, были именно случайностью, а не задуманным исключением. Вместо общей схемы есть узкая проверка `checkTemplate()`:

1. Frontmatter читается **как текст, построчно `key: value`**, а не YAML-парсером. `{{date}}` в позиции значения — невалидный YAML: он разбирается как flow-mapping, и `{{date}}` молча превращается в `{"[object Object]": null}`.
2. Ключ должен входить в `metadataKeys`, иначе `unknown-metadata-key`.
3. Плейсхолдер допустим только из `CORE_TEMPLATE_PLACEHOLDERS`. Любой другой (`{{what}}`, `{{where}}`) — ошибка `unfilled-template-placeholder`: его ничто не подставит, и он попадёт в настоящую заметку как есть.
4. Литеральные значения проверяются по словарю: `unknown-type`, `unknown-lifecycle`, `unknown-evidence-level`, `unknown-priority`, а `status` проверяется против `statusByType` своего `type` (`invalid-status`).
5. Шаблон без frontmatter — `missing-frontmatter`.

Кроме того, папка входит в `OS_LAYER_PREFIXES`, поэтому каждый её файл должен быть покрыт манифестом. Шаблоны также исключены из подсчёта входящих ссылок (`isTemplate()`): ссылка из шаблона не делает сущность достижимой.

## Почему так

**Только `{{title}}` и `{{date}}`.** Проверка появилась после реального дефекта. Старый `Finding.md` содержал `{{what}}` и `{{where}}` — поля, которые должна была заполнить команда. Вставленный руками шаблон давал заметки с буквальным `{{what}}` в теле. Валидатор этого не видел: правила, проверяющего поля в форме даты, нет, поэтому даже `{{date}}` фактически не проверялся. Теперь допустимы только плейсхолдеры, которые действительно подставляет ядровой плагин.

**Шаблон не ставит `evidence`.** Доказательность — запись о том, что сделано, а не свойство типа. Шаблон не знает, что было сделано.

**Почему не Templater.** Явного решения об этом в источниках нет; ниже вывод из устройства системы. Синтаксис `<% … %>` у Templater мощнее, но шаблоны тогда зависели бы от community-плагина, а слой ОС должен работать без Obsidian (см. [[Docs/09-Obsidian-Integration]]). Два плейсхолдера ядрового плагина легко заполнить руками или командой. Поэтому команды ([[Knowledge-OS/Dist/commands/mv-note]], [[Knowledge-OS/Dist/commands/mv-close]]) пишут заметки сразу в нужной форме и вставку шаблона не вызывают.

**Шаблон реестра есть, шаблонов строк и индексов — нет.** Отдельная неопределённость — строка таблицы, а не заметка, поэтому шаблона для неё нет. Но сам реестр — [[Project-OS/Templates/Uncertainty-Ledger]]: `type: index`, `status: active`, `lifecycle: draft`, пустая таблица `ID | Uncertainty | Status | Blocking | Resolution source | Next action` и правила. Из него [[Knowledge-OS/Protocols/Project-Initialization-Protocol]] создаёт `Project-OS/04-Research/Uncertainties.md`, если реестра ещё нет: обследование и последующая работа пишут в реестр как в существующий. Имя шаблона отличается от имени реестра намеренно: при совпадении базовых имён голые ссылки `[[Uncertainties]]` по всему проекту стали бы `ambiguous-basename-link`. Индексов разделов шаблоны не покрывают: это навигация, своя у каждого проекта.

## Пример

Эпик Archi `E07-Storage`, созданный из [[Project-OS/Templates/Epic]]. При рождении у него `status: planned`, `lifecycle: draft`, восемь пустых разделов. Через две недели:

- `## Goal` — «Persist the result of an analysis so the graph can be queried without re-analyzing the repository.»
- `## Tasks` — четыре строки `contains:: [[T26-Project-Storage]]` … `[[T29-…]]`;
- `## Dependencies` — `depends-on:: [[E06-Graph-Engine]]`;
- `## Decisions` — `constrained-by:: [[ADR-003-Storage-Technology]]`;
- frontmatter — `status: active`, `lifecycle: active`, `evidence: L2`: работа началась, поэтому `draft` больше не допустим (иначе `lifecycle-behind-status`).

Находка, записанная через `/mv-note` вместо вставки шаблона:

```yaml
---
type: finding
status: active
lifecycle: active
evidence: L2
created: 2026-09-22
updated: 2026-09-22
---

The `T01`…`T50` numbering encodes delivery order, and ... 

affects:: [[T51-Declares-Relationship]]
related-to:: [[Development]]
```

## Подводные камни

- **Папка шаблонов задана в `.obsidian/templates.json`** (`"folder": "Project-OS/Templates"`): ядровой плагин Templates вставляет их с подстановкой `{{title}}` и `{{date}}`, ровно тот синтаксис, которым шаблоны написаны. Раньше файла не было, и папку приходилось указывать вручную после клонирования. Одновременно `Project-OS/Templates/` стоит в `userIgnoreFilters` (`.obsidian/app.json`): шаблоны не засоряют поиск и граф.
- **Ранние находки отличаются по форме.** Ранние Findings Archi написаны в форме `**what:** / **where:** / **date:**` с заголовком. Нынешний шаблон, `/mv-note` и [[Knowledge-OS/Rules/Promotion-Rules]] описывают одну строку тела без полей: что замечено, уровень доказательства, дата и связь `affects::`.
- **`Log.md` без `## Related`**, а `Finding.md` без разделов вообще. У Finding связь — строка `affects::`, которую ставит команда. Тот, кто вставил шаблон руками, должен добавить её сам, иначе `orphaned-note`.
- **Исключение `Task.md` действует в обе стороны.** Если улучшить местный шаблон задачи, улучшение не уедет в апстрим, и никакая проверка об этом не напомнит.

## Как менять

- **Новый шаблон.** Файл в `Project-OS/Templates/` автоматически покрывается строкой `Project-OS/Templates/*.md`. Его `type` должен быть в [[Knowledge-OS/Schema/schema.json]], а начальный `status` — первым по смыслу значением из `statusByType`. Новый тип описывается в [[Knowledge-OS/Schema/Knowledge-Types]] (см. [[Docs/10-Extending]]).
- **Новое поле.** Сначала в `metadataKeys` в `schema.json` и смысл поля в [[Knowledge-OS/Schema/Metadata-Schema]]. Иначе `checkTemplate()` выдаст `unknown-metadata-key`.
- **Новый плагин подстановки.** Если нужны другие плейсхолдеры, расширять `CORE_TEMPLATE_PLACEHOLDERS` можно только вместе с тем, кто их реально подставляет. Иначе вернётся класс дефекта `{{what}}`.
- **Изменение формы, которую пишут команды.** Форма Finding записана в трёх местах: в шаблоне, в [[Knowledge-OS/Dist/commands/mv-note]] и в [[Knowledge-OS/Dist/commands/mv-close]]. Менять нужно все три, затем развёртывание (`adopt.mjs`, [[Docs/08-Distribution/08-2-Adoption]]), иначе сработает `deployed-command-drift`.
- **Проверка.** `node Knowledge-OS/Tools/validate-vault.mjs` и `node --test Knowledge-OS/Tools/validate-vault.test.mjs`. Затем запись в [[CHANGELOG]].
