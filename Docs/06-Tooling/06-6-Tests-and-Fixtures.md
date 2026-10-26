# 6.6. Тесты и фикстуры

> **Описывает:** [[Knowledge-OS/Tools/run-tests.mjs]], [[Knowledge-OS/Tools/validate-vault.test.mjs]], [[Knowledge-OS/Tools/context-provider.test.mjs]], [[Knowledge-OS/Tools/context-metrics.test.mjs]], [[Knowledge-OS/Tools/adopt.test.mjs]], [[Knowledge-OS/Tools/os-patch.test.mjs]], [[Knowledge-OS/Tools/upgrade.test.mjs]], [[Knowledge-OS/Tools/graph-report.test.mjs]], [[Knowledge-OS/Tools/stale-check.test.mjs]], [[Knowledge-OS/Tools/os-share.test.mjs]], [[Knowledge-OS/Tools/os-check.test.mjs]], [[Knowledge-OS/Tools/run-tests.test.mjs]], [[Knowledge-OS/Tools/entry-budget.test.mjs]], [[Knowledge-OS/Tools/mv.test.mjs]], [[Knowledge-OS/Tools/build-plugin.test.mjs]], [[Knowledge-OS/Dist/hooks/budget-audit.test.mjs]], [[package.json]], [[Knowledge-OS/os-manifest]] (строки `__fixtures__/**`, `__provider_fixtures__/**`)
> **Связано:** [[Docs/06-Tooling/06-1-Validator]] — правила, которые закрепляют фикстуры, [[Docs/06-Tooling/06-5-Context-Provider]] — операции, которые проверяет фикстура провайдера, [[Docs/06-Tooling/06-3-Context-Metrics]], [[Docs/06-Tooling/06-4-Budget-Audit-Hook]], [[Docs/08-Distribution/08-2-Adoption]] — `adopt.mjs`, [[Docs/08-Distribution/08-3-Upstream-Sync-and-Upgrade]] — почему тесты обязаны запускаться в апстриме

## Назначение

Инструменты MemoValeOS — гейты и измерители. Сломанный гейт хуже отсутствующего: он либо пропускает то, ради чего существует, либо краснеет без причины и учит его не читать. Тесты фиксируют поведение инструментов так, чтобы изменение правила без изменения его фикстуры было видно сразу. [[Knowledge-OS/Protocols/Knowledge-Maintenance-Protocol]] говорит прямо: изменение правила без соответствующего обновления фикстуры не проверено.

## Как работает

### Запуск

Только встроенный `node:test` и `node:assert/strict`, без фреймворков, Node ≥ 18. Нужен git в `PATH` — несколько тестов строят временные репозитории. `npm install` нужен ради одной dev-зависимости, `acorn`, которой тесты проверяют синтаксис хука и лаунчера. `js-yaml` раньше тоже требовал `npm install`, а раннеры фикстур искали его в двух местах `node_modules`; теперь он в `Knowledge-OS/Tools/vendor/`, и раннеры просто копируют эту папку рядом с копией инструмента.

```bash
npm test                                                       # всё: 242 теста
node "Knowledge-OS/Tools/run-tests.mjs" --list                  # какие файлы войдут в прогон
node "Knowledge-OS/Tools/run-tests.mjs" validate-vault          # только файлы, в пути которых есть это слово
node --test "Knowledge-OS/Tools/validate-vault.test.mjs"        # 81: 44 из CASES + 37 отдельных
node --test "Knowledge-OS/Tools/context-metrics.test.mjs"       # 37
node --test "Knowledge-OS/Tools/adopt.test.mjs"                 # 29
npm run test:context-provider                                  # 16
node --test "Knowledge-OS/Tools/os-check.test.mjs"              # 12
node --test "Knowledge-OS/Tools/os-patch.test.mjs"              # 5
node --test "Knowledge-OS/Tools/os-share.test.mjs"              # 5
node --test "Knowledge-OS/Tools/upgrade.test.mjs"               # 12
node --test "Knowledge-OS/Tools/graph-report.test.mjs"          # 5
node --test "Knowledge-OS/Tools/stale-check.test.mjs"           # 6
node --test "Knowledge-OS/Tools/run-tests.test.mjs"             # 4
node --test "Knowledge-OS/Tools/entry-budget.test.mjs"          # 2
node --test "Knowledge-OS/Dist/hooks/budget-audit.test.mjs"     # 9
node --test "Knowledge-OS/Tools/mv.test.mjs"                    # 11
node --test "Knowledge-OS/Tools/build-plugin.test.mjs"          # 8
```

