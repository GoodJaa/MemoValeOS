# 03-2. Метаданные и статус

> **Описывает:** [[Knowledge-OS/Schema/Metadata-Schema]], ключи `metadataKeys`, `statusByType`, `activeLifecycleStatuses`, `priorities` в [[Knowledge-OS/Schema/schema.json]], разбор frontmatter и проверки полей в [[Knowledge-OS/Tools/validate-vault.mjs]].
> **Связано:** [[Docs/03-Knowledge-Model/03-1-Entity-Types]] — откуда берутся значения `type`, [[Docs/03-Knowledge-Model/03-3-Lifecycle]] — поле `lifecycle` и его переходы, [[Docs/03-Knowledge-Model/03-4-Evidence]] — поле `evidence`, [[Docs/03-Knowledge-Model/03-5-Relationships-and-Links]] — почему связи не во frontmatter, [[Docs/06-Tooling/06-2-Stale-Check-and-Graph-Report]] — подробная проверка `source`, [[Docs/06-Tooling/06-1-Validator]] — полная таблица правил.

## Назначение

Frontmatter заметки — это её машиночитаемая карточка: что это (`type`), насколько это актуально (`lifecycle`), в каком состоянии работа (`status`), насколько это доказано (`evidence`), когда создано и менялось, на какое состояние кода опирается. По этим полям валидатор проверяет заметку, `.base`-таблицы строят представления, `grep` находит следующую задачу, а провайдер контекста сообщает внешнему потребителю, чему можно доверять.

Главная мысль Metadata-Schema — **минимальность**. Поле во frontmatter оправдано, только если оно нужно для маршрутизации, жизненного цикла, фильтрации или автоматизации и нужно больше чем одной заметке. Содержание знания и семантические связи во frontmatter не живут.

## Как работает

### Закрытый список ключей

Допустимые ключи перечислены в `metadataKeys`. Любой другой ключ — ошибка `unknown-metadata-key`.

| Ключ | Обязателен | Значения | Что проверяет валидатор |
|---|---|---|---|
| `type` | да | `coreTypes` ∪ `operationalTypes` ∪ `metaTypes` (без учёта регистра) | `missing-required-field`, `unknown-type`, правила размещения |
| `lifecycle` | да | `lifecycles`: `draft`, `active`, `superseded`, `archived` | `missing-required-field`, `unknown-lifecycle` |
| `status` | да, кроме `product` и `architecture` | `statusByType[type]` | `missing-required-field`, `invalid-status`, `status-not-allowed-for-type`, `lifecycle-behind-status` |
| `priority` | нет | `priorities`: `high`, `medium`, `low` | `unknown-priority` |
| `evidence` | для `active` не-метатипов | `evidenceLevels` или альтернативы из `evidenceAlternativeByType` | `unknown-evidence-level`, `evidence-not-allowed-for-type`, `missing-evidence-for-active`, `below-evidence-floor` |
| `created` | нет | `YYYY-MM-DD` | `invalid-metadata-value` (форма, не правдоподобие) |
| `updated` | нет | `YYYY-MM-DD` | `invalid-metadata-value` (форма, не правдоподобие) |
| `stale` | нет | `true` / `false` | `invalid-metadata-value`, если не булево (само поле вытеснено `source`) |
| `source` | нет | список `{path, commit}` | `stale-source` (предупреждение, только для `active`) |
| `origin` | нет | ключи `origins`: `inherited` — для `decision`, `imported` — для `task` и `epic` | `invalid-metadata-value` (неизвестное значение или чужой тип), `origin-incomplete` (нет обязательных полей); `inherited` даёт заметке альтернативу порогу ([[Docs/03-Knowledge-Model/03-4-Evidence]]) |
| `key` | при `origin: imported` | строка — ключ элемента во внешнем трекере | `invalid-metadata-value` (не строка; не соответствует `tasks.keyPattern` из `mvos.config.json`), `origin-incomplete` (нет у импортированной заметки); [[Docs/06-Tooling/06-9-Task-Import]] |
| `ratified` | при `origin: inherited` и `lifecycle: active` | `YYYY-MM-DD` | `invalid-metadata-value` (форма), `origin-incomplete` (нет) |

