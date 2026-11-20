require("node:fs").mkdirSync(
  require("node:path").join(__dirname, "../test-results"),
  { recursive: true },
);
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const ROOT = require("node:path").resolve(__dirname, ".."),
  BASE = "http://localhost:4173";
const read = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("wenxiang-guancha-web", 1);
        r.onsuccess = () => {
          const db = r.result,
            x = db
              .transaction("snapshots")
              .objectStore("snapshots")
              .get("main");
          x.onsuccess = () => {
            resolve(x.result);
            db.close();
          };
          x.onerror = () => reject(x.error);
        };
      }),
  );
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [],
    failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url() + ":" + r.status());
  });
  await page.goto(BASE + "/#collection");
  await page.getByRole("button", { name: "添一件珍藏" }).click();
  await page.locator('[data-kind="tea"]').click();
  await page.locator("[name=name]").fill("浏览器测试龙井");
  await page.locator("[name=category]").fill("绿茶");
  await page.locator("[name=region]").fill("杭州");
  await page.getByRole("button", { name: "保存珍藏", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "浏览器测试龙井", exact: true })
    .click();
  await page.getByRole("button", { name: "登记一批" }).click();
  await page.locator("[name=label]").fill("春茶测试批次");
  await page.locator("[name=quantity]").fill("100");
  await page.getByRole("button", { name: "保存批次", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await read(page)).collection.transactions[0].deltaMilli,
    100000,
  );
  await page.getByRole("button", { name: "添加照片", exact: false }).click();
  await page.locator("[name=caption]").fill("测试配图");
  await page
    .locator("#photo-file")
    .setInputFiles(ROOT + "/static/assets/images/handpainted/green-tea.webp");
  await page.getByRole("button", { name: "保存照片", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  assert.equal((await read(page)).photos.length, 1);
  await page
    .getByRole("heading", { name: "春茶测试批次", exact: true })
    .click();
  await page.getByRole("button", { name: "写手记", exact: true }).click();
  await page.locator("[name=title]").fill("浏览器测试品饮");
  await page.locator("[name=body]").fill("香气清爽，记录真实观察。");
  await page
    .locator("summary")
    .filter({ hasText: "关联藏品与使用参数" })
    .click();
  await page.locator("[name=used]").fill("5");
  await page.locator("[name=stockConfirmed]").check();
  await page.getByRole("button", { name: "加一泡" }).click();
  await page.locator("[data-field=aroma]").fill("豆香");
  await page.getByRole("button", { name: "保存手记", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  let s = await read(page);
  assert.equal(s.collection.sessions.length, 1);
  assert.equal(
    s.collection.transactions.reduce((n, x) => n + x.deltaMilli, 0),
    95000,
  );
  const session = s.collection.sessions[0].id;
  await page.goto(BASE + "/#session/" + session);
  await page.getByRole("button", { name: "编辑手记", exact: true }).click();
  await page.locator("[name=used]").fill("3.001");
  await page.getByRole("button", { name: "保存手记", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  s = await read(page);
  assert.equal(
    s.collection.transactions.reduce((n, x) => n + x.deltaMilli, 0),
    96999,
  );
  await page.getByRole("button", { name: "撤销这则手记" }).click();
  await page.locator("[name=reason]").fill("测试撤销");
  await page.getByRole("button", { name: "确认撤销", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  s = await read(page);
  assert.equal(
    s.collection.transactions.reduce((n, x) => n + x.deltaMilli, 0),
    100000,
  );
  console.log("PASS inventory/session/photo flow");
  await page.goto(BASE + "/#article/T-U01-L01");
  await page.getByRole("button", { name: "收藏 ☆", exact: true }).click();
  await page.getByRole("button", { name: "已收藏 ★", exact: true }).waitFor();
  await page.getByRole("button", { name: "写一则笔记" }).click();
  await page
    .locator("[name=body]")
    .fill("<img src=x onerror=alert(1)> 原样保存文本");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".note-card img").count(), 0);
  await page.getByRole("button", { name: "已读，留下进度" }).click();
  await page.getByRole("button", { name: "标记为未读" }).waitFor();
  await page.goto(BASE + "/#quiz/T-U01-L01");
  await page.locator("[name=choice]").first().check();
  await page.getByRole("button", { name: "保存作答并查看解析" }).click();
  await page.locator("#next-question").waitFor();
  assert.equal((await read(page)).extra.attempts.length, 1);
  console.log("PASS reading/bookmark/note/quiz");
  await page.goto(BASE + "/#backup");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载完整备份", exact: true }).click();
  const dl = await pending;
  const file = require("node:path").join(
    __dirname,
    "../test-results/roundtrip.json",
  );
  await dl.saveAs(file);
  const exported = JSON.parse(await fs.readFile(file));
  assert.equal(exported.payload.photos.length, 1);
  const ctx2 = await browser.newContext({ acceptDownloads: true }),
    p2 = await ctx2.newPage();
  await p2.goto(BASE + "/#backup");
  await p2.locator("#backup-file").setInputFiles(file);
  await p2.getByRole("button", { name: "确认补回缺失记录" }).click();
  await p2.locator("#import-preview .panel").waitFor({ state: "hidden" });
  let imported = await read(p2);
  assert.equal(imported.photos[0].data, exported.payload.photos[0].data);
  assert.deepEqual(imported.collection, exported.payload.collection);
  await p2.reload();
  await p2.getByRole("button", { name: "下载完整备份", exact: true }).waitFor();
  assert.equal((await read(p2)).extra.notes.length, 1);
  const bad = JSON.parse(JSON.stringify(exported));
  bad.payload.collection.items[0].name = "tampered";
  await p2
    .locator("#backup-file")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
  await p2.getByText("当前资料未改动。", { exact: false }).waitFor();
  assert.equal((await read(p2)).collection.items[0].name, "浏览器测试龙井");
  console.log("PASS backup roundtrip/reload/corruption protection");
  await page.goto(BASE + "/#home");
  for (const w of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "overflow " + w,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log("PASS responsive/no console errors/no failed HTTP", {
    errors,
    failed,
  });
  await fs.writeFile(
    require("node:path").join(__dirname, "../test-results/e2e-results.json"),
    JSON.stringify(
      {
        inventory: true,
        sessionEditCancel: true,
        photos: true,
        reading: true,
        quiz: true,
        backupRoundtrip: true,
        corruptionRejected: true,
        viewports: [320, 390, 768, 1440],
        errors,
        failed,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
