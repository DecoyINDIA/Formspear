// Screenshot any local file (SVG/HTML) with headless Chrome: node shot.mjs <file> <out.png> [width] [height]
import puppeteer from 'puppeteer-core';
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [file, out, w = 1200, h = 560] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h });
await p.goto(pathToFileURL(path.resolve(file)).href); await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: out }); await b.close();
