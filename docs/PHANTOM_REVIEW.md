# Phantom: огляд домену dustback.app, готово до подання

Для власника. Станом на 1 листопада 2026. Форму подає власник; агент нічого не подає.

**Коли:** через тиждень після того, як нова сторінка запрацює на dustback.app.
Phantom пише, що попередження про новий або змінений домен часто зникає саме, і
просить звертатися, якщо воно тримається довше тижня.

* Сторінка запрацювала: `<дата деплою>` (агент впише в день деплою)
* Подати не раніше: `<дата деплою + 7 днів>`

## Перед поданням (5 хвилин)

1. Чи попередження ще є? Відкрити https://dustback.app у Phantom: у розширенні в
   браузері й у мобільному застосунку. Якщо попередження немає, форму не подавати,
   записати дату в `docs/BACKLOG.md`.
2. Якщо є: знімок екрана попередження (форма не приймає файлів, але знімок
   знадобиться, якщо Phantom відповість і попросить).
3. Три перевірки в терміналі, усі мають пройти:

```
curl -s https://dustback.app/.well-known/assetlinks.json | grep -c "FA:C6"
# 0  (debug ключ прибрано; сьогодні тут ще 1, це гарячий фікс, що чекає на wrangler)

curl -sI https://dustback.app/ | grep -i "content-security-policy\|strict-transport\|x-frame-options"
# три рядки

curl -sI https://dustback.app/privacy | grep -i "^location"
# location: https://noventia.app/privacy
```

## Форма

https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform
("Phantom dApp Review Submission", 11 текстових полів, файлів не приймає).
Нижче остаточний текст кожного поля, англійською, для копіювання. Змінити треба
лише `<...>`.

**1. Project Name** (обов'язкове)
```
DustBack (now part of Noventia)
```

**2. Describe your dApp** (обов'язкове)
```
dustback.app was the website of DustBack, an app that closed empty Solana token accounts and returned their rent to the owner. DustBack is retired and is now part of Noventia.

Since <date the page went live> the domain serves one static page. It says DustBack is now part of Noventia, links to https://noventia.app and lists the official addresses. The page has no wallet connection, no forms and no scripts, loads nothing from other sites, and asks for nothing.

Wallet cleanup now lives in the Noventia app. There, every transaction is built for the user, simulated before the wallet opens, and signed in the user's own wallet; the Noventia fee is a separate instruction inside the same transaction and its amount is shown before signing.
```

**3. dApp website URL** (обов'язкове)
```
https://dustback.app
```

**4. Your Name** (обов'язкове)
```
<ім'я власника>
```

**5. Your E-mail** (обов'язкове)
```
support@noventia.app
```

**6. Transaction Link** (обов'язкове)
```
Not applicable. The warning is shown for the domain itself. dustback.app has no wallet connection and makes no transactions.
```

**7. Team Information** (обов'язкове)
```
DustBack is now part of Noventia: https://noventia.app and https://noventia.xyz
GitHub: https://github.com/noventiaproject-ops
```

**8. Social Media Handles** (обов'язкове)
```
X: https://x.com/NoventiaHq
Discord: https://discord.com/invite/5HaTQHW2Es
```

**9. Repository Links** (необов'язкове)
```
https://github.com/denyavarenya-cyber/dustback (public; the page is in the site folder)
```
Якщо репозиторій уже перенесено, вставити нову адресу; стара все одно
переадресовує на нову.

**10. Community member who can vouch** (необов'язкове): залишити порожнім.

**11. Any additional information** (необов'язкове)
```
What changed on dustback.app on <date the page went live>:
- The old site was replaced by one static page (55 words) that points to https://noventia.app.
- /.well-known/assetlinks.json no longer lists the public Android debug certificate (FA:C6:17:45:...:3B:9C). Only the two release certificates of the retired app.dustback Android app remain.
- Strict headers on every response: Content-Security-Policy default-src 'none' (styles, fonts and images from the same origin only, form-action 'none', frame-ancestors 'none'), Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, Permissions-Policy, Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy same-origin.
- Fonts are served from the domain itself; the page makes no request to any other site.
- /privacy, /privacy/ and /privacy.html redirect with 301 to https://noventia.app/privacy.
- /.well-known/security.txt with the contact support@noventia.app.
If the warning is about something else, please tell us what you see and we will fix it.
```

## Що змінилося на dustback.app (для власника)

| Було | Стало |
|---|---|
| Старий сайт DustBack | Одна статична сторінка, 55 слів: «DustBack is now part of Noventia», кнопка на noventia.app, офіційні адреси, рядок «Noventia never asks for your seed phrase or private key.» |
| `assetlinks.json` з трьома відбитками, серед них публічний debug ключ `FA:C6:…:3B:9C` | Два відбитки release ключів застосунку `app.dustback`, debug ключа немає |
| Жодного захисного заголовка | CSP `default-src 'none'`, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP і CORP |
| Вбудований скрипт на сторінці | Нуль скриптів; шрифти IBM Plex з самого домену; жодного запиту на інші сайти |
| `/privacy` віддавала стару сторінку (200) | 301 на https://noventia.app/privacy (усі три форми адреси, без другого переходу) |
| | `/.well-known/security.txt`, `robots.txt`, сторінка 404 |

Джерело сторінки: гілка `agent2/site`, тека `site/`, перевірка `node scripts/check-site.mjs`.

## Знімки

Сторінка в тому вигляді, що власник затвердив 31 жовтня (локальна збірка до деплою;
знімки з живого сайту агент додасть як `live-*.png` у день деплою):

| Ширина | Файл |
|---|---|
| 360 px | [phantom-review/page-360.png](phantom-review/page-360.png) |
| 390 px | [phantom-review/page-390.png](phantom-review/page-390.png) |
| 768 px | [phantom-review/page-768.png](phantom-review/page-768.png) |
| 1440 px | [phantom-review/page-1440.png](phantom-review/page-1440.png) |
| 404, 390 px | [phantom-review/404-390.png](phantom-review/404-390.png) |

Знімок самого попередження Phantom робить власник (крок 2 вище).

## Після подання

* Відповідь Phantom приходить на support@noventia.app. Якщо за два тижні відповіді
  немає: Blowfish тепер частина Phantom, офіційної форми для нього немає; інші
  розробники відкривали issue в
  [blowfishxyz/blocklist](https://github.com/blowfishxyz/blocklist/issues) з тим самим
  текстом. Це не офіційний канал, лише запасний.
* Перевірити в розширенні й мобільному Phantom з чистого профілю.
* Записати дату й результат одним рядком у `docs/BACKLOG.md`.

## Окремо, пізніше: noventia.app

Коли очищення в застосунку Noventia вийде з devnet, подати ту саму форму для
`https://noventia.app`, з посиланням на справжню транзакцію на Solscan у полі 6
(форма його вимагає для попереджень під час транзакції). Що для цього вже зроблено
в модулі `packages/cleanup-core`: один підписант (гаманець користувача), симуляція
перед підписом і транзакції, що падають, не пропонуються, явний ліміт обчислень,
до 1232 байтів на транзакцію, підпис через `signTransaction` і відправлення через
власний RPC з preflight, комісія окремою інструкцією в тій самій транзакції.
Ще треба: `assetlinks.json` на noventia.app з ключем підпису Play (у BACKLOG) і
перевірка в справжньому Phantom на devnet.

Що вже перевірено 31 жовтня: `dustback.app` немає в публічних списках
[phantom/blocklist](https://github.com/phantom/blocklist) і
[MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect).
Попередження йде з власної оцінки Phantom, а не з публічного списку.