### Статус по типу

`status` — состояние *работы* над сущностью, и его словарь зависит от типа. Значения — из `statusByType`:

| Тип | Допустимые `status` |
|---|---|
| `task` | `todo`, `in-progress`, `blocked`, `review`, `done`, `cancelled` |
| `epic` | `planned`, `active`, `blocked`, `done`, `cancelled` |
| `research` | `open`, `completed`, `obsolete` |
| `decision` | `proposed`, `accepted`, `superseded`, `rejected` |
| `idea` | `inbox`, `research`, `planned`, `implemented`, `rejected`, `archived` |
| `log`, `index`, `finding`, `prompt`, `resource`, все метатипы | только `active` |
| `product`, `architecture` | **нет `status`** — поле запрещено (`status-not-allowed-for-type`) |

У типа без записи в `statusByType` поля `status` нет вовсе: валидатор не требует его и отвергает, если оно есть. Сейчас таких типов два — `product` и `architecture`. До os-v5 их словарь был `draft`, `active`, `superseded` — копия словаря `lifecycle`, и два поля противоречили друг другу: шесть из восьми архитектурных заметок проекта-носителя стояли `status: active` при `lifecycle: draft`.

Для типов с единственным значением `active` поле обязательно: оно стоит одной строки и оставляет каждую заметку фильтруемой по статусу.

### `lifecycle` и `status` независимы

Это два разных вопроса:

- `status` — где работа: задача `in-progress`, решение `proposed`;
- `lifecycle` — можно ли этому знанию доверять как текущему.

Metadata-Schema прямо запрещает использовать состояния работы как состояния жизненного цикла. Подробно о `lifecycle` — [[Docs/03-Knowledge-Model/03-3-Lifecycle]].

Независимы, но не произвольны. После некоторых статусов на знание уже опираются, и `lifecycle: draft` говорит обратное. Эти статусы названы данными — `activeLifecycleStatuses` в `schema.json`: задача `done`, эпик `active` или `done`, решение `accepted`. Заметка в таком статусе с `lifecycle: draft` — ошибка `lifecycle-behind-status`. Раньше это были два правила, по одному на `task` и `epic`, и класс вернулся на типе, у которого правила не было: ADR-001/002 стояли `accepted` + `draft` в сентябре, ADR-003/004/005 — месяцем позже. Тип подключается строкой в карте, а не новым циклом в коде. Статус эпика относительно его задач проверяет отдельная пара `epic-status-behind-tasks` / `epic-status-ahead-of-tasks` (по `contains::`).

### Даты

`created` и `updated` — ISO-даты. Правило записи: кто меняет содержание заметки, тот в той же правке ставит `updated` на сегодня, а `created` — если его нет. «Содержание» — это изменённое утверждение, новый или удалённый раздел, исправленный факт, изменённая связь или смена `lifecycle`/`status`. Опечатка и переформатирование — нет. Правило записано один раз, как шаг, в [[Knowledge-OS/Protocols/Knowledge-Maintenance-Protocol]] (раздел Stamping `updated`).

Валидатор проверяет у governed-заметок только **форму**: `created` и `updated`, если заданы, должны быть `YYYY-MM-DD`, иначе `invalid-metadata-value`. Так ловится `created: <YYYY-MM-DD>`, скопированный из примера, — значение, которое выглядит заполненным и ничего не значит. Свежесть и порядок дат (`updated` не раньше `created`) **не проверяются**, и это намеренно: правило свежести против поля, которое в большинстве заметок отсутствует, проходило бы на пустом множестве и выглядело бы работающей проверкой. Сначала поле должно заполняться, потом появится проверка.

YAML автоматически превращает `created: 2026-09-04` без кавычек в объект `Date`. Функция `normalizeDates()` возвращает такие значения к строке `YYYY-MM-DD`, чтобы остальной код работал со строками.

### `source` вместо `stale`

`stale: true/false` задумывался как ручная отметка «заметка, возможно, отстала от кода». За первые тринадцать задач его не поставили ни разу — так выглядит поле, которое может поддерживать только человек. Ему на смену пришло вычисляемое:

