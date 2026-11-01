| Check | Result | Detail |
|---|---|---|
| every signed transaction is on devnet and succeeded | pass | 1 transaction(s) |
| the fee transfer is inside the same transaction as the closes | pass | raw, closeAccount, closeAccount, closeAccount, closeAccount, closeAccount, transfer |
| fee shown = fee transferred = fee wallet balance change | pass | shown 522732, transferred 522732, fee wallet +522732 |
| "You receive" shown = owner balance change on chain | pass | shown 6939868, owner +6939868 |
| network fee shown = network fee paid | pass | shown 5000, paid 5000 |
| rent shown = fee + network fee + received | pass | 7467600 = 522732 + 5000 + 6939868 |
| no signed transaction names the NFT or its mint | pass |  |
| no signed transaction names the frozen account | pass |  |
| the NFT account still holds its 1 token | pass | {"kind":"nft","account":"9B96cfsnZvXHqE6hJDfbSyahcDoCxAvjSUFjRpvJTU24","mint":"7tJeD5EXsheAKg4zai3bRLzpEBGW9L5dXXKADH6PqYvC","exists":true,"state":"initialized","amount":"1"} |
| the frozen account is still there, frozen | pass | {"kind":"frozen","account":"2RdXPZ1sC23RrqoHBb7N3YgkqXn6AFXbAnHpt6B8s7G3","mint":"2BWPXW35ZLXnC3amixLQq72Ew3UcSjFiL53QDRdh2jRn","exists":true,"state":"frozen","amount":"0"} |
| the account with a balance is still there | pass | {"kind":"balance","account":"4RJ1yhnAZZYW3CK4Afa9EipYHtkHLHQpRjF5gDkefYZf","mint":"2Ls3ZyEEzBgmUmEVSJqYxrymhMLG5196akKKNRbtPx4k","exists":true,"state":"initialized","amount":"1000000000"} |
| every selected empty account is closed | pass |  |
| the screen named the frozen account and its reason | pass | left alone: Frozen by the token issuer |
| the screen kept the NFT out | pass |  |
| the result screen says Confirmed | pass |  |

Signed by the app, on devnet:
- [2T5YSYCEKzfio3eCVzxH9rjxyvnTi9LCEbVJxy5qAtjx4PdermuVuTah3tbtz8KXGAiQUQQ1aX9PGzy9EfJGy2tA](https://explorer.solana.com/tx/2T5YSYCEKzfio3eCVzxH9rjxyvnTi9LCEbVJxy5qAtjx4PdermuVuTah3tbtz8KXGAiQUQQ1aX9PGzy9EfJGy2tA?cluster=devnet)
