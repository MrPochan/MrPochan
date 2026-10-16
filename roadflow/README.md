# RoadFlow: сайт, игра, сервер и Telegram-бот

```
браузер ──https──> nginx (roadflow.ru)
                    ├─ /            главная страница (статика, /var/www/roadflow/index.html)
                    ├─ /play/       игра (статика, только для вошедших: nginx спрашивает сервер)
                    └─ /api/*       ──> Node-сервер 127.0.0.1:3333 (pm2: roadflow-server) ──> SQLite
Telegram <──> бот (pm2: roadflow-bot) ──http://127.0.0.1:3333/internal──> Node-сервер
```

Что где лежит в репозитории:

| Папка | Что это |
|---|---|
| `site/index.html` | главная страница, вход через Telegram |
| `games/traffic-architect/index.html` | игра, на сервере доступна как `/play/` |
| `roadflow/server` | сервер: вход, сессии, хранение игровых сессий (Express + better-sqlite3) |
| `roadflow/bot` | Telegram-бот (long polling, без зависимостей кроме dotenv) |
| `roadflow/deploy` | nginx, pm2, примеры `.env`, скрипты сборки, обновления и бэкапа |

## Как работает вход

1. На главной нажимают «Войти». Страница просит у сервера ссылку: сервер создаёт одноразовый токен на 5 минут и секрет, который знает только этот браузер.
2. Страница показывает кнопку «Открыть Telegram» (ссылка `https://t.me/<бот>?start=<токен>`) и опрашивает сервер.
3. Человек нажимает в боте «Start». Бот сообщает серверу, кто это (`/internal/auth/confirm` с секретом `INTERNAL_SECRET`).
4. Сервер видит подтверждение, и очередной опрос страницы получает cookie `rf_session` (HttpOnly, Secure, SameSite=Lax, 30 дней, продлевается при использовании). В базе хранится только хэш cookie.
5. Игра на `/play/` берёт ту же cookie, повторный вход не нужен. nginx до выдачи файлов игры спрашивает `/api/auth/check`; без входа отправляет на `/#login`, и главная сама открывает окно входа.

Игра раз в 15 секунд и при закрытии страницы отправляет сводку сессии (время, дни, жители, настроение, доехавшие, деньги, районы, средняя поездка, пик машин). Это таблица `play_sessions`. Полное сохранение карты города пока не реализовано: после перезагрузки страницы город начинается заново, статистика остаётся.

## 1. Что подготовить заранее

- **Домен.** В DNS две A-записи на IP сервера: `roadflow.ru` и `www.roadflow.ru`.
- **Бот.** В Telegram откройте @BotFather: `/newbot`, имя и логин (например `RoadFlowBot`). Сохраните **токен** и **логин бота**. Больше ничего в BotFather включать не нужно (домен для входа не нужен, используется ссылка с `start`). По желанию `/setdescription` и `/setuserpic`.

## 2. Сервер Ubuntu 22.04 / 24.04

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git sqlite3 build-essential python3 curl ufw

# Node.js 22 (нужен 20 или новее)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# файрвол
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Отдельный пользователь для приложения и папка для базы:

```bash
sudo adduser --disabled-password --gecos "" roadflow
sudo mkdir -p /var/lib/roadflow /var/www/roadflow
sudo chown roadflow:roadflow /var/lib/roadflow /var/www/roadflow
```

## 3. Код и зависимости

```bash
sudo -iu roadflow
git clone <адрес вашего репозитория> ~/app
cd ~/app/roadflow
(cd server && npm ci --omit=dev)
(cd bot && npm ci --omit=dev)
```

`better-sqlite3` ставится готовым бинарником. Если npm пишет, что собирает его из исходников, это нормально: пакеты `build-essential` и `python3` уже поставлены.

## 4. Настройки (.env)

```bash
cd ~/app/roadflow
openssl rand -hex 32                          # это значение пойдёт в INTERNAL_SECRET, в оба файла одинаковое
cp deploy/server.env.example server/.env
cp deploy/bot.env.example bot/.env
chmod 600 server/.env bot/.env
nano server/.env                              # BOT_USERNAME, INTERNAL_SECRET
nano bot/.env                                 # BOT_TOKEN, INTERNAL_SECRET
```

Файлы `.env` в git не попадают (они в `.gitignore`). Токен бота и `INTERNAL_SECRET` никому не показывайте.

