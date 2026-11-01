# Очищення гаманця: повний прогін на devnet

Стан на 1 листопада 2026.

## Підписаний прогін на devnet, 1 листопада: усі 15 перевірок пройшли

Емулятор Android (Pixel 7, Android 15), Expo Go 54. Код застосунку без змін:
`src/features/cleanup` з PR #6 і `@noventia/cleanup-core` 0.1.4. Підписує
тимчасовий ключ, що жив лише в пам'яті тестового процесу (WebCrypto,
non-extractable). Власник поповнив його адресу
`H6QiGTLvCCJ8GipkqCtvPu4CtaPbk72yov6Dndp7FobE` на 1 devnet SOL о 10:56:59 UTC
([транзакція](https://explorer.solana.com/tx/3bzHWYB3XcZjwaf7AZP43dx28GPskQnP9xAe4G3AAEFTEgaSMqxBQQGu9kWHrGcP6rxe2ErUW5YGEowbd6Y3NFPD?cluster=devnet)).

**Транзакція застосунку** (12:01 UTC, 7 інструкцій: ліміт обчислень,
5 × `closeAccount`, переказ комісії):
[2T5YSYCEKzfio3eCVzxH9rjxyvnTi9LCEbVJxy5qAtjx4PdermuVuTah3tbtz8KXGAiQUQQ1aX9PGzy9EfJGy2tA](https://explorer.solana.com/tx/2T5YSYCEKzfio3eCVzxH9rjxyvnTi9LCEbVJxy5qAtjx4PdermuVuTah3tbtz8KXGAiQUQQ1aX9PGzy9EfJGy2tA?cluster=devnet)

| | Екран | Ланцюг |
|---|---|---|
| Рента 5 рахунків (4 × 1 488 440 + 1 513 840 Token-2022) | 7 467 600 | 7 467 600 |
| Комісія Noventia, 7 %, у тій самій транзакції | 522 732 | переказ 522 732, гаманець комісії +522 732 |
| Мережева комісія | 5 000 | `meta.fee` 5 000 |
| Користувач отримує | 6 939 868 | баланс власника +6 939 868 |

Рента на devnet зараз нижча, ніж у локальній заміні нижче (1 488 440 замість
2 039 280 за рахунок), тому числа інші; правило те саме.

* NFT `9B96cfsnZvXHqE6hJDfbSyahcDoCxAvjSUFjRpvJTU24` не названо в транзакції, після прогону має 1 токен.
* Заморожений рахунок `2RdXPZ1sC23RrqoHBb7N3YgkqXn6AFXbAnHpt6B8s7G3`: на екрані «Frozen by the token issuer», у транзакції його немає, після прогону він є і `frozen`.
* Рахунок з балансом `4RJ1yhnAZZYW3CK4Afa9EipYHtkHLHQpRjF5gDkefYZf` не зачеплено (1 000 000 000 одиниць).
* П'ять вибраних порожніх рахунків закриті. Екран результату: «Confirmed».

Транзакції налаштування (тестовий гаманець, не застосунок):
[гаманець комісії](https://explorer.solana.com/tx/55xYTUaZqPSfgP4N9hmEMnP7SDspCmP2z7f5GeTfTQqbAV8NJvit2wKZ5xBzZkZGhpeJy7GrLvgmHautYtSF4RG6?cluster=devnet),
[порожній 1](https://explorer.solana.com/tx/DEVLyKvD3F7KvQDB1WDjvedSdXYFJvej9g5tkCHSdbycsQrcmMTz2ihkVorEJ4kuko2nXyRBpdJ1bG4TGAwPmS4?cluster=devnet),
[порожній 2](https://explorer.solana.com/tx/3eWTeBKcJCuZwywY2h219WQVkbvw3MntYJcB1xu2ncX2zhYWPXykfEi6uyG9LygR7aU3KiZZzKBKPWyFtFJzAQvy?cluster=devnet),
[порожній 3](https://explorer.solana.com/tx/KQyAvjEqWq3MJBowPb2MN1absDUvCKhNe72KLByuHVSXj6m2UNos5m68u4hhQfmX7pKpsqwsRXiBmTr87zMw5va?cluster=devnet),
[порожній 4](https://explorer.solana.com/tx/2fKnUy2gCBtRou7fS8rgEHNqVMp88fGfFpona8nsLLBjLqgVhH2RzHMSteHkYr3vyKZfx9w2u2swhBBwmVMgYHEG?cluster=devnet),
[порожній Token-2022](https://explorer.solana.com/tx/PAoXkWMLtb9hdwsQKS79cRjD4NNdVpYrxWBYNkoPqWkHNU2NUtjqPLtgRt9XkrR4B1PSW1rqhvpnCSUFATHm9oR?cluster=devnet),
[NFT](https://explorer.solana.com/tx/5ztmhPeXPDM1TmQbpNQuQAJUNJXBkw3GhNhZBf5KkwKZryC3HSMrheh3GHzNvZ9mkVJg5VfkyxMdwPxaXGDZN2nq?cluster=devnet),
[заморожений](https://explorer.solana.com/tx/5Tfr2C91sKoyi12euPGS2BgwzzEKFtXUmw6BdS2yfACj8CJw75f1Z4F6qQKXwsqenJY1cnkEVNGmHhFowHr4x5cU?cluster=devnet),
[з балансом](https://explorer.solana.com/tx/3sF6xzXeFG8QYybnmGFGD2BsmNJMNyLR39BDcAvJnfuqrJUdECvVSrc6FebrGSTsP8x3gH7cirpHiFAmGX4UCkS5?cluster=devnet).

Знімки чотирьох кроків: [e2e-devnet/](e2e-devnet/). Запити застосунку до
devnet ішли через тестовий гаманець (18 запитів, жодного 429 цього разу).

Перший прохід по екранах після поповнення не стартував: після примусової
зупинки й холодного запуску Expo Go лишився на домашньому екрані Android.
Другий запуск відкрив застосунок, і прохід пройшов. Ключ і кошти весь цей час
були в тестовому процесі.

## Що вже перевірено до devnet

**На емуляторі Android (Pixel 7, Android 15), код застосунку без змін**
(`src/features/cleanup` з PR #6 і `@noventia/cleanup-core` 0.1.4), на новій темі.
Чотири кроки: підключення, вибір, перевірка перед підписом, результат.
Знімки: `docs/screenshots/wallet-cleanup/` у Noventia_app.

Ці знімки зроблено з локальною заміною RPC (`e2e/cleanup-devnet/mock-devnet.mjs`):
вона відповідає як devnet і має той самий набір рахунків, що й справжній прогін.
Причина: devnet SOL взяти ніде (див. нижче). Числа на екрані:

| | лампорти |
|---|---|
| Рента 5 порожніх рахунків (4 × 2 039 280 + 2 074 080 Token-2022) | 10 231 200 |
| Комісія Noventia, 7 % | 716 184 |
| Мережева комісія, 1 транзакція | 5 000 |
| Користувач отримує | 9 510 016 |

NFT, заморожений рахунок і рахунок з балансом стоять у «Left alone» з причиною
(«NFTs, never closed», «Frozen by the token issuer») і в транзакцію не потрапили:
вона мала 7 інструкцій (ліміт обчислень, 5 закриттів, переказ комісії).

**Знайдена помилка, виправлена:** коли гаманець для комісії заданий, а рахунок
для комісії свопів ще ні, модуль відмовлявся будувати й очищення теж. Власник
дає гаманець першим, тож очищення не відкрилося б зовсім. Виправлено в 0.1.3:
рахунок свопів тепер блокує лише свопи. Тест додано.

## Перша спроба, 1 листопада: тестовий процес упав після поповнення

Власник поповнив адресу `HdsG6X4qbJuoiruouQPP4Pn56XRziDLRDQicRJomGwvs` на
1 devnet SOL о 10:42 UTC. Тестовий гаманець зробив 5 транзакцій налаштування,
після чого публічний RPC devnet відповів 429 (забагато запитів). Тестовий
процес не повторював запит і завершився, а ключ зник разом із ним. Решта коштів
на тій адресі недосяжна. Це помилка тестового набору, не застосунку.

Виправлено в `e2e/cleanup-devnet`:
* кожен запит до RPC повторюється з паузою, що зростає;
* після поповнення процес не завершується через помилку: налаштування
  зупиняється й продовжується з того самого місця;
* запити застосунку йдуть до devnet через тестовий гаманець, який так само
  повторює запит після 429.

Окремо записано в BACKLOG: модуль у застосунку теж не повторює запит після 429.

## Devnet SOL для наступного прогону

Тимчасовому гаманцю щоразу потрібен devnet SOL, а взяти його автоматично ніде:

* RPC-кран devnet закрито: `requestAirdrop` відповідає HTTP 410 «The RPC faucet
  is closed on this cluster. Request test SOL at https://faucet.solana.com».
* https://faucet.solana.com просить captcha або вхід через GitHub. Обходити
  captcha агент не буде.
* Публічні RPC без ключа (Alchemy demo, Ankr, OnFinality) або вимагають ключ,
  або обмежують запити. Ключ Helius від рушія для цього не використано: його
  безкоштовний план не має крана на devnet, і це чужий ключ.

### Крок власника (5 хвилин, коли агент запустить прогін)

1. Агент запускає `bash .e2e/run-devnet.sh <тека>`. Скрипт друкує рядок
   `FUND <адреса> with at least 0.1 devnet SOL` і чекає `FUND_WAIT_MIN` хвилин
   (типово 60; для прогону, де власник поповнює пізніше, агент ставить 720).
2. Власник відкриває https://faucet.solana.com, мережа **devnet**, вставляє цю
   адресу, сума 0.5 або 1 SOL, проходить captcha.
3. Далі все йде само: тестові рахунки, чотири кроки на емуляторі, перевірка з
   ланцюгом, таблиця доказів з посиланнями на explorer.

Ключ живе лише в пам'яті процесу (WebCrypto, non-extractable): його не можна
вивести, зберегти чи закомітити, і він зникає разом з процесом. Тому адресу
можна поповнити тільки поки прогін іде, заздалегідь не вийде.

## Що доводить перевірка (`check.mjs`)

| Перевірка | Як |
|---|---|
| Комісія в тій самій транзакції | у кожній підписаній транзакції є `closeAccount` і рівно один `transfer` на гаманець комісії |
| Показана сума = переміщена сума | «Noventia fee» на екрані = сума переказу = зміна балансу гаманця комісії; «You receive» = зміна балансу власника; мережева комісія = `meta.fee` |
| NFT не зачеплено | адреси NFT і його mint немає в жодній підписаній транзакції; після прогону рахунок має 1 токен |
| Заморожений рахунок пропущено з причиною | на екрані «Frozen by the token issuer»; рахунку немає в транзакціях; після прогону він є і `frozen` |
| Порожні рахунки закриті | після прогону їх немає в ланцюгу |

Набір для прогону: `e2e/cleanup-devnet/` (README там же).