`npm test` запускает `run-tests.mjs`, а тот сам находит каждый `*.test.mjs` под `Knowledge-OS/` (кроме `__fixtures__/`, `__provider_fixtures__/`, `node_modules/` и dot-каталогов) и передаёт их одному вызову `node --test` — через `process.execPath`, то есть тем же Node, которым запущен. До 2026-10-25 скрипт `test` в [[package.json]] перечислял файлы вручную, и новый тестовый файл не попадал в прогон, пока его не дописывали. Собственный поиск, а не glob самого `node --test`: glob там появился только в Node 21.

Тесты — одна из шести проверок `npm run os:check` ([[Knowledge-OS/Tools/os-check.mjs]]), которая собирает определение готовности изменения ОС ([[Docs/10-Extending]], «Готово, когда»).

| Файл | Что проверяет | Как изолирован |
|---|---|---|
| `validate-vault.test.mjs` | каждое правило валидатора, отсутствие ложных срабатываний, обе раскладки для `stale-source`, остановку на невалидном `schema.json` | копия фикстуры во временный каталог, валидатор запускается процессом с `--json` |
| `context-provider.test.mjs` | все шесть операций, бюджеты, фильтр жизненного цикла до бюджета, обязательный `requires_human` для `decision`/`architecture`/`rule`/`intent`, `user-provided` только для `intent`, уникальный `suggested_path`, отказ записи, CLI | копия `__provider_fixtures__/basic` во временный проект с git-коммитом; вызов `handleRequest` напрямую |
| `context-metrics.test.mjs` | арифметика `analyseCache`, атрибуция разрывов, `migrateHeader`, `upsertRow`, `bashTouchesVault`, `shellReadPaths` (что считается путём чтения в Bash и PowerShell, а что — шаблоном, числом или перенаправлением) | чистые функции, импорт модуля; транскрипты не читаются |
| `os-share.test.mjs` | разбор `--numstat`, коммит с одним путём ОС — коммит ОС, строки ОС отдельно от прочих, ISO-недели, коммит вне хранилища не считается | чистые функции, синтетический журнал git |
| `adopt.test.mjs` | план без `--apply`, что развёртывание оставляет нетронутым (агенты хоста, чужие команды, нечитаемый `settings.json`, собственный `CLAUDE.md` хранилища в самостоятельной раскладке), имя папки хранилища в редиректе, хук в exec-форме, замена старой записи `budget-audit.mjs` на месте и схлопывание дублей | временный проект с минимальным хранилищем (только `Dist/` и сам `adopt.mjs`) |
| `os-patch.test.mjs` | разбор `name-status`, отбор путей по манифестам обеих сторон; в патче нет заметок проекта и исходного кода, удаление файла, выведенного из манифеста, патч применяется `git apply --3way` к самостоятельной копии со своим `Project-OS`, отказ на несуществующем теге | чистые функции импортом; интеграционные случаи — настоящий проект с хранилищем в `V/` и тегом базы, скрипт скопирован неотслеживаемым |
| `upgrade.test.mjs` | три стороны: с записанной базой неизменённое обновляется, добавляется и удаляется; изменённое только здесь остаётся; изменённое на обеих сторонах — конфликт с `.mvos-new` и код 2, а с базой-содержимым — чистое слияние; без базы всё различное — конфликт, `--yes` берёт новое; свои файлы копии, `mvos.config.json` и `!`-исключённый шаблон не трогаются; план ничего не пишет; откат файл за файлом (код 3) при росте ошибок старого правила и при скрипте, который не разбирается, `--accept-errors`; ошибки нового правила — миграция, `deployed-command-drift` — шаг владельца; шаги владельца по режиму записи установки; ни в одном инструменте нет байта NUL | обычные каталоги без git: копия со скриптом и `manifest.mjs`, новая версия, база; поддельный валидатор, который сообщает ошибку на каждый токен `ERR:<правило>` |
| `graph-report.test.mjs` | связь в пункте списка — типизированное ребро, ссылка в коде — не ребро, ссылка с путём разрешается как у валидатора (без отката на имя файла), шаблоны, `Dist/` и фикстуры не обходятся, компоненты и достижимость, откат точки входа на `Knowledge-OS/README.md` и `--from` | временное хранилище, запуск процессом с `--json` |
| `stale-check.test.mjs` | `stale` против нетронутого файла в обеих раскладках, путь, которого никогда не было, неизвестный коммит, шаблоны и `Dist/` не проверяются | временный репозиторий с двумя коммитами, junction на `node_modules` |
| `budget-audit.test.mjs` | синтаксис ECMAScript 2017 (`acorn`), запись журнала, `declared`/`withinBudget`, субагенты, выживание на мусоре и на JSON, который не объект | временный корень через `CLAUDE_PROJECT_DIR` |
| `mv.test.mjs` | синтаксис ECMAScript 5 (`acorn`); выбор Node: текущий, самый новый ≥ 18 при старом текущем, явный `MVOS_NODE` и отказ при слишком старом, «ничего подходящего»; поиск в деревьях nvm и nvm-windows; CLI — код выхода инструмента насквозь, неизвестный инструмент (2), нет Node (3), `doctor` | чистые функции через `createRequire`; фиктивное дерево nvm во временном каталоге; CLI процессом |
| `build-plugin.test.mjs` | закоммиченный плагин совпадает с тем, что генератор пишет из `Dist/commands/` (`--check`); форма обёртки; обёртка на каждый исходник, имя без `mv-`; `--check` называет устаревший файл, пересборка его чинит; запуск хука плагина — синтаксис ES2017, находит хранилище под именем `MemoValeOS/` и под другим, без хранилища — выход 0 | чистые функции импортом; копия `Dist/` во временном хранилище; запуск хука процессом с `CLAUDE_PROJECT_DIR` |
| `os-check.test.mjs` | правило «код вместе с документацией»: какие пути считаются кодом (тесты и фикстуры — нет), трейлер `Docs: none — <причина>` только с причиной, `CHANGELOG.md` в любом коммите диапазона; через настоящий git в обеих раскладках — проходящий и падающий диапазон, коммиты вне хранилища не в счёт; неизвестный шаг `--skip` | чистая функция `checkDocsWithCode` импортом; интеграционные случаи — временный репозиторий, копия `os-check.mjs` в нём, остальные шаги пропущены `--skip` |
| `run-tests.test.mjs` | в список попадает каждый `*.test.mjs` рядом с инструментами и тест хука; не попадают файлы в фикстурах, dot-каталогах и `node_modules`; `--list` и фильтр; фильтр без совпадений — выход 1 | `findTestFiles(vault)` на временном дереве; CLI процессом |
| `entry-budget.test.mjs` | размер входных файлов, которые каждая сессия грузит до задачи: `CLAUDE.md` хранилища ≤ 3072 байт, `Dist/CLAUDE.redirect.md` ≤ 512 байт (считается после нормализации CRLF) | чтение файлов; если `CLAUDE.md` в копии нет — тест пропускается |

