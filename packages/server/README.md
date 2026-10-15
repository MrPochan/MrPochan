# @cupquest/server

HTTP-сервер «Кубкового квеста» на Fastify 5. Проверяет вход, выдает сид дня и сиды забегов, принимает
забеги, ведет леджер, энергию и недельную доску. Игровые правила берутся из `@cupquest/core`.

Ссылки на разделы ТЗ: AUTH-, DB-, API-, SEC-, ECO-, CARD-, ERR-, RNG-. Пути API совпадают с ТЗ 5.3.

## Статус итерации

Сделано: вход через Telegram initData и гостевой вход, токены устройств, леджер, энергия, сид дня,
старт и отправка забега с проверками SEC-001..SEC-006, недельная доска, каталог и флаги.

Не входит в эту итерацию (см. «Допущения», раздел «Вне итерации»): PostgreSQL (сейчас репозиторий в памяти),
оплата Stars, Telegram Login widget, друзья и рефералы, дневная доска, квесты, серия входа, герои за покупку,
связка `/link`, лимиты частоты.

## Запуск

```bash
npm install                                  # из корня, один раз
npm run dev -w packages/server               # tsx watch, порт 8787
npm start -w packages/server                 # без перезагрузки
npm run build -w packages/server             # tsc, проверка типов перед запуском (эмита JS нет, см. «Вне итерации»)
```

Переменные окружения:

| Имя | По умолчанию | Смысл |
|---|---|---|
| `PORT` | `8787` | порт HTTP |
| `BOT_TOKEN` | нет | токен бота, основа HMAC в AUTH-001. Обязателен при `NODE_ENV=production`. Без него в разработке вход через Telegram отключен (`auth.invalid`), работает только гостевой вход |
| `NODE_ENV` | `development` | `development`, `test` или `production` |
| `MIN_CLIENT_VERSION` | `0.1.0` | минимальная версия клиента для `X-Client-Version` (API-000, `client.too_old`) |
| `CORS_ORIGINS` | пусто | точные origin через запятую, которым разрешен вызов API из браузера (статика и API на разных хостах, ТЗ 3). Пример: `https://game.example.com`. Пусто: заголовков CORS нет |

Фоновый проход ERR-006 запускается в `main.ts` раз в минуту (`sweepIntervalMs`); в тестах он не включен.

Сервер при запуске без обязательных переменных завершается с сообщением `configuration error`.

## Проверки

```bash
npm test -w packages/server          # vitest run, тесты через app.inject
npm run typecheck -w packages/server # tsc -p tsconfig.json, strict
npm run build -w packages/server     # то же, что typecheck: сборка сервера на Node 22 проверяется этим шагом
```

## Соглашения API

- База: `/api/v1`. Здоровье: `GET /health` (без базы, без заголовков).
- Заголовок `X-Client-Version: <major.minor.patch>[+суффикс]` обязателен на всех запросах. Нет или не semver — `validation.failed` (400), ниже минимума — `client.too_old` (426).
- Авторизация: `Authorization: Bearer <device_token>`. Нет заголовка — `auth.required` (401), неизвестный или отозванный токен — `auth.invalid` (401).
- `Idempotency-Key` (1..128 символов) обязателен на `POST /runs/start` и `POST /runs/submit`. Повтор с тем же телом возвращает сохраненный ответ, с другим телом — `idempotency.conflict` (409). Сохраняются только ответы 2xx.
- Все ответы с `Cache-Control: no-store`.
- Ошибка: тело `{ "code": "домен.причина" }` без текста. Текст берет клиент по ключу `err.<code>` (LOC-002).
- Время в секундах unix, UTC. Поля в `snake_case`.

## Эндпоинты

