'use strict';
const crypto = require('node:crypto');
const knowledge = require('../data/knowledge-index.json');
const TABLES = ['items', 'batches', 'transactions', 'attachments', 'links'];
const LIMITS = { items: 500, batches: 1500, transactions: 6000, attachments: 500, links: 1000 };
const MAX_BYTES = 2400000;
const UNITS = ['g', '枚', '件', '支', 'ml', '本'];
const KINDS = ['incense', 'tea', 'equipment', 'teaware', 'incenseware', 'book', 'other'];
const FORMAT = 'WENXIANG_GUANCHA_COLLECTION_V3';
function fail(message) { const e = new Error(message); e.publicMessage = message; throw e; }
const clone = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{4,109}$/.test(value)) fail('记录编号不合法'); return value; }
function text(value, max = 300, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('文本为空或超过字段长度限制');
  return value;
}
function choice(value, allowed, fallback) {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) fail('类型、单位或状态无效'); return value;
}
function integer(value, min = 0, max = 1000000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('整数或版本超出范围'); return value;
}
// Decimal strings, never floating point multiplication; blanks stay unknown.
function decimal(value, digits, signed = false, nullable = false) {
  if (value === '' || value === null || value === undefined) { if (nullable) return null; fail('请填写数量或金额'); }
  if (typeof value !== 'string' || !(new RegExp('^' + (signed ? '-?' : '') + '(?:0|[1-9]\\d{0,6})(?:\\.\\d{1,' + digits + '})?$')).test(value)) fail('金额最多两位小数、数量最多三位小数；不接受科学计数或无效数值');
  const minus = value.startsWith('-'); const [whole, fraction = ''] = (minus ? value.slice(1) : value).split('.');
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
  return integer(minus ? -result : result, signed ? -1000000000 : 0);
}
function date(value) {
  value = text(value, 10); if (!value) return '';
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('日期无效'); return value;
}
const empty = () => Object.fromEntries(TABLES.map(name => [name, []]));
function current(data, name, key) { const row = data[name].find(x => x.id === id(key)); if (!row) fail('关联记录不存在，请刷新'); return row; }
function version(row, expected) { if (row.version !== expected) fail('CONFLICT：版本已变更，请刷新后核对，不会覆盖其他设备内容'); }
function stock(data, batchId) { return data.transactions.filter(x => x.batchId === batchId).reduce((n, x) => n + x.deltaMilli, 0); }
function itemFields(input) {
  const row = { id: id(input.id), kind: choice(input.kind, KINDS), name: text(input.name, 120, true), category: text(input.category, 100), notes: text(input.notes, 12000), rating: decimal(input.rating, 1, false, true) };
  if (row.rating !== null) { if (row.rating > 100) fail('评分范围为0至10'); row.rating /= 10; }
  for (const key of ['claim', 'observation', 'verifiedFacts', 'evidenceSource', 'unknowns']) row[key] = text(input[key], 3000);
  if (row.verifiedFacts.trim() && !row.evidenceSource.trim()) fail('已核验资料须填写核验来源与定位');
  row.knowledgeId = text(input.knowledgeId, 110); row.knowledgeVersion = input.knowledgeVersion === '' || input.knowledgeVersion == null ? null : integer(Number(input.knowledgeVersion), 1);
  if (row.knowledgeId) {
    const k = knowledge.find(x => x.id === row.knowledgeId && x.version === row.knowledgeVersion);
    if (!k || (['incense', 'tea'].includes(row.kind) && k.kind !== row.kind)) fail('百科ID、类型或版本不匹配');
  } else if (row.knowledgeVersion !== null) fail('百科版本需要对应ID');
  const fields = row.kind === 'incense' ? ['form', 'processingSource', 'useMethods', 'materialId', 'formulaId', 'species', 'part', 'region', 'processing', 'extraction', 'formula', 'ingredients', 'maturation', 'formulaSource', 'formulaSteps', 'reconstruction'] : row.kind === 'tea' ? ['topic', 'classificationBasis', 'variety', 'region', 'roasting', 'processes'] : row.kind === 'book' ? ['author', 'publisher', 'publicationYear', 'edition', 'isbn', 'translator', 'readingStatus', 'readingNotes', 'material', 'purpose', 'instructions'] : ['material', 'purpose', 'instructions', 'maker', 'dimensions', 'craft'];
  for (const key of fields) row[key] = text(input[key], 2000);
  if (row.kind === 'incense') row.nature = choice(input.nature, ['', '天然单方', '合香'], '');
  if (row.kind === 'tea') {
    row.teaCategory = choice(input.teaCategory, ['', 'green', 'white', 'yellow', 'oolong', 'red', 'dark', 'reprocessed', 'special'], '');
    row.harvestYear = input.harvestYear === '' || input.harvestYear == null ? null : integer(Number(input.harvestYear), 1000, 2200);
    if (row.topic === '生普' && row.teaCategory && !row.classificationBasis.trim()) fail('生普指定茶类时须填写分类依据，也可暂不分类');
  }
  if (['equipment', 'teaware', 'incenseware'].includes(row.kind)) row.capacityMilli = decimal(input.capacity, 3, false, true);
  return row;
}
function batchFields(input) {
  return { id: id(input.id), itemId: id(input.itemId), label: text(input.label, 120, true), seller: text(input.seller), priceCents: decimal(input.price, 2, false, true), quantityMilli: decimal(input.quantity, 3, false, true), unit: choice(input.unit, UNITS), purchasedAt: date(input.purchasedAt), storage: text(input.storage), storageNotes: text(input.storageNotes, 3000), claim: text(input.claim, 3000), verification: choice(input.verification, ['未核验', '部分核验', '已核验', '存疑'], '未核验'), verificationNotes: text(input.verificationNotes, 3000) };
}
function metadata(input) {
  const row = {};
  if(input.capturedAt !== undefined) row.capturedAt = require('../tasting/time').observedTime(input.capturedAt);
  for (const key of ['caption', 'altText', 'conditions', 'sourceUrl', 'creator', 'license', 'copyrightStatus', 'tags']) row[key] = text(input[key], key === 'caption' || key === 'conditions' ? 2000 : 500);
  row.sourceType = choice(input.sourceType, ['用户实拍', '授权参考图片', '授权实物', '古籍影像', '原创概念图', '公开资料', '生成式示意图片', '来源待核实图片'], '来源待核实图片');
  row.role = choice(input.role, ['整体', '局部', '工艺', '场景', '对比'], '整体');
  if (row.sourceUrl && !/^https?:\/\/\S+$/.test(row.sourceUrl)) fail('来源网址须为http或https');
  return row;
}
function validate(data) {
  if (!data || typeof data !== 'object') fail('珍藏数据格式错误');
  for (const table of TABLES) {
    if (!Array.isArray(data[table]) || data[table].length > LIMITS[table]) fail('珍藏记录超过当前容量限制，请保留备份');
    const seen = new Set();
    for (const row of data[table]) {
      id(row.id); if (seen.has(row.id)) fail('重复记录编号'); seen.add(row.id);
      integer(row.version, 1); text(row.createdAt, 50, true);
      if (Buffer.byteLength(JSON.stringify(row)) > 48000) fail('单条记录超过48KB限制');
    }
  }
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) fail('珍藏文字总量超过2.4MB安全导出上限，请分档归档后升级容量');
  for (const item of data.items) {
    const checked = itemFields({ ...item, rating: item.rating == null ? '' : String(item.rating), capacity: item.capacityMilli == null ? '' : (item.capacityMilli / 1000).toFixed(3) });
    if (item.legacyOriginal) {
      if (item.legacyOriginal.id !== item.id) fail('旧档关联错误');
    }
    if (checked.name !== item.name) fail('藏品名称无效');
  }
  for (const batch of data.batches) {
    current(data, 'items', batch.itemId); choice(batch.unit, UNITS);
    batchFields({ ...batch, price: batch.priceCents == null ? '' : (integer(batch.priceCents) / 100).toFixed(2), quantity: batch.quantityMilli == null ? '' : (integer(batch.quantityMilli) / 1000).toFixed(3) });
    if (batch.originBatchId) { const parent = current(data, 'batches', batch.originBatchId); if (parent.itemId !== batch.itemId || parent.unit !== batch.unit || batch.priceCents !== 0 || batch.quantityMilli !== 0) fail('分装批次关联或价格错误'); }
  }
  const reversed = new Set(); const transfer = new Map();
  for (const tx of data.transactions) {
    current(data, 'batches', tx.batchId); integer(tx.deltaMilli, -1000000000); text(tx.reason, 300, true); id(tx.requestId); text(tx.source, 110, true);
    if (tx.reversesId) {
      const original = current(data, 'transactions', tx.reversesId);
      if (reversed.has(original.id) || original.reversesId || original.transferId || (original.sessionId && (tx.sessionId!==original.sessionId || !['miniprogram-v14:sessionSave','miniprogram-v14:sessionCancel'].includes(tx.source))) || original.batchId !== tx.batchId || original.deltaMilli !== -tx.deltaMilli) fail('不可独立错冲关联或已冲正流水'); reversed.add(original.id);
    }
    if (tx.transferId) { const pair = transfer.get(tx.transferId) || []; pair.push(tx); transfer.set(tx.transferId, pair); }
  }
  for (const pair of transfer.values()) {
    if (pair.length !== 2 || pair[0].deltaMilli + pair[1].deltaMilli !== 0 || pair[0].batchId === pair[1].batchId) fail('分装流水必须完整配对');
    const a = current(data, 'batches', pair[0].batchId), b = current(data, 'batches', pair[1].batchId);
    if (a.itemId !== b.itemId || a.unit !== b.unit) fail('分装类型或单位不一致');
  }
  for (const batch of data.batches) { const n = stock(data, batch.id); if(n<0) fail('库存不能为负'); integer(n); if (batch.quantityMilli === null && data.transactions.some(x => x.batchId === batch.id)) fail('未登记库存的批次不能有流水'); }
  for (const media of data.attachments) {
    choice(media.status, ['ready', 'missing', 'deleting', 'deleted']); choice(media.mime, ['image/jpeg', 'image/png', 'image/webp']); integer(media.bytes, 1, 1000000); text(media.filename, 200, true);
    if (!/^[a-f0-9]{64}$/.test(media.hash)) fail('附件完整性哈希错误');
    if (media.status === 'ready' && (!String(media.fileID).startsWith('cloud://') || !String(media.thumbnailID).startsWith('cloud://'))) fail('附件存储引用缺失');
  }
  for (const link of data.links) {
    const media = current(data, 'attachments', link.attachmentId); if (['deleted', 'deleting'].includes(media.status)) fail('不能关联已删除附件');
    current(data, choice(link.entityType, ['items', 'batches', 'sessions']), link.entityId); metadata(link);
  }
  return data;
}
function mutate(before, op, requestId, at, trustedMedia) {
  id(requestId); const data = clone(before); const changes = []; const removed = [];
  const put = (table, row, insertOnly = false) => { const idx = data[table].findIndex(x => x.id === row.id); if (idx >= 0 && (insertOnly || table === 'transactions')) fail('记录ID已存在，禁止改写原始流水或复用新建ID'); if (idx < 0) data[table].push(row); else data[table][idx] = row; changes.push({ table, row }); return row; };
  const next = (fields, old) => ({ ...fields, version: old ? old.version + 1 : 1, createdAt: old ? old.createdAt : at, updatedAt: at });
  const tx = (batchId, delta, reason, extras = {}) => put('transactions', next({ id: 'tx-' + requestId + '-' + changes.filter(x => x.table === 'transactions').length, batchId, deltaMilli: delta, reason: text(reason, 300, true), source: 'miniprogram-v13:' + op.type, requestId, ...extras }));
  let result = {};
  if (op.type === 'itemSave') {
    const fields = itemFields(op.item); const old = data.items.find(x => x.id === fields.id);
    if (old) { version(old, op.expectedVersion); if (old.kind !== fields.kind) fail('已建档物件不能更改类型'); }
    else if (op.expectedVersion !== 0) fail('CONFLICT：新建版本应为0');
    const row = put('items', next({ ...fields, ...(old && old.legacyOriginal ? { legacyOriginal: old.legacyOriginal } : {}) }, old)); result = { id: row.id };
  } else if (op.type === 'batchSave') {
    const fields = batchFields(op.batch); if (fields.verification !== '未核验' && !fields.verificationNotes.trim()) fail('核验状态须填写依据或存疑原因'); current(data, 'items', fields.itemId);
    const old = data.batches.find(x => x.id === fields.id);
    if (old) {
      version(old, op.expectedVersion);
      for (const key of ['itemId', 'quantityMilli', 'unit']) if (fields[key] !== old[key]) fail('入库数量、单位、所属物件不可直接改写，请用库存流水');
      if (old.originBatchId && fields.priceCents !== 0) fail('分装不重复计算购买金额');
    } else if (op.expectedVersion !== 0) fail('CONFLICT：新建版本应为0');
    const row = put('batches', next({ ...fields, ...(old && old.originBatchId ? { originBatchId: old.originBatchId } : {}) }, old));
    if (!old && fields.quantityMilli !== null) tx(row.id, fields.quantityMilli, '购买入库'); result = { id: row.id };
  } else if (['adjust', 'transfer', 'reverse', 'stockInit'].includes(op.type)) {
    const batch = current(data, 'batches', op.batchId); version(batch, op.expectedVersion); text(op.reason, 300, true);
    if (op.type === 'stockInit') {
      if (batch.quantityMilli !== null) fail('库存已登记，不能重复初始化');
      const amount = decimal(op.quantity, 3); put('batches', next({ ...batch, quantityMilli: amount }, batch)); tx(batch.id, amount, op.reason);
    } else {
      if (batch.quantityMilli === null) fail('先显式登记未知库存，再操作流水');
      put('batches', next(batch, batch));
      if (op.type === 'adjust') { const amount = decimal(op.delta, 3, true); if (!amount) fail('调整量不能为0'); tx(batch.id, amount, op.reason); }
      if (op.type === 'reverse') {
        const original = current(data, 'transactions', op.transactionId);
        if (original.batchId !== batch.id || original.transferId || original.sessionId || original.reversesId || data.transactions.some(t => t.reversesId === original.id)) fail('请在原品鉴操作处撤销；关联、分装或已冲正流水不能独立冲正');
        tx(batch.id, -original.deltaMilli, op.reason, { reversesId: original.id });
      }
      if (op.type === 'transfer') {
        const amount = decimal(op.amount, 3); if (!amount) fail('分装量须大于0');
        const child = put('batches', next({ ...batch, id: 'portion-' + requestId, label: text(op.label, 120, true), quantityMilli: 0, priceCents: 0, originBatchId: batch.id, storage: text(op.storage), storageNotes: text(op.reason, 300) }), true);
        tx(batch.id, -amount, op.reason, { transferId: requestId, peerBatchId: child.id }); tx(child.id, amount, op.reason, { transferId: requestId, peerBatchId: batch.id }); result = { id: child.id };
      }
    }
  } else if (op.type === 'mediaAdd' || op.type === 'mediaLink') {
    const entity=current(data, choice(op.entityType, ['items', 'batches', 'sessions']), op.entityId);
    if(op.entityType==='sessions'&&entity.status!=='active') fail('已撤销手记的图片关联不可编辑');
    let media;
    if (op.type === 'mediaAdd') {
      if (!trustedMedia) fail('附件只能由已验证的服务端上传建立');
      media = put('attachments', next({ ...trustedMedia, id: 'media-' + requestId, status: 'ready' }), true);
    } else { media = current(data, 'attachments', op.attachmentId); if (media.status !== 'ready') fail('原图尚不可用'); }
    if (data.links.some(x => x.attachmentId === media.id && x.entityType === op.entityType && x.entityId === op.entityId)) fail('附件已经关联');
    const link = put('links', next({ id: 'link-' + requestId, attachmentId: media.id, entityType: op.entityType, entityId: op.entityId, ...metadata(op.metadata || {}) }), true); result = { id: link.id };
  } else if (op.type === 'mediaMetadata' || op.type === 'mediaUnlink') {
    const old = current(data, 'links', op.linkId); version(old, op.expectedVersion);
    if(old.entityType==='sessions'&&current(data,'sessions',old.entityId).status!=='active') fail('已撤销手记的图片资料不可编辑');
    if (op.type === 'mediaMetadata') put('links', next({ ...old, ...metadata(op.metadata || {}) }, old));
    else { data.links = data.links.filter(x => x.id !== old.id); removed.push({ table: 'links', id: old.id }); }
  } else if (op.type === 'mediaDelete') {
    const old = current(data, 'attachments', op.attachmentId); version(old, op.expectedVersion);
    if (data.links.some(x => x.attachmentId === old.id)) fail('图片仍被其他档案引用，先解除全部关联');
    if (!['ready', 'missing', 'deleting'].includes(old.status)) fail('附件已进入删除流程');
    put('attachments', next({ ...old, status: 'deleting' }, old)); result = { id: old.id };
  } else fail('不支持的珍藏操作');
  validate(data); return { data, changes, removed, result };
}
function makeBackup(data, ownerFingerprint, legacy, at) {
  validate(data);
  if ((data.sessions||[]).length || data.transactions.some(t=>t.sessionId) || data.links.some(l=>l.entityType==='sessions')) fail('存在V4手记或品鉴关联，请使用V4文字备份；不能标作完整V3');
  const payload = clone(Object.fromEntries(TABLES.map(t=>[t,data[t]])));
  for (const media of payload.attachments) { delete media.fileID; delete media.thumbnailID; if (media.status !== 'deleted') media.status = 'missing'; }
  const envelope = { format: FORMAT, schemaVersion: 3, source: 'wenxiang-guancha/miniprogram-v13', createdAt: at, ownerFingerprint, conflictRule: 'KEEP_EXISTING_BATCH_LEDGER', includesUserImages: false, mediaGap: '仅文字与附件元数据，原图和缩略图须另行保存；恢复后重新上传并关联。', payload, legacy };
  return { ...envelope, sha256: hash(envelope) };
}
function verifyBackup(backup, ownerFingerprint) {
  if (!backup || backup.format !== FORMAT || backup.schemaVersion !== 3 || backup.ownerFingerprint !== ownerFingerprint || backup.includesUserImages !== false) fail('珍藏备份格式、身份或版本不匹配');
  const { sha256, ...body } = backup; if (sha256 !== hash(body)) fail('备份完整性哈希校验失败');
  if ((backup.payload.sessions||[]).length || backup.payload.transactions.some(t=>t.sessionId) || backup.payload.links.some(l=>l.entityType==='sessions')) fail('V3不能包含V4手记或品鉴流水，请导入完整V4备份');
  validate(backup.payload); return clone(backup.payload);
}
function restorePlan(currentData, incoming) {
  const data = clone(currentData); const changes = []; const counts = Object.fromEntries(TABLES.map(t => [t, 0])); counts.conflicts = 0; counts.missingImages = 0;
  const blockedItems = new Set(); const newBatches = new Set();
  for (const table of TABLES) for (const original of incoming[table]) {
    const row = clone(original); const old = data[table].find(x => x.id === row.id);
    if (old) { if (hash(old) !== hash(row)) { counts.conflicts++; if (table === 'items') blockedItems.add(row.id); } continue; }
    if (table === 'batches' && blockedItems.has(row.itemId)) { counts.conflicts++; continue; }
    // Never append historical inventory to a live batch, even when an ID is absent.
    if (table === 'transactions' && !newBatches.has(row.batchId)) { counts.conflicts++; continue; }
    if (table === 'links' && (!data[row.entityType].some(x => x.id === row.entityId) || !data.attachments.some(x => x.id === row.attachmentId && !['deleted', 'deleting'].includes(x.status)))) { counts.conflicts++; continue; }
    if (table === 'attachments') { row.status = row.status === 'deleted' ? 'deleted' : 'missing'; delete row.fileID; delete row.thumbnailID; if (row.status === 'missing') counts.missingImages++; }
    data[table].push(row); changes.push({ table, row }); counts[table]++;
    if (table === 'batches') newBatches.add(row.id);
  }
  // Transfers are atomic groups: never restore half a transfer into an existing ledger.
  validate(data);
  if (changes.length > 80) fail('本次缺失记录超过80条原子恢复上限，尚未写入。请保留原备份，联系维护者分组迁移，禁止拆改流水。');
  return { data, changes, removed: [], result: counts, counts };
}
module.exports = { TABLES, LIMITS, MAX_BYTES, UNITS, KINDS, FORMAT, fail, clone, hash, id, text, integer, decimal, empty, current, version, stock, itemFields, metadata, validate, mutate, makeBackup, verifyBackup, restorePlan };