### Фикстуры валидатора: одно нарушение на фикстуру

`Knowledge-OS/Tools/__fixtures__/<имя>/` — минимальное дерево `Knowledge-OS/` + `Project-OS/` (и при необходимости `Docs/`, `.claude/`, `os-manifest`, `.mvignore`), в котором есть **ровно одно** нарушение. Шапка теста формулирует принцип: правило, сработавшее по неверной причине, сломано так же, как не сработавшее вовсе.

`runFixture(name, prepare)`:

1. Создаёт `mkdtemp` и копирует фикстуру в `<tmp>/vault` — на уровень ниже, чтобы `<tmp>` мог играть роль репозитория, содержащего хранилище.
2. Вызывает необязательный `prepare(vault)` (например, построить git-историю).
3. Докладывает **настоящие** `Knowledge-OS/Schema/schema.json` и `validate-vault.mjs`: фикстуры остаются маленькими и не могут разойтись со схемой, по которой проверяются.
4. Копирует `Knowledge-OS/Tools/vendor/` (с `js-yaml.mjs`) рядом с копией валидатора — `withVendor(vault)`. Раньше здесь был junction на `node_modules`, найденный в одном из двух мест (своём или поднятом npm workspace в корень): жёсткий путь однажды уронил все фикстуры на свежем клоне. У копии `vendor/` угадывать нечего. Фикстуры со своим `os-manifest` поэтому несут строку `Knowledge-OS/Tools/vendor/**`.
5. Запускает валидатор с `--json`; ненулевой код ожидаем — JSON берётся из `e.stdout`.
6. Удаляет временный каталог.