```yaml
source:
  - path: src/analyzer/function-analyzer.ts
    commit: "9442f95"
  - path: src/analyzer/function-analyzer.test.ts
    commit: "9442f95"
```

Каждая запись говорит: «утверждение установлено против этого файла в этом коммите». Тогда вопрос «устарело ли» становится ответимым: `git log <commit>..HEAD -- <path>`. Валидатор задаёт его для каждой записи `source` у `active`-заметок и выдаёт **предупреждение** `stale-source`, если путь с тех пор менялся или коммит не резолвится. Черновики не проверяются: они ничего не утверждают от имени хранилища. Устаревшее свидетельство не делает заметку неверной — оно делает её непроверенной, поэтому сборка не падает. Детальный отчёт по коммитам даёт `Tools/stale-check.mjs`, см. [[Docs/06-Tooling/06-2-Stale-Check-and-Graph-Report]].

Пути в `source` относительны **корню git-репозитория**, а не хранилища. Корень ищет `findRepoRoot()`: ближайший предок с `.git`, начиная с самого хранилища.

### Как читается frontmatter

1. `parseFrontmatter()` берёт блок между первой строкой `---` и следующей `\n---`. Нет блока — `missing-frontmatter`.
2. Блок разбирается `js-yaml`. Не разобрался — `invalid-yaml-frontmatter` с текстом ошибки парсера; прогон не падает.
3. Блок, разобравшийся в скаляр или список, а не в отображение, — тоже `invalid-yaml-frontmatter`.
4. Пустой блок даёт `{}`, после чего срабатывает `missing-required-field` по трём полям.

Это касается только **управляемых** заметок: `isGoverned()` истинно для файлов под `Knowledge-OS/` и `Project-OS/`, кроме `Project-OS/Templates/`, `Knowledge-OS/Dist/` и `Project-OS/Inbox/`. Шаблоны проверяет `checkTemplate()` построчно, без YAML (там `{{date}}` — допустимый плейсхолдер, а YAML разобрал бы его в бессмысленный объект); `Dist/` несёт frontmatter команд Claude Code, другой схемы; `Inbox/` хранит чужой `CLAUDE.md`, перенесённый дословно. `README.md`, `QA.md`, `CHANGELOG.md` и `Docs/` хранилищу принадлежат, но не управляются: frontmatter не требуется, ссылки проверяются.

### Плейсхолдеры в шаблонах

В шаблоне значение поля — либо литерал, допустимый для этого ключа, либо плейсхолдер, который реально подставляет core-плагин Obsidian `templates`: только `{{title}}` и `{{date}}` (`CORE_TEMPLATE_PLACEHOLDERS`). Любой другой — `unfilled-template-placeholder`. Правило появилось после того, как старый шаблон Finding содержал `{{what}}`, который ничем не подставлялся и доезжал до настоящих заметок как есть.

## Почему так

**Закрытый список ключей.** Если ключ можно добавить в одну заметку, со временем у каждой появится свой. Поле, нужное одной заметке, принадлежит её телу. `unknown-metadata-key` делает это правило исполнимым, а не пожеланием; список берётся из `metadataKeys`, так что новый ключ — это осознанная правка схемы.

**Связи не во frontmatter.** Связь имеет смысл в контексте раздела, где о ней говорится, у неё есть направление и тип. Inline-поле в теле это сохраняет и при этом остаётся обычной wikilink-ссылкой, видимой графу и валидатору. См. [[Docs/03-Knowledge-Model/03-5-Relationships-and-Links]].

**`status` обязателен у каждого типа, у которого он есть.** Цена — одна строка `status: active` в заметках без рабочего процесса. Исключение — `product` и `architecture`: у них поле не просто лишнее, а противоречило `lifecycle`, поэтому оно запрещено.

**Даты не проверяются, пока не заполняются.** Это частный случай общего принципа системы: сначала измерить, потом принуждать. Проверка, которая проходит на пустом множестве, хуже отсутствующей — она создаёт ложное чувство покрытия.

**`source` — предупреждение.** Правило, которое валит сборку из-за заметок, которые вполне могут быть верны, отключат через неделю. Именно это и случилось с ручным `stale`, только тише — его просто перестали ставить.

## Пример

