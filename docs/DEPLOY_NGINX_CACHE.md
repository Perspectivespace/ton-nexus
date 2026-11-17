# Кэширование Mini App в nginx (P2)

Зачем: после деплоя игрок должен сразу получать новую сборку, а тяжёлые файлы сборки — не качать заново при каждом открытии.

| Путь | Cache-Control | Почему |
|---|---|---|
| `/index.html` (и SPA-фолбэк на него) | `no-cache, must-revalidate` | всегда сверяется с сервером (ETag), новая сборка видна сразу |
| `/version.json` | `no-store` | клиент опрашивает его, чтобы заметить деплой (`frontend/src/lib/version.ts`) |
| `/sw.js`, `/service-worker.js` | `no-cache, must-revalidate` | service worker сейчас нет; правило на будущее, чтобы он не залипал |
| `/assets/*` | `public, max-age=31536000, immutable` | имена с хэшем (`index-AbC123.js`) — содержимое по имени не меняется; нет файла — 404, а не index.html |

Прочие файлы из `public/` (иконки, фавикон) — как настроено в сайте сейчас.

Шаблон: [`deploy/nginx/neon-nexus-cache.conf`](../deploy/nginx/neon-nexus-cache.conf) → на сервере `/etc/nginx/snippets/neon-nexus-cache.conf`, подключается внутри `server { }` строкой `include snippets/neon-nexus-cache.conf;` сразу после `root …/frontend/dist;`. `root` наследуется из сайта.

Установка: пошаговые команды (без nano и heredoc, `printf … | sudo tee`, `nginx -t`, `reload`, проверка `curl -sI`, откат) — у владельца в задаче P2; коротко:
1. найти файл сайта с `root …/frontend/dist;` и сделать резервную копию;
2. записать сниппет в `/etc/nginx/snippets/`;
3. вставить `include` после строки `root`;
4. `sudo nginx -t && sudo systemctl reload nginx`;
5. проверить заголовки: `curl -sI https://ДОМЕН/ | grep -i cache-control`.

Осторожно: `add_header` внутри `location` отменяет `add_header` уровня `server` — если в сайте есть свои заголовки, их нужно повторить в сниппете.
Автодеплой (`scripts/deploy-runner.sh`) конфиг nginx не меняет — только `nginx -t` и `reload`.