`runFixtureStandalone` — то же, но git инициализируется **внутри** хранилища: раскладка апстрима, где хранилище — корень репозитория. Пока все фикстуры были вложенными, ошибка `REPO_ROOT = dirname(VAULT)` выживала, потому что была верна в единственной проверявшейся форме.

`withGitHistory(vault, seed, then)` делает два коммита (`seed`, затем `then`) в `<tmp>` — корне репозитория, который `findRepoRoot` найдёт от хранилища, — и возвращает короткий хеш первого; `withGitHistoryStandalone` делает то же внутри хранилища. `stampCommit` подставляет хеш вместо `__COMMIT__` в `Project-OS/Parser-Note.md` фикстуры — **в кавычках**: короткий SHA из одних цифр YAML прочитает как число (валидатор на такой записи говорит «quote the hash»), и тест будет случайно падать.

### `CASES`, отдельные тесты и тест покрытия

- **`CASES`** — массив пар `[фикстура, ожидаемое правило]`. Для каждой генерируется тест `"<фикстура> fixture triggers <правило>"`, проверяющий, что правило есть среди ошибок и предупреждений. Имя фикстуры обычно совпадает с правилом; исключения — когда одно правило проверяется в разных местах или фикстура закрепляет способ, которым правило достаёт данные: `claude-broken-link`, `docs-broken-link` и `path-link-wrong-folder` → `broken-link`, `user-provided-not-allowed-for-architecture` → `below-evidence-floor`, `list-item-relationship-field` → `unknown-relationship-field`, `lifecycle-behind-status-epic`, `-task`, `-decision` и `task-type-case-insensitive` → `lifecycle-behind-status`.
- **Негативные фикстуры** — отдельные тесты, утверждающие отсутствие находок (обычно `errors: []` и `warnings: []`): `clean`, `blocking-uncertainty-basename-collision`, `uncertainty-example-in-code` (таблица реестра в блоке кода — не живая строка; проверяются только ошибки), `deployed-command-clean`, `docs-link-target`, `foreign-tree`, `mvignore-honored`, `os-layer-manifest-complete`, `orphaned-note-linked`, `epic-status-open-tasks`, `lifecycle-behind-status-clean`, `product-user-provided-evidence`, `stale-source-current`, `md-link-clean` (все законные формы Markdown-ссылки и исключённый `Plans/`), `docs-link-inside-os-layer` (всё, на что `Docs/` вправе ссылаться), `undocumented-os-file-clean` (каждый вид файла ОС упомянут так, как его пишет страница). У трёх правил определения готовности — `broken-md-link`, `docs-link-outside-os-layer`, `undocumented-os-file` — позитивные фикстуры проверяются строже `CASES`: «ровно одна ошибка, и это она». Ограничить правило правильно, только если оно по-прежнему срабатывает там, где должно, — поэтому у сужения области всегда пара: `foreign-tree` (ничего не сообщается о чужом дереве) и `claude-broken-link` (битая ссылка в развёрнутой `mv-*` всё ещё ловится).
- **Тесты уровня** — что правило именно предупреждение, а не ошибка: `orphaned-note`, `deployed-command-missing`, `mvignore-line-unused`, `stale-source`, `scaffold` на черновике («scaffold is a warning on a draft, not an error»); и что шаблон `Finding` без `evidence` даёт **только** `missing-evidence-for-active`.
- **Тесты схемы** «an invalid schema.json stops the run with the reason» и «an activeLifecycleStatuses entry naming a status the type lacks stops the run» — собирают временное хранилище с `schema.json`, где в `statusByType` опечатка (`tsak`) или в `activeLifecycleStatuses.decision` статус, которого у типа нет (`acepted`), и ждут код выхода `2` и причину в stderr.
- **Два теста покрытия, в обе стороны.** `every fixture directory under __fixtures__ is covered by a case` — каталоги `__fixtures__/`, которых нет ни в `CASES`, ни в множестве `covered`, роняют прогон: фикстура без теста — мёртвый груз, который выглядит как проверка. `every rule the validator reports has a fixture case` — обратное: идентификаторы правил извлекаются из вызовов `err`/`warn` в исходнике валидатора, и каждый должен быть в `CASES` или в списке правил, покрытых отдельными тестами (`deployed-command-missing`, `mvignore-line-unused`, `stale-source`).
- **Тест документации правил.** `every rule the validator reports has a row in the Docs/06-1 rule table` — те же идентификаторы сверяются со строками таблиц правил в [[Docs/06-Tooling/06-1-Validator]] (строка, которая начинается с идентификатора в обратных кавычках и уровня `error` или `warning`), в обе стороны: правило без строки и строка без правила роняют прогон.