| Метод и путь | Токен | Назначение |
|---|---|---|
| `GET /health` | нет | живость сервиса |
| `GET /api/v1/config` | нет | версия, флаги, наборы (API-005) |
| `GET /api/v1/shop` | нет | каталог наборов и `payments_enabled` (PAY-008; не из ТЗ 5.3, см. Допущения) |
| `POST /api/v1/auth/telegram` | нет | вход через initData (API-001) |
| `POST /api/v1/auth/guest` | нет | гостевой аккаунт и токен (API-002) |
| `GET /api/v1/me` | да | профиль, балансы, герои (API-006) |
| `GET /api/v1/energy` | да | энергия и таймер (API-007) |
| `GET /api/v1/seeds/daily` | да | сид дня D по UTC (API-008) |
| `POST /api/v1/runs/start` | да, ключ | старт забега, трата 1 энергии (API-009) |
| `POST /api/v1/runs/submit` | да, ключ | отправка забега, проверки (API-010) |
| `GET /api/v1/board/weekly` | да, не гость | недельная доска: игрок и друзья (API-016) |

Примеры (тела сокращены; `…` — значения, которые зависят от запроса).

`POST /api/v1/auth/telegram`, заголовки `X-Client-Version: 0.1.0`
```json
{ "init_data": "user=%7B%22id%22%3A42%7D&auth_date=…&hash=…", "install_id": "a8f3c1d2e4b5" }
→ 200 { "device_token": "uH1m…43 символа", "created": true,
        "user": { "id": "bb3c…", "is_guest": false, "referral_code": "REAJVCRE" } }
→ 401 { "code": "auth.invalid" }      подпись не совпала
→ 401 { "code": "auth.expired" }      auth_date старше 86 400 с
```

`POST /api/v1/auth/guest`
```json
{ "install_id": "a8f3c1d2e4b5" }
→ 200 { "device_token": "…", "user": { "id": "…", "is_guest": true, "referral_code": "CIJ5LCH2" } }
```

`GET /api/v1/me`
```json
→ 200 { "user": { "id": "…", "is_guest": true, "referral_code": "CIJ5LCH2" },
        "balances": { "coin": 55, "gem": 0 },
        "heroes": [ { "id": "archer", "level": 1 }, { "id": "knight", "level": 1 }, { "id": "mage", "level": 1 } ],
        "quests": [], "streak": { "day_no": 1, "claimed_today": false }, "starter_bought": false }
```

`GET /api/v1/energy`
```json
→ 200 { "e": 4, "max": 5, "period_s": 1200, "next_in_s": 1180, "server_time": 1792000020 }
```

`GET /api/v1/seeds/daily`
```json
→ 200 { "day": "2026-10-15", "seed": "00112233445566778899aabbccddeeff", "field_version": 1 }
```

`POST /api/v1/runs/start`, `Idempotency-Key: k-1`
```json
{ "mode": "full", "speed": 1, "team": ["knight", "archer", "mage"], "daily": false }
→ 200 { "run_id": "6f1c…", "seed": "9a…32 hex", "daily": false,
        "energy": { "e": 4, "t": 1792000000 }, "field_version": 1,
        "reserved_gems": 0, "help_card": null, "started_at": 1792000000 }
→ 422 { "code": "energy.empty" }
→ 422 { "code": "hero.locked" }        герой не открыт (Друид)
→ 409 { "code": "run.active" }         открыт другой забег
```
Для `"daily": true` в ответе есть `"day": "2026-10-15"`, а сид равен сиду дня.

`POST /api/v1/runs/submit`, `Idempotency-Key: k-2` (фрагмент, полный состав в контрактах)
```json
{ "run_id": "6f1c…", "result": "loss", "last_wave": 3,
  "waves": [ { "w": 1, "coins": 25, "balls": 10, "spend": 0 }, { "w": 2, "coins": 30, "balls": 0, "spend": 5 } ],
  "gates": { "x0": 1, "x1": 1, "x2": 0, "x3": 0, "x5": 0 }, "score": 65, "duration_ticks": 1000,
  "resurrections": 0, "cards": [ { "card_id": "knight_01", "tier": 1 } ],
  "log": "…", "log_sha256": "…64 hex…" }
→ 200 { "run": { "id": "6f1c…", "state": "verified", "result": "loss", "last_wave": 3, "score": 65 },
        "rewards": { "coins": 55, "gems": 0, "balls_burned": 5 },
        "balances": { "coin": 55, "gem": 0 } }
→ 200 { "run": { "id": "…", "state": "flagged", "result": "loss", "last_wave": 3, "score": 65 },
        "verdict_reason": ["duration_min"],
        "rewards": { "coins": 0, "gems": 0, "balls_burned": 0 }, "balances": { "coin": 0, "gem": 0 } }
→ 422 { "code": "run.invalid" }             структура: last_wave, победа без 15-й волны, waves, log_sha256
→ 409 { "code": "run.already_submitted" }
→ 409 { "code": "run.timeout" }             прошло больше 30 мин от старта (ERR-006)
→ 404 { "code": "run.not_found" }
```

