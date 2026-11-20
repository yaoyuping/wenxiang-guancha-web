'use strict';
const d=require('../collection/domain'),t=require('./domain');
const FORMAT='WENXIANG_GUANCHA_PERSONAL_V4';
const TABLES=[...d.TABLES,'sessions'];
function marks(data){return Object.fromEntries(data.sessions.map(row=>[row.id,{sourceId:row.sourceId,version:row.version,sha256:d.hash(row),ledgerCount:data.transactions.filter(tx=>tx.sessionId===row.id).length,ledgerSha256:d.hash(data.transactions.filter(tx=>tx.sessionId===row.id).sort((a,b)=>a.id.localeCompare(b.id)))}]));}
function make(data,fingerprint,legacy,at){
 t.validate(data);const payload=d.clone(data);
 for(const media of payload.attachments){delete media.fileID;delete media.thumbnailID;if(media.status!=='deleted')media.status='missing';}
 const value={format:FORMAT,schemaVersion:4,source:t.SOURCE,createdAt:at,ownerFingerprint:fingerprint,includesUserImages:false,mediaGap:'文字备份不含图片原件和缩略图；须另行归档并重新上传关联。',conflictRule:'KEEP_CURRENT_SESSION_AND_COMPLETE_BATCH_LEDGER',payload,sessionIntegrity:marks(payload),legacy};
 return {...value,sha256:d.hash(value)};
}
function verify(backup,fingerprint){
 if(!backup||backup.format!==FORMAT||backup.schemaVersion!==4||backup.ownerFingerprint!==fingerprint||backup.includesUserImages!==false||backup.source!==t.SOURCE)d.fail('V4备份格式、版本或身份不匹配');
 const {sha256,...rest}=backup;if(d.hash(rest)!==sha256)d.fail('V4备份完整性哈希不匹配');
 t.validate(backup.payload);if(d.hash(marks(backup.payload))!==d.hash(backup.sessionIntegrity))d.fail('手记及关联流水独立完整性标记错误');
 require('../core').verifyBackup(backup.legacy,fingerprint);return d.clone(backup.payload);
}
function restorePlan(current,incoming){
 t.validate(incoming);const data=d.clone({...current,sessions:current.sessions||[]}),changes=[],counts=Object.fromEntries(TABLES.map(k=>[k,0]));counts.conflicts=0;counts.missingImages=0;counts.blockedSessions=0;
 const currentBy=new Map(data.sessions.map(x=>[x.id,x]));
 const blockedBatches=new Set(),blockedSessions=new Set();
 // A live batch ledger is indivisible. Never insert old debits into an existing lot.
 for(const batch of incoming.batches){const old=data.batches.find(b=>b.id===batch.id);if(old&&incoming.transactions.filter(tx=>tx.batchId===batch.id).some(tx=>!data.transactions.some(x=>x.id===tx.id&&d.hash(x)===d.hash(tx))))blockedBatches.add(batch.id);}
 for(const row of incoming.sessions){const old=currentBy.get(row.id);if(old&&d.hash(old)!==d.hash(row))blockedSessions.add(row.id);}
 // Propagate blocked inventory components across transfers and tasting histories.
 let changed=true;while(changed){changed=false;const block=(set,id)=>{if(id&&!set.has(id)){set.add(id);changed=true;}};
  for(const tx of incoming.transactions){
   if(tx.sessionId&&blockedBatches.has(tx.batchId))block(blockedSessions,tx.sessionId);
   if(tx.sessionId&&blockedSessions.has(tx.sessionId))block(blockedBatches,tx.batchId);
   if(tx.peerBatchId&&(blockedBatches.has(tx.batchId)||blockedBatches.has(tx.peerBatchId))){block(blockedBatches,tx.batchId);block(blockedBatches,tx.peerBatchId);}
  }
 }
 const append=(table,original)=>{
  const old=data[table].find(x=>x.id===original.id);if(old){if(d.hash(old)!==d.hash(original))counts.conflicts++;return;}
  const row=d.clone(original);if(table==='attachments'){delete row.fileID;delete row.thumbnailID;if(row.status!=='deleted'){row.status='missing';counts.missingImages++;}}
  data[table].push(row);changes.push({table,row});counts[table]++;
 };
 for(const row of incoming.items)append('items',row);
 for(const row of incoming.batches){if(blockedBatches.has(row.id)){counts.conflicts++;continue;}append('batches',row);}
 for(const row of incoming.transactions){if(blockedBatches.has(row.batchId)){counts.conflicts++;continue;}append('transactions',row);}
 for(const row of incoming.sessions){if(blockedSessions.has(row.id)){counts.blockedSessions++;counts.conflicts++;continue;}append('sessions',row);}
 for(const row of incoming.attachments)append('attachments',row);
 for(const row of incoming.links){
  if(!data[row.entityType]||!data[row.entityType].some(x=>x.id===row.entityId)||!data.attachments.some(x=>x.id===row.attachmentId&&!['deleted','deleting'].includes(x.status))){counts.conflicts++;continue;}
  if(row.entityType==='sessions'&&blockedSessions.has(row.entityId)){counts.conflicts++;continue;}
  append('links',row);
 }
 // If a surviving current entity has different relation semantics, fail the entire
 // preflight rather than silently rewriting or manufacturing an inventory balance.
 t.validate(data);
 
 return {data,changes,removed:[],result:counts,counts};
}
module.exports={FORMAT,TABLES,marks,make,verify,restorePlan};
