const d = require("./domain/collection/domain"),
  t = require("./domain/tasting/domain"),
  core = require("./domain/core"),
  backup = require("./domain/tasting/backup");
const clone = (x) => JSON.parse(JSON.stringify(x));
const empty = () => ({
  revision: 0,
  learning: core.empty(),
  collection: { ...d.empty(), sessions: [] },
  photos: [],
  extra: { bookmarks: [], attempts: [], notes: [], progress: {} },
  drafts: {},
  archives: [],
});
function validate(s) {
  if (!s || !Number.isSafeInteger(s.revision) || s.revision < 0)
    throw Error("数据版本异常");
  core.sanitize(s.learning);
  t.validate(s.collection);
  for (const k of ["photos", "archives"])
    if (!Array.isArray(s[k])) throw Error("备份结构异常");
  if (
    !s.extra ||
    !Array.isArray(s.extra.bookmarks) ||
    !Array.isArray(s.extra.attempts) ||
    !Array.isArray(s.extra.notes) ||
    !s.extra.progress ||
    !s.drafts
  )
    throw Error("学习数据结构异常");
  const ids = new Set();
  for (const p of s.photos) {
    if (
      !p.id ||
      ids.has(p.id) ||
      !["image/jpeg", "image/png", "image/webp"].includes(p.mime) ||
      typeof p.data !== "string" ||
      !p.data.startsWith("data:" + p.mime + ";base64,") ||
      p.data.length > 12000000
    )
      throw Error("照片格式或大小无效");
    ids.add(p.id);
  }
  if (JSON.stringify(s).length > 180000000)
    throw Error("备份过大，请先分档保存照片");
  return s;
}
function exportWeb(state) {
  validate(state);
  const value = {
    format: "WENXIANG_GUANCHA_WEB_V1",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    includesUserImages: true,
    payload: clone(state),
  };
  return { ...value, sha256: d.hash(value) };
}
function mergeArray(a, b) {
  const map = new Map(a.map((x) => [x.id, x]));
  let conflicts = 0;
  for (const row of b) {
    if (!map.has(row.id)) map.set(row.id, row);
    else if (d.hash(row) !== d.hash(map.get(row.id))) conflicts++;
  }
  return { rows: [...map.values()], conflicts };
}
function previewImport(current, file) {
  const next = clone(current);
  let incoming,
    legacy,
    photo = [],
    extra,
    archives = [],
    drafts = {},
    warning = "";
  if (file?.format === "WENXIANG_GUANCHA_WEB_V1") {
    const { sha256, ...value } = file;
    if (file.schemaVersion !== 1 || d.hash(value) !== sha256)
      throw Error("网页备份校验失败，文件可能损坏");
    validate(file.payload);
    incoming = file.payload.collection;
    legacy = file.payload.learning;
    photo = file.payload.photos;
    extra = file.payload.extra;
    archives = file.payload.archives;
    drafts = file.payload.drafts;
  } else if (file?.format === backup.FORMAT) {
    incoming = backup.verify(file, file.ownerFingerprint);
    legacy = core.verifyBackup(file.legacy, file.ownerFingerprint);
    warning =
      "小程序照片原件不在此备份中，请另行添加。导入依据文件完整性，网页版不核验微信登录身份。";
    archives = [file];
  } else if (file?.format === d.FORMAT) {
    incoming = { ...d.verifyBackup(file, file.ownerFingerprint), sessions: [] };
    legacy = core.verifyBackup(file.legacy, file.ownerFingerprint);
    warning = "此版本不含清赏手记及照片原件，建议优先使用小程序 V4 备份。";
    archives = [file];
  } else if (file?.format === core.FORMAT) {
    legacy = core.verifyBackup(file, file.ownerFingerprint);
    incoming = { ...d.empty(), sessions: [] };
    warning = "旧版学习备份，不含新版珍藏、清赏手记和照片原件。";
    archives = [file];
  } else if (file?.format === "WENXIANG_GUANCHA_LOCAL_COLLECTION_V1") {
    if (!file.data || !Array.isArray(file.data.items))
      throw Error("本机档案结构无效");
    incoming = { ...d.empty(), sessions: [] };
    for (const item of file.data.items) {
      const fields = d.itemFields({
        ...item,
        rating: item.rating == null ? "" : String(item.rating),
        capacity:
          item.capacityMilli == null ? "" : String(item.capacityMilli / 1000),
      });
      incoming.items.push({
        ...fields,
        version: item.version || 1,
        createdAt: item.createdAt || file.exportedAt,
        updatedAt: item.updatedAt || file.exportedAt,
        legacyOriginal: item,
      });
    }
    warning =
      "旧本机档案没有完整性校验码；仅导入藏品文字，原照片路径不能跨设备使用，原文件随网页备份保留。";
    archives = [file];
  } else
    throw Error(
      "不支持的文件：请选择网页备份，或小程序 V1/V2/V3/V4、本机珍藏 JSON",
    );
  let conflicts = 0;
  const before = counts(current);
  if (incoming) {
    const plan = backup.restorePlan(next.collection, {
      ...incoming,
      sessions: incoming.sessions || [],
    });
    next.collection = plan.data;
    conflicts += plan.counts.conflicts;
  }
  if (legacy) {
    const merge = core.mergeStates(next.learning, legacy);
    next.learning = merge.state;
    conflicts += merge.counts.conflicts;
  }
  if (extra) {
    for (const name of ["attempts", "notes"]) {
      const r = mergeArray(next.extra[name], extra[name]);
      next.extra[name] = r.rows;
      conflicts += r.conflicts;
    }
    next.extra.bookmarks = [
      ...new Set([...next.extra.bookmarks, ...extra.bookmarks]),
    ];
    next.extra.progress = { ...extra.progress, ...next.extra.progress };
  }
  const mp = mergeArray(next.photos, photo);
  next.photos = mp.rows;
  conflicts += mp.conflicts;
  next.drafts = { ...drafts, ...next.drafts };
  for (const a of archives)
    if (!next.archives.some((x) => d.hash(x) === d.hash(a)))
      next.archives.push(a);
  validate(next);
  const after = counts(next);
  return {
    state: next,
    counts: Object.fromEntries(
      Object.keys(before).map((k) => [k, after[k] - before[k]]),
    ),
    conflicts,
    warning,
  };
}
function counts(s) {
  return {
    items: s.collection.items.length + s.learning.collections.length,
    sessions: s.collection.sessions.length + s.learning.journals.length,
    batches: s.collection.batches.length,
    transactions: s.collection.transactions.length,
    notes: s.learning.notes.length + s.extra.notes.length,
    attempts:
      s.learning.attempts.length +
      s.learning.openAttempts.length +
      s.extra.attempts.length,
    bookmarks:
      s.learning.bookmarks.length +
      s.learning.referenceBookmarks.length +
      s.extra.bookmarks.length,
    photos: s.photos.length,
  };
}
module.exports = {
  empty,
  validate,
  exportWeb,
  previewImport,
  counts,
  d,
  t,
  core,
  clone,
};