`GET /api/v1/board/weekly`
```json
→ 200 { "week": "2026-W42",
        "entries": [ { "rank": 1, "name": "Игрок", "wave": 5, "score": 100, "is_me": false },
                     { "rank": 2, "name": "Игрок", "wave": 5, "score": 90, "is_me": true } ],
        "me": { "rank": 2, "wave": 5, "score": 90 } }
→ 403 { "code": "guest.forbidden" }
```

`GET /api/v1/shop` и `GET /api/v1/config`
```json
→ 200 { "payments_enabled": false,
        "packs": [ { "id": "gems_a", "stars": 50, "gems": 60, "name_key": "shop.pack_a.name" },
                   { "id": "gems_b", "stars": 150, "gems": 200, "name_key": "shop.pack_b.name" },
                   { "id": "starter", "stars": 100, "gems": 100, "name_key": "shop.starter.name" } ] }
```

## Что проверяет submit (ТЗ 5.5)

Структурные нарушения (`run.invalid`, 422, ничего не сохраняется): `last_wave` вне 1..15 (1..5 в `short5`),
победа не на последней волне, число записей `waves` не равно числу пройденных волн, `log_sha256` не совпадает с `log`,
неизвестная карта.

Побег (`abandon`, ОВ-2) может прийти после боевой победы текущей волны и до ее броска (шаги выбора карты и поля):
текущая волна тогда записана с монетами, но без ворот. Поэтому число записей `waves` при побеге равно числу
бросков (сумма счетчиков `gates`) или на одну больше. Для `win` и `loss` правило прежнее.

Подозрительные значения делают забег `flagged` с `verdict_reason` (ошибки нет, проводок нет, в доску не попадает):

| Причина | Правило |
|---|---|
| `duration_min` / `duration_max` | длительность вне `[D_min, D_max]` (SEC-002) |
| `score_cap` | монеты волны больше `coinsForWin(w)` или шары волны больше 50 (SEC-003) |
| `score_mismatch` | `score` не равен сумме монет и шаров |
| `gates_count` | сумма ворот не равна числу пройденных шагов поля |
| `gates_balls` | шары не равны `Σ ballsForGate(gate)` по счетчикам ворот (ECO-006) |
| `spend_over` | траты волны больше шаров предыдущих волн минус траты предыдущих (SEC-004) |
| `res_unreserved` | воскрешение без резерва 10 гемов, по резерву при старте, а не по текущему балансу (SEC-005) |
| `gems_negative` | при резерве воскрешение списало бы баланс гемов ниже нуля (проверка баланса, отдельная причина; баланс берется из леджера) |

Если забег `verified`, проводки пишутся в одной транзакции: `run:<id>:w<w>:coin`, `…:ball`, `…:spend`, `…:burn`,
а при воскрешении `…:res` (−10 гемов). Недельная строка обновляется, только если результат лучше.

Сервер не пересчитывает бой и поле. Подделка волны в пределах потолков проходит (SEC-007).

## Структура

| Файл | Содержимое |
|---|---|
| `src/config.ts` | переменные окружения |
| `src/auth.ts` | проверка initData (AUTH-001), токены устройств (AUTH-002) |
| `src/seed.ts` | сид дня и сиды забегов |
| `src/calendar.ts` | UTC-день и ISO-неделя |
| `src/validation.ts` | проверки забега SEC-001..SEC-005 |
| `src/settlement.ts` | проводки проверенного забега |
| `src/board.ts` | порядок недельной доски и правило «лучше» |
| `src/idempotency.ts` | `Idempotency-Key`, хеш тела |
| `src/service.ts` | сценарии: вход, профиль, энергия, забег, доска |
| `src/store/repository.ts` | интерфейс репозитория и записи |
| `src/store/memory.ts` | реализация в памяти |
| `src/routes/*.ts`, `src/http.ts` | маршруты, ошибки, версия клиента, guards |
| `src/app.ts`, `src/main.ts` | сборка приложения и запуск |

