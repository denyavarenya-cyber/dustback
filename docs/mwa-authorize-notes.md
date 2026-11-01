# MWA sessions: stop calling reauthorize

Notes from debugging a Mobile Wallet Adapter integration on Android
(September 2026, `@solana-mobile/mobile-wallet-adapter-protocol-web3js`
2.3.0, tested against Phantom).

## The symptom

Connect succeeds. The user then taps sign, and instead of a transaction
approval the wallet opens its full connect sheet again, as if the app had
never been authorized.

## What was actually happening

Our signing flow followed the old MWA 1.0 pattern:

```ts
const auth = await wallet
  .reauthorize({ auth_token, identity })
  .catch(() => wallet.authorize({ identity, chain }));
```

Two problems hide in these four lines.

First, `reauthorize` is deprecated. The
[MWA 2.0 spec](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#authorize)
folded it into `authorize`: pre-2.0 versions "defined a separate
`reauthorize` method", and the optional `auth_token` parameter on
`authorize` now covers reauthorization. A wallet that implements the 2.0
protocol has little reason to be generous toward the legacy method. The
client library still exposes `reauthorize` and its type definitions carry no
deprecation warning, so nothing pushes you off it.

Second, the `.catch` swallows the rejection. Whatever the wallet objects
to — deprecated method, expired token, anything — the code silently degrades
to a full `authorize`, which is exactly the wallet's connect sheet. The root
cause never appears in any log; the user just sees a connect prompt where a
signature prompt should be.

Phantom in particular is known to fail the reauth path with an authorization
error rather than smoothly re-prompting
([mobile-wallet-adapter#1221](https://github.com/solana-mobile/mobile-wallet-adapter/issues/1221)).
Token lifetime is explicitly the wallet's business — the spec declines to
define one — so treat any stored token as possibly dead.

## The pattern that works

Call `authorize` with the stored token. While the token is valid, the wallet
reauthorizes silently, with no UI at all. When the wallet rejects the token,
discard it (the spec is explicit that a token rejected with
`ERROR_AUTHORIZATION_FAILED` must not be reused) and authorize fresh in the
same session:

```ts
const auth = authToken
  ? await wallet
      .authorize({ identity, chain, auth_token: authToken })
      .catch((e) => {
        log('token rejected', e); // do not swallow this silently
        return wallet.authorize({ identity, chain });
      })
  : await wallet.authorize({ identity, chain });
```

One trap worth calling out: `ERROR_AUTHORIZATION_FAILED` is code `-1`, and
`-1` is also what you get when the user declines an authorization request.
If you map `-1` straight to "user declined", an expired token turns into a
phantom decline message for a user who never saw a prompt. The order
matters: a rejection of the *token-bearing* call means the token is dead —
retry fresh; only a rejection of the *fresh* call is the user saying no.

## Takeaways

- Never call `reauthorize`; use `authorize({ auth_token })` (MWA 2.0).
- Never swallow the token rejection silently — log it; it is the difference
  between "expired token" and "wallet rejects the method".
- Interpret `-1` by which call it came from, not globally.
- Assume tokens can die at any time; the spec gives wallets full discretion.
