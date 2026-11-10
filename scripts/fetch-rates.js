// 抓取臺灣銀行牌告匯率 (https://rate.bot.com.tw/xrt) 並寫入 rates.json
// 需要 Node 18+ (內建 fetch)。用法: node scripts/fetch-rates.js
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CSV_URL = "https://rate.bot.com.tw/xrt/flcsv/0/day";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rates.json");

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null; // "0.00000" 或 "-" 代表該牌價未提供
}

function decode(buf) {
  let text = new TextDecoder("utf-8").decode(buf);
  if (!text.includes("幣別")) text = new TextDecoder("big5").decode(buf);
  return text;
}

export function parseCsv(text) {
  const rates = {};
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  if (!lines[0] || !lines[0].includes("幣別")) throw new Error("不是預期的 CSV 格式 (可能被擋或網站改版)");
  for (const line of lines.slice(1)) {
    const c = line.split(",").map((s) => s.trim());
    const code = (c[0].match(/[A-Z]{3}/) || [])[0];
    const b = c.indexOf("本行買入");
    const s = c.indexOf("本行賣出");
    if (!code || b < 0 || s < 0) continue;
    rates[code] = {
      cashBuy: num(c[b + 1]),
      spotBuy: num(c[b + 2]),
      cashSell: num(c[s + 1]),
      spotSell: num(c[s + 2]),
    };
  }
  if (!Object.keys(rates).length) throw new Error("沒有解析到任何匯率");
  return rates;
}

const res = await fetch(CSV_URL, {
  headers: { "User-Agent": "currency-board-updater (GitHub Actions)" },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const rates = parseCsv(decode(new Uint8Array(await res.arrayBuffer())));

let old = null;
try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
if (old && JSON.stringify(old.rates) === JSON.stringify(rates)) {
  console.log("匯率沒有變動,略過寫入");
} else {
  const out = {
    source: "臺灣銀行牌告匯率",
    sourceUrl: "https://rate.bot.com.tw/xrt",
    updatedAt: new Date().toISOString(),
    rates,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`已更新 ${Object.keys(rates).length} 種幣別`);
}