## Допущения

1. **Пути API.** Задача назвала `/daily-seed`, `/leaderboard/weekly`, `/shop`, `/health`. Задача также требует совпадения с ТЗ 5.3,
   поэтому сервер отдает `/seeds/daily` (API-008) и `/board/weekly` (API-016). Каталог наборов по ТЗ публикуется в `/config` (PAY-008);
   отдельный `/shop` добавлен по задаче и отдает то же самое, что `flags.payments_enabled` и `packs`. `/health` вне `/api/v1`.
2. **Эндпоинты сверх списка задачи.** `POST /runs/start` (без него нет `run_id` и сида), `GET /energy` (нужен клиенту для таймера) и
   `GET /board/weekly` (тот же путь ТЗ). Остальные эндпоинты ТЗ 5.3 не реализованы (см. «Вне итерации»).
3. **Коды вне ТЗ 5.3.** `run.active` (409): второй открытый забег (DB-007). `run.timeout` (409): отправка позже 30 мин от старта (ERR-006).
   Коды HTTP и тело ошибки по ERR-001.
4. **Правило трат (SEC-004) важнее примера.** Пример в ТЗ 5.3 с `spend: 5` на волне 1 не проходит SEC-004: на волне 1 шаров нет.
   Сервер следует SEC-004: траты волны w покрываются шарами волн до w.
5. **Побег (`abandon`).** Число записей `waves` равно числу бросков или на один больше (см. «Что проверяет submit»). Это определение
   добавлено сюда: в ТЗ правила на число записей для побега нет, а клиент присылает текущую волну с монетами. Для проверки
   структуры `gates` сумма счетчиков — число бросков; `gates_count` сравнивает ее с `last_wave − 1` (SEC-003). Тесты: `runs.test.ts`
   (побег в шагах выбора карты, поля и боя), `validation.test.ts`.
6. **Причина `gates_count`.** SEC-003 перечисляет `score_cap`, `score_mismatch`, `gates_balls`. Согласованность числа ворот с
   числом шагов вынесена в отдельную причину.
7. **Гемы при воскрешении.** `res_unreserved` смотрит только на резерв, снятый при старте (SEC-005). Отдельная причина
   `gems_negative` ставится, если при резерве текущий баланс гемов меньше 10. Ее смысл — не дать балансу уйти ниже нуля
   (ECO-010); в этой итерации гемы не тратятся внутри забега, поэтому причина не срабатывает на реальных данных.
8. **Счетчик помощи (CARD-007).** Меняется только у `verified` забегов. Ветка «`help_card` при трех поражениях» отдает карту из ядра `helpCard`.
9. **Таймаут (ERR-005, ERR-006).** Забег, открытый больше 30 мин, закрывается как `timeout` тремя путями: фоновый проход раз в минуту
   (`closeExpiredRuns`), закрытие при следующем старте и закрытие при отправке. Отправка такого забега отвечает `409 run.timeout`, а
   закрытие сохраняется (ответ с ошибкой не откатывает транзакцию). Энергия не возвращается.
10. **Гемы.** В этой итерации гемы не поступают ни из одного источника (покупки, квесты, серия и рефералы вне итерации). Резерв воскрешения
    всегда 0, воскрешение недоступно, пока нет источника гемов. Проверяется тестом через прямую запись в леджер.
11. **Заглушки `/me`.** `quests` — `[]`, `streak` — `{day_no: 1, claimed_today: false}`, `starter_bought` — `false`.
12. **Доска.** Строки только у игрока и его друзей. Друзей нет (рефералы вне итерации), поэтому доска содержит игрока. Порядок: волна по убыванию,
    очки по убыванию, время лучшего забега по возрастанию (DB-013), затем id пользователя. Ранг — позиция в списке, одинаковых рангов нет.
    Имя: `display_name`, в MVP он не заполняется из Telegram (DB-018, «по желанию»), поэтому в доске «Игрок».
