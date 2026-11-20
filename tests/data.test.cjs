const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const model = require("../src/state.cjs"),
  { d, t, core } = model,
  backup = require("../src/domain/tasting/backup");
const at = "2026-11-20T12:00:00.000Z";
let n = 0;
const uid = () => `record-${++n}`;
function fixture() {
  let s = model.empty();
  s.collection = d.mutate(
    s.collection,
    {
      type: "itemSave",
      item: { id: "item-tea-01", kind: "tea", name: "测试茶" },
      expectedVersion: 0,
    },
    uid(),
    at,
  ).data;
  s.collection = d.mutate(
    s.collection,
    {
      type: "batchSave",
      batch: {
        id: "batch-tea-01",
        itemId: "item-tea-01",
        label: "测试批次",
        quantity: "100",
        unit: "g",
      },
      expectedVersion: 0,
    },
    uid(),
    at,
  ).data;
  return s;
}
test("inventory uses exact decimals and rejects insufficient stock", () => {
  const s = fixture();
  assert.equal(d.stock(s.collection, "batch-tea-01"), 100000);
  assert.throws(() =>
    d.mutate(
      s.collection,
      {
        type: "adjust",
        batchId: "batch-tea-01",
        expectedVersion: 1,
        delta: "-100.001",
        reason: "测试",
      },
      uid(),
      at,
    ),
  );
  assert.equal(d.stock(s.collection, "batch-tea-01"), 100000);
  assert.equal(d.decimal("0.001", 3), 1);
  assert.throws(() => d.decimal("1e3", 3));
});
test("session editing reverses prior consumption and cancellation restores inventory", () => {
  const s = fixture();
  let c = s.collection;
  const session = {
    id: "session-tea-01",
    kind: "tea",
    title: "测试手记",
    itemId: "item-tea-01",
    batchId: "batch-tea-01",
    used: "5",
    unit: "g",
    stockConfirmed: true,
  };
  c = t.plan(
    c,
    {
      type: "sessionSave",
      session,
      expectedVersion: 0,
      batchVersions: { "batch-tea-01": 1 },
    },
    uid(),
    at,
  ).data;
  assert.equal(d.stock(c, "batch-tea-01"), 95000);
  c = t.plan(
    c,
    {
      type: "sessionSave",
      session: { ...session, used: "3.001" },
      expectedVersion: 1,
      batchVersions: { "batch-tea-01": 2 },
    },
    uid(),
    at,
  ).data;
  assert.equal(d.stock(c, "batch-tea-01"), 96999);
  c = t.plan(
    c,
    {
      type: "sessionCancel",
      id: session.id,
      reason: "测试撤销",
      expectedVersion: 2,
      batchVersions: { "batch-tea-01": 3 },
    },
    uid(),
    at,
  ).data;
  assert.equal(d.stock(c, "batch-tea-01"), 100000);
  assert.throws(() =>
    t.plan(
      c,
      {
        type: "sessionCancel",
        id: session.id,
        reason: "重复",
        expectedVersion: 3,
      },
      uid(),
      at,
    ),
  );
});
test("web backup round trip preserves photos and drafts and import is idempotent", () => {
  const s = fixture();
  s.photos.push({
    id: "photo-01",
    entityId: "item-tea-01",
    mime: "image/png",
    data: "data:image/png;base64,YWJj",
  });
  s.drafts["journal-draft"] = { title: "未完成" };
  const b = model.exportWeb(s);
  const p = model.previewImport(model.empty(), b);
  assert.deepEqual(p.state.collection, s.collection);
  assert.deepEqual(p.state.photos, s.photos);
  assert.deepEqual(p.state.drafts, s.drafts);
  const twice = model.previewImport(p.state, b);
  assert.equal(twice.counts.items, 0);
  assert.equal(twice.counts.photos, 0);
  assert.equal(twice.counts.transactions, 0);
});
test("corrupted backup is rejected without changing current records", () => {
  const s = fixture(),
    before = JSON.stringify(s),
    b = model.exportWeb(s);
  b.payload.collection.items[0].name = "篡改";
  assert.throws(() => model.previewImport(s, b), /校验失败/);
  assert.equal(JSON.stringify(s), before);
});
test("V4 original checksums, independent session integrity and legacy checksum are verified", () => {
  const s = fixture(),
    fp = "test-owner",
    legacy = core.makeBackup(core.empty(), fp, at),
    b = backup.make(s.collection, fp, legacy, at);
  const p = model.previewImport(model.empty(), b);
  assert.equal(p.state.collection.items.length, 1);
  assert.match(p.warning, /照片/);
  const bad = JSON.parse(JSON.stringify(b));
  bad.legacy.payload.journals.push({ id: "bad-id" });
  const { sha256, ...rest } = bad;
  bad.sha256 = d.hash(rest);
  assert.throws(() => model.previewImport(model.empty(), bad));
});
test("conflicting inventory components are not partially restored", () => {
  const s = fixture();
  const b = model.exportWeb(s);
  const changed = fixture();
  changed.collection = d.mutate(
    changed.collection,
    {
      type: "adjust",
      batchId: "batch-tea-01",
      expectedVersion: 1,
      delta: "-5",
      reason: "使用",
    },
    uid(),
    at,
  ).data;
  const p = model.previewImport(changed, b);
  assert.equal(d.stock(p.state.collection, "batch-tea-01"), 95000);
  assert.ok(p.conflicts > 0);
});
test("all 301 entries and 1084 questions retained with unique IDs", () => {
  const index = require("../static/data/index.json"),
    q = require("../static/data/questions.json");
  assert.equal(index.units.length, 12);
  assert.equal(index.entries.length, 301);
  assert.equal(new Set(index.entries.map((e) => e.id)).size, 301);
  assert.equal(Object.keys(q.questions).length, 1084);
  for (const e of index.entries) {
    const c = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../static/data", e.id + ".json")),
    );
    assert.ok(c.sections.length);
    for (const id of c.questionIds) assert.ok(q.questions[id], id);
    for (const s of c.sections)
      for (const m of s.markdown.matchAll(/!\[[^\]]*\]\((assets[^\s)]+)\)/g))
        assert.ok(
          fs.existsSync(
            path.join(__dirname, "../static", decodeURIComponent(m[1])),
          ),
          m[1],
        );
  }
});
test("all 472 shipped images match V1.23 byte hashes", () => {
  const manifest = require("../SOURCE-MANIFEST.json");
  assert.equal(Object.keys(manifest.files).length, 472);
  for (const [p, hash] of Object.entries(manifest.files))
    assert.equal(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, "../static/assets", p)))
        .digest("hex"),
      hash,
      p,
    );
});
test("unknown format and unsupported web version are rejected", () => {
  assert.throws(() =>
    model.previewImport(model.empty(), { format: "unknown" }),
  );
  const b = model.exportWeb(model.empty());
  b.schemaVersion = 99;
  const { sha256, ...rest } = b;
  b.sha256 = d.hash(rest);
  assert.throws(() => model.previewImport(model.empty(), b));
});