Закрытая задача — то, что ритуал закрытия ([[Project-OS/06-AI/AI]], Part 2) приводит в такой вид:

```yaml
---
type: task
status: done
lifecycle: active
evidence: L2
priority: high
created: 2026-08-24
updated: 2026-09-10
source:
  - path: src/parser/index.ts
    commit: "0162e1e"
---
```

Типичные нарушения и ответ валидатора:

```yaml
---
type: research
status: active        # у research нет такого статуса
lifecycle: draft
owner: someone        # ключа нет в metadataKeys
priority: critical    # нет в priorities
---
```

```text
ERRORS (3)
  Project-OS\04-Research\Parser-Notes.md
    [unknown-metadata-key] frontmatter key `owner` is not defined by Metadata Schema
    [invalid-status] status `active` is not allowed for type `research` (expected: open, completed, obsolete)
    [unknown-priority] priority `critical` is not defined by Metadata Schema (expected: high, medium, low)
```

## Подводные камни

- **Короткий SHA из одних цифр YAML читает как число.** `commit: 0162e1e` — строка, а `commit: 1234567` станет числом, ведущие нули при этом теряются. `stale-source` говорит об этом прямо: «commit … was read as the number …; quote the hash». Берите хеш в кавычки. Тот же дефект однажды давал случайно красный тест (исправлено в хелпере тестов `stampCommit`).
- **Переименование цитируемого файла видно.** `git log <commit>..HEAD -- <old path>` показывает коммит переименования (для старого пути это удаление), так что `stale-source` срабатывает и без `--follow`. Перештамповывая заметку, замените в `source` и путь.
- **Вложенный репозиторий.** Если у хранилища свой `.git` внутри проекта, `findRepoRoot()` остановится на хранилище, и коммиты проекта в `source` не разрешатся — каждая такая заметка получит `stale-source` с рождения. В раскладке, где хранилище — просто папка проекта, проблемы нет.
- **Commit в `source` должен содержать изменение.** `git rev-parse HEAD`, прочитанный до коммита, называет родителя — заметка рождается устаревшей. Исправлять поле надо следующим коммитом, а не `--amend`: amend переписывает коммит и уничтожает только что записанный хеш.
- **Раньше `missing-required-field` проверял истинность**, и поле со значением `false` или `0` считалось отсутствующим. Теперь отсутствием считаются только `undefined`, `null` и пустая строка; `status: 0` дальше получит `invalid-status`, то есть верную причину.
- **Раньше значения `stale`, `created`, `updated` не проверялись вовсе**, и `created: вчера` проходил. Теперь форма проверяется (`invalid-metadata-value`); правдоподобие даты — нет: `created: 2099-01-01` пройдёт.
- **`lifecycle` чувствителен к регистру, `type` — нет.** `lifecycle: Active` — это `unknown-lifecycle`, а `type: Task` проходит и виден всем правилам как `task` (см. [[Docs/03-Knowledge-Model/03-1-Entity-Types]]).

## Как менять

- **Новый ключ frontmatter:** добавить его в `metadataKeys` в [[Knowledge-OS/Schema/schema.json]] и описать в [[Knowledge-OS/Schema/Metadata-Schema]] (в Required или Optional, с объяснением, какой автоматизации или маршрутизации он нужен). Если у ключа есть словарь значений — отдельный ключ в `schema.json` и проверка в валидаторе по образцу `priorities` / `unknown-priority`. Без проверки значения новый ключ — свободный текст.
- **Новое значение статуса** — разобранный пример в [[Docs/03-Knowledge-Model/03-7-schema-json]]. Обратите внимание на места, где статусы зашиты вне схемы: `EPIC_TERMINAL_TASK_STATUS` в валидаторе, `CLOSED` и `FREE` в [[Knowledge-OS/Tools/task-lookup.mjs]], фильтры `.base`-файлов.
- **Удаление или переименование значения** ломает существующие заметки — это миграция данных проектов, и секция в [[CHANGELOG]] должна назвать её в разделе «Что валидатор начал требовать».
- Проверка: фикстура и тест (см. [[Docs/06-Tooling/06-6-Tests-and-Fixtures]]), затем полный прогон валидатора.
