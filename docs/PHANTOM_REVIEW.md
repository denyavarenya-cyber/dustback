# Phantom і Blowfish: як зняти позначку з домену

Чекліст для власника. Станом на 31 жовтня 2026. Кожен крок, який змінює живий сайт,
DNS або подає форму, робить власник; агент нічого з цього не робить.

## Що вже перевірено

* `dustback.app` **немає** в публічному списку Phantom
  ([phantom/blocklist](https://github.com/phantom/blocklist), файли `blocklist.yaml`
  і `whitelist.yaml`) і немає в списку MetaMask
  ([eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect), `src/config.json`).
  Отже попередження йде з власної оцінки Phantom (домен або симуляція транзакції), а не
  з публічного списку.
* Живий `https://dustback.app/.well-known/assetlinks.json` віддає відбиток публічного
  debug ключа `FA:C6:…:3B:9C` (знахідка 1 в `docs/DUSTBACK_AUDIT.md`). Будь-хто може
  підписати клон застосунку цим ключем, і гаманець покаже його як перевірений dustback.app.
* Сайт віддається без жодного захисного заголовка (CSP, HSTS, X-Frame-Options).

## Кроки по порядку

### 1. Зафіксувати, яке саме попередження

- [ ] Зробити знімок екрана попередження. Від тексту залежить шлях:
  * "This domain is new or has not been reviewed yet": новий домен, крок 6.
  * "This dApp could be malicious" під час транзакції: симуляція, кроки 5 і 6.
  * Попередження про ідентичність застосунку при підключенні на Android: крок 2.
  * Сторінка блокування на весь екран у розширенні: список блокування, крок 7.
- [ ] Записати, де воно з'являється: розширення в браузері, мобільний Phantom, при
  відкритті сайту, при підключенні, при підписі.

### 2. Прибрати debug ключ з asset links (сьогодні, до будь-яких звернень)

- [ ] На живому сайті видалити рядок `FA:C6:17:45:…:91:03:3B:9C` з
  `/.well-known/assetlinks.json`. Оскільки застосунок DustBack заморожено, простіше
  прибрати весь файл разом із новою сторінкою з блоку E.
- [ ] Перевірити: `curl -s https://dustback.app/.well-known/assetlinks.json` більше не
  містить `FA:C6`.
- [ ] Коли в застосунку Noventia з'явиться підпис через гаманець на Android: у
  `assetlinks.json` домену `noventia.app` лише відбиток ключа підпису з Play Console
  (App integrity, App signing key certificate), ніколи не debug і не upload ключ, а в
  `authorize` ідентичність з `uri: https://noventia.app`. Джерело:
  [Phantom, App identity verification](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings).

### 3. Викласти нову сторінку з блоку E

- [ ] Одна статична сторінка: "DustBack тепер частина Noventia", посилання на
  noventia.app, офіційні адреси. Без форми, без кнопки підключення гаманця, без слів
  "sweep" і "sweeper".
- [ ] Суворі заголовки: Content-Security-Policy без сторонніх джерел, HSTS,
  X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy.
- [ ] `/.well-known/security.txt` з контактом.
- [ ] Перевірити заголовки: `curl -sI https://dustback.app/`.

### 4. Перевірити інші списки (2 хвилини)

- [ ] Google Safe Browsing:
  [transparencyreport.google.com/safe-browsing/search?url=dustback.app](https://transparencyreport.google.com/safe-browsing/search?url=dustback.app).
  Якщо є позначка: [форма помилки Safe Browsing](https://safebrowsing.google.com/safebrowsing/report_error/).
- [ ] VirusTotal для URL: [virustotal.com](https://www.virustotal.com/gui/home/url).

### 5. Транзакції (для застосунку Noventia, коли запрацює очищення)

Phantom показує "This dApp could be malicious", коли не може передбачити результат
транзакції. Рекомендації з
[офіційної сторінки](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings)
і [рецепта](https://docs.phantom.com/recipes/transactions/resolve-transaction-simulation-warnings.md),
та що з цього вже зроблено в модулі `packages/cleanup-core`:

- [x] Один підписант: лише гаманець користувача.
- [x] Симуляція з `sigVerify: false` перед підписом; транзакція, що падає, не
  пропонується.
- [x] Ліміт обчислень задано явно (виміряно в симуляції, плюс 20 відсотків).
- [x] Великі набори розбиваються на кілька транзакцій до 1232 байтів; свопи через
  таблиці адрес (v0).
- [x] Комісія Noventia всередині тієї самої транзакції, окремою інструкцією, а не
  другим запитом після першого.
- [ ] Phantom радить підписувати через `signTransaction` і відправляти через власний
  RPC з preflight. Це рішення для екранів у застосунку (блок D).
- [ ] Перевірити на devnet у справжньому Phantom, що попередження немає.

### 6. Подати форму Phantom

- [ ] Почекати тиждень після нової сторінки: попередження про новий домен часто
  зникає саме. Phantom пише звертатися, якщо воно тримається довше тижня.
- [ ] Форма огляду доменів Phantom (посилання з їхньої документації):
  [docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform](https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform).
- [ ] Текст для форми (англійською, підставити своє):

```
Domain: dustback.app
Status: retired product. The domain now serves one static page that says DustBack
is part of Noventia and links to https://noventia.app. No wallet connection, no
forms, no scripts from third parties.
Source code: https://github.com/<owner>/dustback (public, MIT)
Contact: <email on the domain>
The old Android app is no longer distributed. Its asset links file has been
removed from the domain.
Please review the domain and clear the warning, or tell us what you still see.
```

- [ ] Додати знімок попередження з кроку 1.
- [ ] Окремо подати `noventia.app`, коли в застосунку з'явиться очищення: той самий
  текст плюс короткий опис транзакцій (закриття порожніх рахунків, свопи через Jupiter,
  комісія окремою інструкцією в тій самій транзакції).

### 7. Blowfish

Blowfish зараз частина Phantom. Офіційної форми для Blowfish не знайдено. Інші
розробники в жовтні 2026 подавали звернення як issue в
[blowfishxyz/blocklist](https://github.com/blowfishxyz/blocklist/issues) (наприклад
[#205](https://github.com/blowfishxyz/blocklist/issues/205),
[#214](https://github.com/blowfishxyz/blocklist/issues/214)); це не офіційний канал.

- [ ] Лише якщо форма з кроку 6 не дала відповіді за два тижні: відкрити issue там же
  з тим самим текстом і номером звернення Phantom, якщо він є.

### 8. Після відповіді

- [ ] Перевірити в розширенні та мобільному Phantom з чистого профілю.
- [ ] Записати дату й результат у `docs/BACKLOG.md` одним рядком.