Валидатор сам не сканирует `__fixtures__` и `__provider_fixtures__` (`NEVER_WALK`): каждая фикстура невалидна по замыслу. При этом обе папки входят в [[Knowledge-OS/os-manifest]] и доставляются в апстрим вместе с тестами.

### Фикстура провайдера

`Knowledge-OS/Tools/__provider_fixtures__/basic/` — одно небольшое хранилище для всех тестов провайдера:

| Файл | Роль |
|---|---|
| `CLAUDE.md` | обязательный контекст, без frontmatter |
| `Knowledge-OS/Protocols/Context-Selection-Protocol.md` | обязательный контекст |
| `Project-OS/05-Decisions/Decisions.md` | `decision`, `active`, `L2` — основная точка входа; заголовок `Decisions` даёт дубль для `propose_knowledge` |
| `Project-OS/04-Research/Draft-Note.md` | `lifecycle: draft` → `draft_sources` |
| `Project-OS/04-Research/Superseded-Note.md` | `lifecycle: superseded` → пропуск по жизненному циклу |
| `Project-OS/99-Unrelated/Do-Not-Load.md` | вне точек входа в первом тесте; `stale: true` → `stale_sources`, когда её называют явно |
| `Docs/Provider-Docs-Page.md` | никогда не должна выдаваться (`isWrittenForPeople`) |

`withFixture()` копирует её в `<tmp>/MemoValeOS`, делает `git init` и коммит в `<tmp>` (провайдер требует ревизию `HEAD`) и передаёт корни в `handleRequest` с фиксированными часами `now: () => "2026-09-12T10:00:00Z"` — поэтому идентификаторы и даты в ответах детерминированы. Протокол прямо называет этот тестовый файл исполняемым справочником точных форм запросов и ответов.

### Тесты чистых функций

`context-metrics.mjs` экспортирует `analyseCache`, `bashTouchesVault`, `migrateHeader`, `upsertRow` и не запускает `main()` при импорте (сравнение `realpath(process.argv[1])` с путём модуля; тот же приём в провайдере). Ряды для `analyseCache` строятся хелперами `r(cacheRead, cacheCreation, input)` и `rt(cacheRead, minutes, extra)`; эталонные суммы взяты из независимого подсчёта по реальным сессиям, а не из вывода самой функции.

## Почему так

**Одно нарушение на фикстуру.** Если в фикстуре два нарушения, тест «правило X сработало» пройдёт и тогда, когда X сработало из-за второго. Минимальное дерево с одной ошибкой делает причину однозначной.

**Настоящие схема и валидатор, копируемые при запуске.** Фикстуры со своей копией `schema.json` проверяли бы старую схему. Копирование в момент запуска делает каждую фикстуру проверкой текущего кода против текущего словаря.

**Временные каталоги, никогда — живые данные.** Ранняя версия теста хука работала с настоящим `.claude/` и начиналась с удаления журнала `budget-audit.jsonl` — единственной копии всех записанных чтений; спасло только то, что тест падал раньше. С тех пор каждый тест создаёт свой корень и удаляет его в `finally`.

**Тесты запускаются в апстриме, а не читаются.** Доставка однажды увезла три фикстуры без половины содержимого: `dist/` в `.gitignore` без учёта регистра на Windows совпадал с `__fixtures__/*/Knowledge-OS/Dist/`. Локально всё было зелёным — файлы лежали на диске. Упало у того, кто клонировал. Отсюда требование `/mv-sync` прогонять тесты в апстриме после доставки.

**Исторический сигнал.** Когда апстримную версию валидатора прогнали против локальных тестов, упали четыре — включая `blocking-uncertainty-basename-collision`, воспроизводивший ровно ту ложную коллизию по basename, которую здесь чинили. Тесты оказались способом сравнить две версии инструмента без чтения диффа.

## Пример

Добавить тест на новое правило валидатора `updated-before-created` (код правила — в [[Docs/06-Tooling/06-1-Validator]]):

```text
Knowledge-OS/Tools/__fixtures__/updated-before-created/
  Knowledge-OS/README.md
  Project-OS/Note.md
```

