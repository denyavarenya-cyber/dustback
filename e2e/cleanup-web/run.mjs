// Runs walk.mjs in Chromium. Needs playwright-core 1.63.0 and its Chromium:
//   npm i --no-save playwright-core@1.63.0 && npx playwright-core install chromium
//   OUT=shots node run.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import walk from "./walk.mjs";

mkdirSync(process.env.OUT ?? "shots", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  console.log(JSON.stringify(await walk(await browser.newPage()), null, 2));
} finally {
  await browser.close();
}
