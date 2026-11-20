require("node:fs").mkdirSync(
  require("node:path").join(__dirname, "../test-results"),
  { recursive: true },
);
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("fs");
const root = require("node:path").resolve(__dirname, "..");
const m = require(root + "/src/state.cjs"),
  backup = require(root + "/src/domain/tasting/backup");
let s = m.empty();
s.collection = m.d.mutate(
  s.collection,
  {
    type: "itemSave",
    item: { id: "native-tea-01", kind: "tea", name: "小程序迁入茶" },
    expectedVersion: 0,
  },
  "native-request-01",
  "2026-11-20T12:00:00Z",
).data;
const b = backup.make(
  s.collection,
  "test-owner",
  m.core.makeBackup(m.core.empty(), "test-owner"),
  "2026-11-20T12:00:00Z",
);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext(),
    p = await ctx.newPage();
  await p.goto("http://localhost:4173/#backup");
  await p
    .locator("#backup-file")
    .setInputFiles({
      name: "native-v4.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(b)),
    });
  await p.getByRole("button", { name: "确认补回缺失记录" }).click();
  await p.locator("#import-preview .panel").waitFor({ state: "hidden" });
  await p.goto("http://localhost:4173/#item/native-tea-01");
  await p.getByRole("heading", { name: "小程序迁入茶", exact: true }).waitFor();
  await p.getByRole("button", { name: "编辑档案" }).click();
  await p.locator("[name=name]").fill("此输入不能被覆盖");
  const p2 = await ctx.newPage();
  await p2.goto("http://localhost:4173/#article/T-U01-L01");
  await p2.getByRole("button", { name: "收藏 ☆", exact: true }).click();
  await p2.getByRole("button", { name: "已收藏 ★", exact: true }).waitFor();
  await p.getByRole("button", { name: "保存珍藏", exact: true }).click();
  await p
    .locator(".form-error")
    .filter({ hasText: "另一标签页已更新" })
    .waitFor();
  assert.equal(await p.locator("[name=name]").inputValue(), "此输入不能被覆盖");
  console.log(
    "PASS native V4 checksum import / optimistic concurrency / draft preserved",
  );
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.reload();
  await p2.getByRole("button", { name: "写一则笔记" }).waitFor();
  await p2.locator(".article-body img").first().waitFor();
  await ctx.setOffline(true);
  await p2.reload();
  await p2.getByRole("button", { name: "写一则笔记" }).waitFor();
  assert.ok(await p2.locator(".article-body").textContent());
  console.log("PASS offline visited article");
  const deny = await browser.newContext();
  await deny.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error("storage test denied");
    };
  });
  const p3 = await deny.newPage();
  await p3.goto("http://localhost:4173/#article/T-U01-L01");
  await p3.getByRole("button", { name: "收藏 ☆", exact: true }).click();
  await p3.locator("#toast").filter({ hasText: "暂时无法保存" }).waitFor();
  assert.equal(
    await p3.getByRole("button", { name: "已收藏 ★", exact: true }).count(),
    0,
  );
  console.log("PASS storage denied never reports saved");
  await browser.close();
  fs.writeFileSync(
    require("node:path").join(
      __dirname,
      "../test-results/boundary-results.json",
    ),
    JSON.stringify(
      {
        nativeV4: true,
        multiTabConflict: true,
        draftPreserved: true,
        offlineVisitedArticle: true,
        storageDenied: true,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
