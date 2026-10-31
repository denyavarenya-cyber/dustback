# dustback.app: нова сторінка, кроки власника

Сторінка зібрана в `site/`, перевірка `node scripts/check-site.mjs`. Агент нічого не
деплоїть. DNS міняти не треба: домени dustback.app і www.dustback.app вже прив'язані до
Worker `dustback` у Cloudflare.

## Що на сторінці

* Одна сторінка: "DustBack is now part of Noventia. Wallet cleanup lives in the Noventia
  app", посилання на noventia.app, офіційні адреси (noventia.app, noventia.xyz,
  X @NoventiaHq, Discord, support@noventia.app).
* Без скриптів, без форми, без кнопки підключення гаманця, без сторонніх запитів.
  Шрифти IBM Plex лежать на самому сайті (`site/fonts`, ліцензія OFL).
* Заголовки (`site/_headers`): Content-Security-Policy `default-src 'none'`, HSTS,
  X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
* Старі шляхи (`site/_redirects`): `/privacy`, `/privacy/`, `/privacy.html` ведуть на
  https://noventia.app/privacy одним переходом. `/index.html` веде на `/` (стандартна
  поведінка Cloudflare). Невідомі шляхи показують сторінку 404 з посиланням на noventia.app.
* Залишено: `/icon.png` (ним підписується вже встановлений застосунок DustBack у
  гаманцях) і `/.well-known/assetlinks.json` з двома відбитками, без debug ключа.
* Додано `/.well-known/security.txt` з контактом support@noventia.app.
* Прибрано: стара сторінка, форма тестерів, `/.well-known/README.md`.

## Деплой

Спочатку виконати `C:\Noventia\dustback-hotfix\OWNER_STEPS.md` (debug ключ), якщо ще ні.
Ті самі кроки, тільки з цієї гілки:

1. `cd C:\Noventia\worktrees\dustback-site` і `node scripts/check-site.mjs`
   (має бути `site check passed`).
2. `npx wrangler@4.131.2 login` (якщо вийшли після hotfix).
3. У `wrangler.toml` замість `FILL_IN_FROM_LIVE_WORKER` вписати дату з
   `npx wrangler@4.131.2 versions view <активна версія> --name dustback`.
4. `npx wrangler@4.131.2 versions upload --message "DustBack is now part of Noventia"`
   Нічого не міняє на сайті. Скопіювати `Version ID`.
5. Перевірити версію за адресою прев'ю з виводу (якщо вона є) або одразу:
   `npx wrangler@4.131.2 versions deploy <Version ID>@100% --name dustback --yes`
6. Перевірка:
   * `curl.exe -sI https://dustback.app/` має містити `content-security-policy` і
     `strict-transport-security`;
   * `curl.exe -sI https://dustback.app/privacy.html` має дати `301` на
     `https://noventia.app/privacy`;
   * `curl.exe -s https://dustback.app/.well-known/assetlinks.json` без `FA:C6`;
   * сторінка у браузері на телефоні.
7. `npx wrangler@4.131.2 logout`.

Відкат: `npx wrangler@4.131.2 versions deploy <попередня версія>@100% --name dustback --yes`.