13. **Telegram initData.** Порядок ключей и декодирование значений в data-check-string по AUTH-001 [Проверить по документации Telegram].
    Тесты подписывают initData тем же алгоритмом, поэтому официальный вектор Telegram не проверен. Отклонение
    `auth_date` более чем на 60 с в будущее дает `auth.invalid`, это решение не записано в ТЗ.
14. **Вход и токены.** Каждый вход через Telegram выдает новый токен и отзывает прежний `telegram` с тем же `device_hash` (AUTH-002).
    Гостевой вход создает новый аккаунт при каждом вызове. Токен хранится только как SHA-256 hex (`devices.token_hash`).
15. **`install_id`.** Значение с 1..128 символов. `device_hash` — SHA-256 hex от него.
16. **Лимиты частоты (ERR-012) не реализованы.** `/auth/guest` без лимита создает аккаунты, это риск до выкатки.
17. **Хранилище.** Репозиторий в памяти процесса, после перезапуска пусто. Транзакции сериализуются и откатываются снимком состояния.
    Снимок копирует все состояние на каждую транзакцию, для MVP это допустимо. PostgreSQL-адаптер реализует тот же интерфейс.
18. **Ядро и леджер.** `applyIdempotent` и `appendEntry` из `@cupquest/core` дедуплицируют только по `key` без `userId`.
    Ключи вида `hero:<id>:open:coin` (DB-006) для разных пользователей совпадут. Сервер не использует эти функции для баланса:
    уникальность проверяется по паре `(userId, key)` в репозитории. Это расхождение с DB-006 записано для владельца ядра.
19. **Сид дня.** 16 байт из `crypto.randomBytes` один раз на UTC-день. Первая запись побеждает (`insertIfAbsent`), повтор читает сохраненное значение (DB-009).
20. **Текст.** Коды ошибок без текста. Сообщения исключений для логов на английском. Пользовательский текст на сервере — только имя «Игрок».
21. **Версия клиента.** Минимум по умолчанию `0.1.0`, переменная `MIN_CLIENT_VERSION`.

22. **Флаг дневного сида.** `features.daily_seed` = `false`: дневная доска (API-015) не реализована, поэтому клиент не показывает вкладку «Сегодня».
    Эндпоинт `GET /seeds/daily` (API-008) при этом работает, как и `daily: true` в старте.
23. **CORS.** Заголовки выдаются только для origin из `CORS_ORIGINS`; предварительный запрос `OPTIONS` отвечает `204`. `Retry-After` открыт
    для браузера. Cloudflare Pages и VPS (ТЗ 3) настраиваются этой переменной и `VITE_API_BASE` в клиенте.

## Вне итерации (следующие шаги)

- PostgreSQL-адаптер репозитория по DB-000..DB-018, миграции (node-pg-migrate), `SELECT ... FOR UPDATE` для энергии.
- Оплата Stars: `POST /purchases/invoice`, `pre_checkout`, `successful_payment`, возврат, выключатель `payments.enabled` (PAY-001..PAY-007). Сейчас выключатель читается из флагов, но `PAYMENTS_IMPLEMENTED = false` держит `payments_enabled` ложным.
- Telegram Login widget и `/link` (AUTH-003).
- Друзья и рефералы: `POST /referrals/claim`, `GET /referrals`, граф друзей (`FriendsProvider` уже передается в приложение).
- Дневная доска `GET /board/daily` (API-015) и выбор дневного забега в клиенте: флаг `daily_seed` выключен, вкладки нет.
- Карточка результата `POST /cards`, события `POST /events`.
- Сборка с выводом JS: сейчас `build` проверяет типы, сервер запускается из TypeScript через `tsx` (BE-001).
- Квесты, серия входа, герои: `POST /heroes/open`, `POST /heroes/level`, квесты и серия (ECO-005, ECO-009).
- Лимиты частоты ERR-012 и общее хранилище счетчиков при втором инстансе.
- Полная проверка забега (SEC-008) через `core` с журналом `run_logs`.
