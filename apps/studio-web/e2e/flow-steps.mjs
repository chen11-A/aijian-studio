/**
 * Counts clicks for the no-charge creation path and saves the text each
 * persona actually sees. Does not call a model or start the API.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.AIVORA_AUDIT_URL ?? "http://127.0.0.1:5173/";
const outDir = process.env.AIVORA_FLOW_OUT ?? "/tmp/ui-audit/flow";

async function snap(page, name) {
  const file = path.join(outDir, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 60 });
  const text = await page.locator("body").innerText();
  return { name, file, text: text.slice(0, 4000) };
}

async function run(viewport, persona) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const steps = [];
  let clicks = 0;
  const shot = async (name) =>
    steps.push({ clicks, ...(await snap(page, `${viewport.width}-${persona}-${name}`)) });

  await page.goto(`${baseUrl}#launch`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".demo-root");
  await shot("01-launch");
  await page.getByRole("button", { name: "进入创作工作台" }).click();
  clicks += 1;
  const choice = persona === "novice" ? "暂时离线创作" : "连接 Grok（API Key）";
  const choiceButton = page.locator("dialog.first-run-service-choice").getByRole("button", {
    name: choice,
  });
  await choiceButton.waitFor({ state: "visible", timeout: 8000 });
  await shot("02-service-choice");
  await choiceButton.click();
  clicks += 1;
  await page.waitForSelector(
    persona === "novice" ? ".main-panel.page-home" : ".main-panel.page-services",
  );
  await shot("03-after-choice");
  if (persona === "pro") {

  const key = page.getByLabel("xAI 密钥");
  if (await key.isVisible().catch(() => false)) {
    await key.fill("xai-sandbox-demo-key-0001");
    const connect = page.getByRole("button", { name: "连接 API Key（沙箱）" });
    if (!(await connect.isVisible())) await connect.scrollIntoViewIfNeeded();
    await connect.click();
    clicks += 1;
    await page.waitForTimeout(200);
  }
    await shot("03-after-sandbox-key");
  }

  const model = page.locator("#model-center select").first();
  if (persona === "pro" && (await model.count())) {
    const options = await model.locator("option").allTextContents();
    steps.push({ clicks, name: "model-options", text: options.join(" | ") });
    const value = await model.locator("option").nth(1).getAttribute("value");
    if (value) {
      await model.selectOption(value);
      clicks += 1;
    }
  }

  if (persona === "pro") {
    const trySandbox = page.getByRole("button", { name: "看看媒体沙箱（不产生费用）" });
    await trySandbox.scrollIntoViewIfNeeded();
    await trySandbox.click();
    clicks += 1;
  } else {
    const sandbox = page.getByRole("button", { name: "试用沙箱创作" });
    await sandbox.click();
    clicks += 1;
  }
  await page.waitForSelector(".main-panel.page-generation");
  await shot("05-sandbox");

  const submit = page.getByRole("button", { name: "沙箱提交" });
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    clicks += 1;
    await page.waitForTimeout(150);
  }
  await shot("06-sandbox-submitted");

  await browser.close();
  return { viewport, persona, clicks, steps };
}

await mkdir(outDir, { recursive: true });
const viewports = [
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 911, height: 512 },
];
const report = [];
for (const viewport of viewports) {
  for (const persona of ["pro", "novice"]) report.push(await run(viewport, persona));
}
await writeFile(path.join(outDir, "flow.json"), JSON.stringify(report, null, 2));
console.log(
  report.map((item) => `${item.persona} ${item.viewport.width} clicks ${item.clicks}`).join("\n"),
);
