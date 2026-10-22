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
  await page.addInitScript(() => {
    let state = {
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "NOT_CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    };
    const connected = {
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "persona@example.test",
      lastError: null,
    };
    window.aijianGrok = {
      status: async () => state,
      signIn: async () => {
        state = connected;
        return { kind: "OK", status: state };
      },
      cancel: async () => ({ kind: "CANCELLED", status: state }),
      signOut: async () => {
        state = { ...connected, state: "NOT_CONNECTED", accountLabel: null };
        return { kind: "OK", status: state };
      },
      models: async () => ({
        kind: "OK",
        models: [
          { id: "grok-4.3", label: "Grok 4.3" },
          { id: "grok-imagine-image-2.0", label: "Grok Imagine Image 2.0" },
        ],
      }),
      completeText: async () => ({
        kind: "ERROR",
        code: "ENTITLEMENT_DENIED",
        billingAccountKind: "grok_login",
      }),
    };
  });
  const steps = [];
  let clicks = 0;
  const shot = async (name) =>
    steps.push({ clicks, ...(await snap(page, `${viewport.width}-${persona}-${name}`)) });

  await page.goto(`${baseUrl}#launch`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".demo-root");
  await shot("01-launch");
  await page.getByRole("button", { name: "进入创作工作台" }).click();
  clicks += 1;
  const choiceButton = page.locator("dialog.first-run-service-choice").getByRole("button", {
    name: "用 Grok 账号登录",
  });
  await choiceButton.waitFor({ state: "visible", timeout: 8000 });
  await shot("02-service-choice");
  await choiceButton.click();
  clicks += 1;
  await page.waitForSelector(".main-panel.page-services");
  await page.getByText("persona@example.test").first().waitFor({ timeout: 8000 });
  await page
    .locator("#model-center")
    .getByText("Grok 账号暂不提供配音模型")
    .waitFor({ timeout: 8000 });
  await page
    .locator("#model-center")
    .getByText("Grok 账号暂不提供视频模型")
    .waitFor({ timeout: 8000 });
  await page.getByRole("combobox", { name: "图像模型" }).waitFor({ timeout: 8000 });
  const chip = page.getByRole("group", { name: "用户菜单" }).locator("summary");
  await chip.getByText("persona@example.test").waitFor({ timeout: 8000 });
  await shot("03-grok-card");
  const model = page.locator("#model-center select").first();
  await model
    .locator("option", { hasText: "Grok 4.3" })
    .waitFor({ state: "attached", timeout: 8000 });
  const options = await model.locator("option").allTextContents();
  steps.push({ clicks, name: "model-options", persona, text: options.join(" | ") });
  await model.selectOption({ label: "Grok 4.3 · Grok 账号" });
  clicks += 1;
  const probe = page.getByRole("button", { name: "检查这次订阅能否推理" });
  await probe.scrollIntoViewIfNeeded();
  await probe.click();
  clicks += 1;
  await page.getByText("403").first().waitFor({ timeout: 8000 });
  await shot("04-entitlement-403");

  const trySandbox = page.getByRole("button", { name: "看看媒体沙箱（不产生费用）" });
  await trySandbox.scrollIntoViewIfNeeded();
  await trySandbox.click();
  clicks += 1;
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