## 5. Статика

```bash
cd ~/app/roadflow
./deploy/build-web.sh /var/www/roadflow
# получится /var/www/roadflow/index.html и /var/www/roadflow/play/index.html
```

## 6. nginx и HTTPS

```bash
exit                                           # вернуться к своему пользователю с sudo
sudo cp /home/roadflow/app/roadflow/deploy/nginx.roadflow.ru.conf /etc/nginx/sites-available/roadflow.ru
sudo ln -s /etc/nginx/sites-available/roadflow.ru /etc/nginx/sites-enabled/roadflow.ru
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d roadflow.ru -d www.roadflow.ru     # выпустит сертификат и включит HTTPS с редиректом
```

Сертификат продлевается сам (таймер certbot). Проверка: `sudo certbot renew --dry-run`.

## 7. Запуск через pm2

```bash
sudo -iu roadflow
cd ~/app/roadflow
pm2 start deploy/ecosystem.config.cjs
pm2 save
exit
# автозапуск после перезагрузки сервера (команду выведет pm2 startup, выполните её от sudo):
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u roadflow --hp /home/roadflow
sudo -iu roadflow pm2 save
# ротация логов:
sudo -iu roadflow pm2 install pm2-logrotate
```

Полезные команды (от пользователя `roadflow`): `pm2 status`, `pm2 logs roadflow-server`, `pm2 logs roadflow-bot`, `pm2 restart roadflow-bot`.

В логах бота должна появиться строка `bot @<логин> started`, в логах сервера `roadflow server on http://127.0.0.1:3333`.

## 8. Проверка

```bash
curl -i https://roadflow.ru/api/me              # 401 unauthorized: сервер отвечает, вы не вошли
curl -I https://roadflow.ru/play/               # 302 на /#login: игра закрыта без входа
curl -i https://roadflow.ru/internal/auth/confirm   # 404: снаружи внутренний адрес не виден
```

Потом откройте https://roadflow.ru, нажмите «Войти», откройте бота, нажмите Start. Страница должна сама показать ваше имя, а «Играть» открывает игру без второго входа.

## 9. Обновление

```bash
sudo -iu roadflow
cd ~/app && git pull
./roadflow/deploy/update.sh        # npm ci, пересборка статики в /var/www/roadflow, pm2 reload
```

## 10. Данные и бэкапы

- База: `/var/lib/roadflow/roadflow.db` (рядом файлы `-wal` и `-shm`, это нормально).
- Таблицы: `users` (Telegram id, имя, логин), `sessions` (входы, хранится хэш cookie), `login_tokens` (одноразовые ссылки, чистятся сами), `play_sessions` (игровые сессии).
- Бэкап раз в сутки (cron от пользователя `roadflow`, `crontab -e`):
  `15 4 * * * /home/roadflow/app/roadflow/deploy/backup.sh`
  Копии лежат в `/var/backups/roadflow` (создайте папку и дайте права пользователю `roadflow`), хранятся 14 дней.
- Посмотреть данные: `sqlite3 /var/lib/roadflow/roadflow.db "select * from play_sessions order by id desc limit 10"`.

## 11. Безопасность: что уже сделано и что на вас

Сделано: cookie HttpOnly + Secure + SameSite, в базе только хэш cookie; одноразовые токены входа с секретом браузера и сроком 5 минут; запросы, меняющие данные, принимаются только с вашего адреса (проверка `Origin`); `/internal` закрыт в nginx и защищён секретом; ограничение частоты запросов; значения от игры ограничиваются по диапазону, а не берутся на веру.

На вас: держать `.env` закрытыми (`chmod 600`), обновлять систему (`unattended-upgrades`), не открывать порт 3333 наружу (сервер слушает только 127.0.0.1). Статистику игры присылает браузер, поэтому по ней нельзя судить честно о рекордах: для рейтинга позже понадобится проверка на сервере.

## 12. Тесты (на своей машине или на сервере)

```bash
cd roadflow/server && npm install && npm test            # сервер: вход, сессии, лимиты, изоляция игроков
cd ../bot && npm install && node --test test/bot.test.js  # бот с поддельным Telegram API
# сквозной тест в браузере (нужен playwright): сначала ./deploy/build-web.sh, затем
cd ../server && node test/e2e.js
```
