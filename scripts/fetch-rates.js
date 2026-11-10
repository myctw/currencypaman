// 從 HaoRate (RateWise) 開放資料 API v3 取得臺灣銀行牌告匯率,寫入 rates.json
// API 說明: https://app.haotool.org/ratewise/open-data/
// 需要 Node 18+ (內建 fetch)。用法: node scripts/fetch-rates.js
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASES = [
  "https://cdn.jsdelivr.net/gh/haotool/app@data/public/rates/v3/",
  "https://raw.githubusercontent.com/haotool/app/data/public/rates/v3/", // 備援
];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rates.json");
const HEADERS = { "User-Agent": "currency-board-updater (GitHub Actions)" };

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// 依 API 規範:讀 current → manifest → provider snapshot,並驗證每個物件的 SHA-256
async function verified(base, ref) {
  const text = await getText(new URL(ref.path, base));
  const hash = createHash("sha256").update(text).digest("hex");
  if (hash !== ref.sha256) throw new Error(`SHA-256 不符: ${ref.path}`);
  return JSON.parse(text);
}

async function load(base) {
  const current = JSON.parse(await getText(base + "current.json"));
  const manifest = await verified(base, current.manifest);
  const bot = manifest.providers.find((p) => p.providerId === "bot");
  if (!bot) throw new Error("manifest 內沒有臺灣銀行資料");
  const snapshot = await verified(base, bot.snapshot);
  return { manifest, bot, snapshot };
}

export function toRates(snapshot) {
  const rates = {};
  let published = 0;
  for (const q of snapshot.quotes) {
    const s = q.sourceQuote;
    if (q.toCurrency !== "TWD" || q.status !== "available" || !s) continue;
    // cash = 現金匯率, account = 即期匯率(帳戶)
    const kind = s.deliveryMethod === "cash" ? "cash" : s.deliveryMethod === "account" ? "spot" : null;
    if (!kind) continue;
    const unit = parseFloat(s.unitAmount) || 1;
    const buy = parseFloat(s.providerBuyPrice) / unit;
    const sell = parseFloat(s.providerSellPrice) / unit;
    if (!(buy > 0) || !(sell > 0)) continue;
    const r = (rates[q.fromCurrency] ??= { cashBuy: null, spotBuy: null, cashSell: null, spotSell: null });
    r[kind + "Buy"] = buy;
    r[kind + "Sell"] = sell;
    published = Math.max(published, Date.parse(s.sourcePublishedAt) || 0);
  }
  if (!Object.keys(rates).length) throw new Error("沒有解析到任何匯率");
  return { rates, published };
}

let data, lastErr;
for (const base of BASES) {
  try { data = await load(base); break; } catch (e) { lastErr = e; console.warn(String(e)); }
}
if (!data) throw lastErr;

const { rates, published } = toRates(data.snapshot);

let old = null;
try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
if (old && JSON.stringify(old.rates) === JSON.stringify(rates)) {
  console.log("匯率沒有變動,略過寫入");
} else {
  const out = {
    source: "臺灣銀行牌告匯率",
    sourceUrl: "https://rate.bot.com.tw/xrt",
    attribution: data.bot.attribution,
    publisher: data.manifest.publisher, // { name, url, requiredText }
    // 臺灣銀行牌告實際變動的時間 (ISO UTC)
    updatedAt: new Date(published || Date.now()).toISOString(),
    rates,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`已更新 ${Object.keys(rates).length} 種幣別`);
}
