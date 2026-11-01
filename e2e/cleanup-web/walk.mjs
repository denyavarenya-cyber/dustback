// Web walk of wallet cleanup: a test Wallet Standard wallet registered in the page
// (its key stays in the local stand-in on 8799; the page never holds one), then the
// passport block, connect, select, confirm, result. Local stand-in RPC only.
const OUT = process.env.OUT ?? "shots";

const WALLET = `(() => {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const o = []; while (n > 0n) { o.unshift(Number(n % 256n)); n /= 256n; } for (const c of s) { if (c !== "1") break; o.unshift(0); } return new Uint8Array(o); };
  const toB64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let account = null;
  const wallet = {
    version: "1.0.0",
    name: "Test wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    chains: ["solana:devnet"],
    get accounts() { return account ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => {
        const { address } = await (await fetch("http://127.0.0.1:8797/address")).json();
        account = { address, publicKey: b58(address), chains: ["solana:devnet"], features: ["solana:signTransaction"] };
        return { accounts: [account] };
      } },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs) => {
        window.__signRequests = (window.__signRequests || 0) + inputs.length;
        const r = await fetch("http://127.0.0.1:8797/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: inputs.map((i) => toB64(i.transaction)) }) });
        const { signed } = await r.json();
        return signed.map((s) => ({ signedTransaction: fromB64(s) }));
      } },
    },
  };
  const cb = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => cb(e.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
})();`;

export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  const out = {};
  const text = () => page.evaluate(() => document.body.innerText);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const waitText = (t, ms = 30000) => page.waitForFunction((s) => document.body.innerText.includes(s), t, { timeout: ms });

  await page.setViewportSize({ width: 430, height: 932 });
  await page.addInitScript(WALLET);
  await page.goto("http://localhost:8095/");
  await waitText("Found in your wallets", 120000);
  await page.waitForTimeout(800);
  await shot("0-passport-block");
  out.block = (await text()).slice(0, 400);

  await page.getByText("Close the empty accounts", { exact: true }).click();
  await waitText("Test wallet");
  await page.waitForTimeout(500);
  await shot("1-connect");
  out.connect = (await text()).slice(0, 500);

  await page.getByText("Connect Test wallet", { exact: true }).click();
  await waitText("Select all");
  await page.getByText("Select all", { exact: true }).click();
  await waitText("You receive");
  await page.waitForTimeout(500);
  await shot("2-select");
  out.select = (await text()).slice(0, 1200);

  await page.getByText(/^Review \d+ accounts?$/).click();
  await waitText("Check before you sign");
  await page.waitForTimeout(500);
  await shot("3-confirm");
  out.confirm = (await text()).slice(0, 1500);
  out.signRequestsBeforeSign = await page.evaluate(() => window.__signRequests || 0);

  await page.getByText("Sign in wallet", { exact: true }).click();
  await waitText("Scan again", 60000);
  await page.waitForTimeout(500);
  await shot("4-result");
  out.result = (await text()).slice(0, 600);
  out.signRequests = await page.evaluate(() => window.__signRequests || 0);
  out.errors = errors;
  return out;
}
