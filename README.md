# Сервер бронирования (Node.js + SQLite)

Простой REST API с авторизацией по JWT, загрузкой файлов, телеграм-ботом и автобэкапом.

## Что делает сервер
- Таблицы: CRUD для бронирований (`/tables`, `/tables/add`, `/tables/delete/:id`).
- Пользователи: логин, регистрация новых пользователей администратором, обновление своих данных.
- Настройки: хранение `bot_id`, `chat_id`, `admin_chat` в зашифрованном виде, выдача только администратору.
- Файлы: загрузка аватарок (jpeg/png до 2 МБ) с выдачей ссылки.
- Телеграм-бот: слушает чаты и отвечает «О! Привет!» на сообщения с текстом «привет бот».
- Автобэкап: в 00:00 и 08:00 (время сервера) бот отправляет админу zip-архив с базой (`/data`) и файлами (`/uploads`).

## Быстрый старт локально
1. Установите Node.js 18+ и npm.
2. Склонируйте репозиторий и перейдите в него.
3. Создайте `.env` на основе `.env.example`:
   - `JWT_SECRET` — любая длинная строка.
   - `ENCRYPTION_KEY` — 32-байтовый ключ в hex (64 символа). Пример генерации:  
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ADMIN_LOGIN` / `ADMIN_PASSWORD` — стартовый админ создастся при первом запуске.
   - `SERVER_URL` — например `http://localhost:3000` или ваш домен, чтобы ссылки на файлы были абсолютными.
4. Установите зависимости: `npm install`.
5. Запустите сервер: `npm start`.
6. API будет доступен по `http://localhost:3000`. Статические файлы лежат в `/uploads`.

## Основные endpoints
- `POST /login` — логин по `login`, `password`; ответ: `{ token, user }` без поля `password`.
- `POST /registration` — только для admin; создаёт пользователя (поля `login`, `password`, `name`, `role`).
- `PUT /users/me` — обновление своих данных (можно менять `name`, `login`, `password`, `avatar`).
- `GET /tables?date=дд.мм.гг` — список бронирований, фильтр по дате опционален; требует авторизации.
- `POST /tables/add` — добавить бронирование; если `user_id` не указан, используется текущий пользователь.
- `DELETE /tables/delete/:id` — удалить бронирование по id; авторизованные.
- `GET /settings` — только admin, возвращает расшифрованные `bot_id`, `chat_id`, `admin_chat`.
- `POST /settings/add` — только admin, обновляет настройки (`bot_id`, `chat_id`, `admin_chat`, значения шифруются). Бот перезапускается с новым `bot_id`.
- `GET /schema` и `POST /schema` — только admin; чтение и сохранение JSON-схемы, тело запроса: `{ "schema": <любой JSON> }`.
- `POST /upload` — авторизованные; `multipart/form-data` поле `file` (jpeg/png ≤ 2 МБ). Ответ: `{ url }`.

## Шаги деплоя на VPS (Ubuntu)
1. Подготовка сервера  
   - `sudo apt update && sudo apt upgrade -y`  
   - `sudo apt install -y git nodejs npm sqlite3 nginx`
2. Развернуть код  
   - `git clone <репозиторий> /var/www/server-iggy-reserve`  
   - `cd /var/www/server-iggy-reserve`  
   - `cp .env.example .env` и заполнить переменные. `SERVER_URL` укажите с вашим доменом, например `https://example.com`.
   - `npm install`
3. Запуск через systemd  
   Создайте сервис: `sudo nano /etc/systemd/system/iggy-reserve.service` со содержимым:
   ```
   [Unit]
   Description=Iggy Reserve Server
   After=network.target

   [Service]
   WorkingDirectory=/var/www/server-iggy-reserve
   ExecStart=/usr/bin/node /var/www/server-iggy-reserve/src/index.js
   Restart=always
   Environment=NODE_ENV=production
   EnvironmentFile=/var/www/server-iggy-reserve/.env

   [Install]
   WantedBy=multi-user.target
   ```
   Затем:  
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable iggy-reserve
   sudo systemctl start iggy-reserve
   sudo systemctl status iggy-reserve
   ```
4. Настроить домен через Nginx  
   - Укажите A-запись домена на IP VPS.  
   - Создайте конфиг: `sudo nano /etc/nginx/sites-available/iggy-reserve`
   ```
   server {
     listen 80;
     server_name example.com www.example.com;

     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }

     location /uploads/ {
       alias /var/www/server-iggy-reserve/uploads/;
     }
   }
   ```
   - Активируйте сайт и перезапустите Nginx:  
     ```
     sudo ln -s /etc/nginx/sites-available/iggy-reserve /etc/nginx/sites-enabled/
     sudo nginx -t
     sudo systemctl restart nginx
     ```
5. Включить HTTPS (Let’s Encrypt)  
   - `sudo apt install -y certbot python3-certbot-nginx`  
   - `sudo certbot --nginx -d example.com -d www.example.com` и следуйте инструкциям.  
   - После выдачи сертификата `SERVER_URL` в `.env` должен быть `https://example.com`.
6. Проверка  
   - `curl -I https://example.com/` должен вернуть `200` от Nginx.  
   - `curl -H "Authorization: Bearer <token>" https://example.com/tables` проверит проксирование.

## Полезное
- БД и загруженные файлы лежат в `/data` и `/uploads` (обе директории игнорируются git). Организуйте бэкап этих папок.
- Для отправки автобэкапов укажите в `/settings/add` поле `admin_chat` (ID администратора в Telegram) и `bot_id`. Без этих значений рассылка пропускается.
- Автобэкап запускается в 00:00 и 08:00 (время сервера). Формируется zip-архив с базой и папкой `uploads`, отправляется в `admin_chat` и удаляется после отправки.
- Для смены Telegram-бота или `chat_id` используйте `POST /settings/add`; значения в БД хранятся зашифрованными AES-256-GCM.
- При первом запуске с заполненными `ADMIN_LOGIN` и `ADMIN_PASSWORD` автоматически создаётся админ.

## QR magic-link
- `POST /magic-links` ??????? ????? ??????? ????? ? ?????????? `{ token, magic_link, expires_at }`; `magic_link` ????? ?????????????? ? QR ? ?????????? ?? ?????.
- ????????????, ??????? ????????? ?????? ? ??? ??????????? ?? ????????? ??????????, ???????? `POST /magic-links/:token/confirm` ? `Authorization: Bearer <token>`; ??? ???????? ?????? ??? ??????????.
- ?????? ?? ?? ?????????? `GET /magic-links/:token`. ???? ?????? `pending`, ????? ?????; ????? `status: approved` ???????? JWT ? ??????? ????????????.
- ? `.env` ???????? `MAGIC_LINK_TTL_MINUTES` ??????, ??????? ????? ?????? ????? ??????????? (?? ????????? 5).