`Knowledge-OS/README.md`:

```markdown
---
type: readme
status: active
lifecycle: active
---
# Fixture readme

Links [[Project-OS/Note]] so the note is not an orphan.
```

`Project-OS/Note.md`:

```markdown
---
type: research
status: open
lifecycle: draft
created: 2026-09-10
updated: 2026-09-01
---
# Note

Body text so this is not a scaffold.
```

В `validate-vault.test.mjs`:

```js
const CASES = [
  // …
  ["updated-before-created", "updated-before-created"],
];
```

Если правило рискует ложными срабатываниями — вторая фикстура `updated-equals-created` и тест:

```js
test("updated-equals-created fixture triggers no false positive", () => {
  const report = runFixture("updated-equals-created");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});
```

и её имя в множество `covered` теста покрытия. Затем `npm test`.

Тест провайдера — по образцу существующих: `withFixture`, `request(operation, payload, adapterExtensions)`, `plan(overrides)`, утверждения о `status`, `errors[0].code` и полях `payload`. Новый файл, нужный тесту, добавляется в `__provider_fixtures__/basic/` — и надо проверить, не ломает ли он ожидания других тестов (например, точный список `paths` в первом тесте `prepare_context`).

## Подводные камни

- **Раньше покрытие правил было неполным и это было невидимо.** У `epic-status-ahead-of-tasks`, `scaffold` и `undeployed-command-source` не было фикстур, а тест покрытия проверял только «каждая фикстура имеет тест». Теперь фикстуры есть, и обратный тест не даст правилу снова остаться без фикстуры. Его извлечение — регулярное выражение по исходнику: вызов, чей первый аргумент содержит скобки (как у `undeployed-command-source` с файлом `(.claude) …`), оно не видит, так что для такого правила фикстуру надо не забыть самому.
- **Позитивные тесты из `CASES` проверяют только включение**, а не исключительность: в фикстуре может сработать и второе правило (например, `orphaned-note` в `below-evidence-floor`, где на заметку никто не ссылается), и тест этого не заметит.
- **Фикстуры без `os-manifest` и `Dist/`** не задействуют проверки манифеста и развёртывания — эти проходы молча пропускаются. Нужны отдельные фикстуры с этими файлами (как `os-layer-outside-manifest`, `deployed-command-*`).
- **Окончания строк.** Git на Windows предупреждает о LF→CRLF при коммите фикстуры провайдера; на результат это не влияет, потому что дайджесты считаются по файлам после копирования, но сравнение `migrateHeader` с заголовком специально делается после `trimEnd` — CRLF однажды давал «миграцию» на каждом запуске.
- **Тестовый файл вне `Knowledge-OS/` не найдётся.** `run-tests.mjs` ищет только там; тест, положенный, например, в корень хранилища, тихо не запустится. `test:context-provider` — отдельный скрипт для того же файла, что уже входит в `npm test`.

## Как менять

- **Новое правило валидатора** — фикстура с одним нарушением, строка в `CASES` (без неё упадёт тест «every rule the validator reports has a fixture case»); при риске ложных срабатываний — негативная фикстура, отдельный тест и запись в `covered`. Новые каталоги под `__fixtures__/` уже покрыты манифестом (`Knowledge-OS/Tools/__fixtures__/**`).
- **Изменение формы ответа провайдера** — сначала тест (он и есть спецификация для потребителей), затем код, затем [[Knowledge-OS/Protocols/Context-Provider-Protocol]] и [[Knowledge-OS/Schema/Provider-Mapping]].
- **Новый тестовый файл** — положить под `Knowledge-OS/` с именем `*.test.mjs`; `run-tests.mjs` найдёт его сам. Если он вне `Knowledge-OS/Tools/*.mjs` и `Knowledge-OS/Dist/**` — строка в [[Knowledge-OS/os-manifest]], иначе валидатор даст `os-layer-outside-manifest`, а доставка его не увезёт.
- **Новый каталог тестовых хранилищ** — добавить в `NEVER_WALK` валидатора (и провайдера, `stale-check.mjs`, `graph-report.mjs`), иначе его невалидные заметки станут находками живого хранилища.
- После доставки в апстрим — прогнать `npm test` там (см. [[Docs/08-Distribution/08-3-Upstream-Sync-and-Upgrade]]). Количество тестов полезно упоминать в [[CHANGELOG]]: оно уже служило сигналом того, что доставка увезла не всё.
