'use strict';
const d=require('../collection/domain');
const {observedTime}=require('./time');
const lessons=[...require('../data/tasting-lessons.json'),...require('../curriculum').tastingLessons];
const SOURCE='wenxiang-guancha/miniprogram-v14';
const MAX_SESSIONS=500;
function enumValue(value, values, fallback){const v=value==null||value===''?fallback:value;if(!values.includes(v))d.fail('手记类型、模式或状态无效');return v;}
function optionalId(value){return value==null||value===''?'':d.id(value);}
function number(value,max=1000000){if(value==null||value==='')return null;const n=d.decimal(typeof value==='number'?String(value):value,3,false,true)/1000;if(n>max)d.fail('数值超出允许范围');return n;}
function rows(value,max){if(value==null)return [];if(!Array.isArray(value)||value.length>max)d.fail('阶段、泡次或评分条数超限');return value;}
function fields(input){
 if(!input||typeof input!=='object'||Array.isArray(input))d.fail('手记结构无效');
 const row={id:d.id(input.id),kind:enumValue(input.kind,['incense','tea','daily']),mode:enumValue(input.mode,['quick','deep'],'quick'),title:d.text(input.title,120,true),body:d.text(input.body,12000),summary:d.text(input.summary,3000),observedAt:observedTime(input.observedAt),itemId:optionalId(input.itemId),batchId:optionalId(input.batchId),equipmentId:optionalId(input.equipmentId),lessonId:d.text(input.lessonId,110),method:d.text(input.method,300),usedMilli:d.decimal(input.used,3,false,true),unit:enumValue(input.unit,['',...d.UNITS],''),stockConfirmed:input.stockConfirmed===true,liked:number(input.liked,10),heatSource:d.text(input.heatSource,2000),durationMinutes:number(input.durationMinutes,10080),capacity:number(input.capacity),waterMl:number(input.waterMl),waterTemp:number(input.waterTemp,100)};
 if(input.stockConfirmed!==undefined&&typeof input.stockConfirmed!=='boolean')d.fail('库存确认须为明确布尔值');
 row.stages=rows(input.stages,50).map((s,position)=>({id:d.id(s.id),position,minutes:number(s.minutes,10080),setTemp:number(s.setTemp,1000),aroma:d.text(s.aroma,500),observation:d.text(s.observation,4000)}));
 row.infusions=rows(input.infusions,50).map((s,position)=>({id:d.id(s.id),position,seconds:number(s.seconds,86400),...Object.fromEntries(['color','aroma','taste','texture','aftertaste','salivation','leafBase'].map(k=>[k,d.text(s[k],1000)]))}));
 row.scores=rows(input.scores,10).map((s,position)=>({id:d.id(s.id),position,dimension:d.text(s.dimension,100,true),intensity:number(s.intensity,10)}));
 for(const key of ['stages','infusions','scores'])if(new Set(row[key].map(x=>x.id)).size!==row[key].length)d.fail('阶段、泡次或评分ID重复');
 if(new Set(row.scores.map(s=>s.dimension.normalize('NFKC').trim().toLowerCase())).size!==row.scores.length)d.fail('感官评分维度不能重复');
 if(row.lessonId){const lesson=lessons.find(x=>x.id===row.lessonId);if(!lesson||lesson.kind!==row.kind)d.fail('课程ID无法解析或与手记类型不匹配');}
 if(row.kind==='incense'){
  if(row.infusions.length||row.capacity!==null||row.waterMl!==null||row.waterTemp!==null)d.fail('闻香不填泡茶参数');
  if(row.method!=='电子香炉'&&row.stages.some(s=>s.setTemp!==null))d.fail('只有明确选择电子香炉才可记录设定温度；隔火与燃香请填写热源观察');
 }else if(row.stages.length||row.heatSource||row.durationMinutes!==null)d.fail('非闻香记录不填闻香阶段或热源');
 if(row.kind==='daily'&&(row.itemId||row.batchId||row.equipmentId||row.lessonId||row.method||row.usedMilli!==null||row.unit||row.stockConfirmed||row.liked!==null||row.scores.length||row.infusions.length||row.capacity!==null||row.waterMl!==null||row.waterTemp!==null))d.fail('日常手札只记录事实时间、文字和图片，不关联品鉴或库存');
 if(row.usedMilli!==null&&!row.unit)d.fail('记录用量须明确单位，未知用量可留空');
 if(row.stockConfirmed&&(!row.batchId||row.usedMilli===null))d.fail('确认扣库存须选择真实批次并填写非负的实际用量');
 return row;
}
function inputFrom(row){return {...row,used:row.usedMilli==null?'':(row.usedMilli/1000).toFixed(3)};}
function relations(data,row){
 if(row.itemId){const item=d.current(data,'items',row.itemId);if(item.kind!==row.kind)d.fail('藏品类型与手记不一致');}
 if(row.batchId){const batch=d.current(data,'batches',row.batchId),item=d.current(data,'items',batch.itemId);if(item.kind!==row.kind||row.itemId!==item.id)d.fail('批次所属藏品或类别不匹配');if(row.unit&&row.unit!==batch.unit)d.fail('用量单位与真实批次不一致');if(row.stockConfirmed&&batch.quantityMilli===null)d.fail('批次尚未登记库存，不可扣减');}
 if(row.equipmentId){const item=d.current(data,'items',row.equipmentId);const allowed=row.kind==='tea'?['equipment','teaware']:['equipment','incenseware'];if(!allowed.includes(item.kind))d.fail('关联对象不是适用于本次品鉴的器物');}
}
function validate(data){
 d.validate(data);const sessions=data.sessions||[];
 if(!Array.isArray(sessions)||sessions.length>MAX_SESSIONS)d.fail('手记超过500条限制');
 const seen=new Set(),creationRequests=new Set();
 for(const row of sessions){
  d.id(row.id);if(seen.has(row.id))d.fail('手记ID重复');seen.add(row.id);d.integer(row.version,1);enumValue(row.status,['active','cancelled']);d.text(row.createdAt,50,true);d.text(row.updatedAt,50,true);d.id(row.requestId);if(creationRequests.has(row.requestId))d.fail('手记原始请求ID重复');creationRequests.add(row.requestId);
  if(row.source!==SOURCE||row.sourceId!==row.id)d.fail('手记来源或原ID缺失');
  const checked=fields(inputFrom(row));relations(data,checked);
  for(const key of Object.keys(checked))if(d.hash(checked[key])!==d.hash(row[key]))d.fail('手记字段类型、顺序或空值不一致');
  if(Buffer.byteLength(JSON.stringify(row))>48000)d.fail('单份手记超过48KB限制');
  const own=data.transactions.filter(tx=>tx.sessionId===row.id),reversed=new Set(own.filter(tx=>tx.reversesId).map(tx=>tx.reversesId));
  const active=own.filter(tx=>!tx.reversesId&&!reversed.has(tx.id));
  const consuming=row.status==='active'&&row.stockConfirmed&&row.usedMilli>0;
  if(consuming?(active.length!==1||active[0].batchId!==row.batchId||active[0].deltaMilli!==-row.usedMilli):active.length!==0)d.fail('手记与库存流水不完整或发生重复扣减');
 }
 for(const tx of data.transactions.filter(t=>t.sessionId)){
  if(!seen.has(tx.sessionId))d.fail('品鉴流水缺少对应手记，须使用完整V4备份');
  const session=sessions.find(row=>row.id===tx.sessionId),batch=d.current(data,'batches',tx.batchId);d.integer(tx.sessionVersion,1,session.version);if(d.current(data,'items',batch.itemId).kind!==session.kind)d.fail('品鉴历史流水类别不匹配');
  if(tx.source!=='miniprogram-v14:sessionSave'&&tx.source!=='miniprogram-v14:sessionCancel')d.fail('品鉴流水来源无效');
  if(tx.reversesId){const original=d.current(data,'transactions',tx.reversesId);if(original.sessionId!==tx.sessionId||original.sessionVersion>=tx.sessionVersion)d.fail('品鉴冲正只能对应本手记先前版本的消耗');}
  if(tx.transferId||(!tx.reversesId&&(tx.deltaMilli>=0||tx.source!=='miniprogram-v14:sessionSave')))d.fail('品鉴流水方向或关联无效');
 }
 return data;
}
function plan(before,op,requestId,at){
 d.id(requestId);if(requestId.length>64)d.fail('请求ID过长');
 const data=d.clone({...before,sessions:before.sessions||[]}),changes=[];
 const put=(table,row,insert=false)=>{const index=data[table].findIndex(x=>x.id===row.id);if(insert&&index>=0)d.fail('禁止复用ID改写手记库存历史');if(index<0)data[table].push(row);else data[table][index]=row;changes.push({table,row});return row;};
 const old=data.sessions.find(x=>x.id===(op.type==='sessionSave'?op.session&&op.session.id:op.id));
 if(old){d.version(old,op.expectedVersion);if(old.status==='cancelled')d.fail('手记已撤销，不能编辑或再次撤销');}else if(op.type!=='sessionSave'||op.expectedVersion!==0)d.fail('手记不存在或新建版本不是0');
 let row;
 if(op.type==='sessionSave'){
  row=fields(op.session);if(old&&row.kind!==old.kind)d.fail('已建手记不能更改类型');relations(data,row);
  row={...row,source:SOURCE,sourceId:row.id,status:'active',version:old?old.version+1:1,requestId:old?old.requestId:requestId,createdAt:old?old.createdAt:at,updatedAt:at,...(old&&old.legacyOriginal?{legacyOriginal:old.legacyOriginal,legacyItemId:old.legacyItemId}:{} )};
 }else if(op.type==='sessionCancel')row={...old,status:'cancelled',version:old.version+1,updatedAt:at,cancelReason:d.text(op.reason,300,true)};
 else d.fail('手记操作不支持');
 const own=data.transactions.filter(x=>x.sessionId===row.id),reversed=new Set(own.filter(x=>x.reversesId).map(x=>x.reversesId));
 const pending=own.filter(x=>!x.reversesId&&!reversed.has(x.id));
 const affected=new Set(pending.map(x=>x.batchId));if(row.status==='active'&&row.stockConfirmed&&row.usedMilli>0)affected.add(row.batchId);
 for(const batchId of affected){const batch=d.current(data,'batches',batchId);d.version(batch,(op.batchVersions||{})[batchId]);put('batches',{...batch,version:batch.version+1,updatedAt:at});}
 const add=(batchId,delta,reason,extra={})=>put('transactions',{id:'session-tx-'+requestId+'-'+changes.filter(x=>x.table==='transactions').length,batchId,deltaMilli:delta,reason,sessionId:row.id,sessionVersion:row.version,requestId,source:'miniprogram-v14:'+op.type,version:1,createdAt:at,updatedAt:at,...extra},true);
 for(const tx of pending)add(tx.batchId,-tx.deltaMilli,op.type==='sessionCancel'?'品鉴撤销冲正':'品鉴修改冲正',{reversesId:tx.id});
 if(row.status==='active'&&row.stockConfirmed&&row.usedMilli>0)add(row.batchId,-row.usedMilli,'已确认的品鉴消耗');
 put('sessions',row,!old);validate(data);
 return {data,changes,removed:[],result:{id:row.id,version:row.version,status:row.status,inventoryApplied:row.status==='active'&&row.stockConfirmed&&row.usedMilli>0}};
}
function legacyPlan(snapshot,backup,fingerprint,at){
 const core=require('../core'),legacy=core.verifyBackup(backup,fingerprint),data=d.clone({...snapshot.data,sessions:snapshot.data.sessions||[]}),changes=[];let conflicts=0;
 for(const original of legacy.journals){
  if(data.sessions.some(x=>x.id===original.id)){conflicts++;continue;}
  const item=data.items.find(x=>x.id===original.itemId&&x.kind===original.kind);
  const row={...fields({id:original.id,kind:original.kind,title:original.title||'旧版未题名手记',body:original.body,itemId:item?item.id:''}),source:SOURCE,sourceId:original.id,status:'active',version:1,requestId:'legacy-'+d.hash(original).slice(0,32),createdAt:at,updatedAt:at,legacyOriginal:d.clone(original),legacyItemId:original.itemId||''};
  data.sessions.push(row);changes.push({table:'sessions',row});
 }
 validate(data);
 return {data,changes,removed:[],result:{imported:changes.length,conflicts}};
}
module.exports={SOURCE,MAX_SESSIONS,fields,inputFrom,relations,validate,plan,legacyPlan,observedTime};
