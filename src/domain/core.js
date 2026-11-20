'use strict';
const crypto=require('node:crypto');
const curriculum=require('./curriculum');
const FORMAT='WENXIANG_GUANCHA_PERSONAL_V1';
const MAX_BYTES=800000;
const lessonId=/^(?:M0[1-8]-L\d{2}|A-M0[1-8]-L\d{2}|(?:I|T)(?:\d{3}|A\d{2}))$/;
const validLessonId=value=>typeof value==='string'&&(lessonId.test(value)||!!curriculum.lessonFor(value));
// Never mix a legacy question with a new lesson (or a new question with legacy
// progress) during backup restoration. Pure legacy records retain prior rules.
function validAttemptPair(record,type,legacyValid){
 if(curriculum.lessonFor(record.lessonId)||curriculum.questionFor(record.questionId))return curriculum.recordMatches(record,type);
 return legacyValid;
}
const entryId=/^[a-zA-Z0-9:_-]{5,110}$/;
function err(message){const e=new Error(message);e.publicMessage=message;throw e;}
function empty(){return {progress:{},bookmarks:[],notes:[],attempts:[],openAttempts:[],journals:[],collections:[],referenceBookmarks:[]};}
function serial(obj){return JSON.stringify(obj);}
function sha(obj){return crypto.createHash('sha256').update(serial(obj)).digest('hex');}
function str(x,max){return typeof x==='string'?x.slice(0,max):'';}
function validId(x){return typeof x==='string'&&entryId.test(x);}
function uniqueEntries(xs,key,max){
 if(!Array.isArray(xs)||xs.length>max)err('备份数组结构异常或记录过多');
 const seen=new Set();return xs.filter(x=>{const id=x&&x[key];if(!validId(id))err('记录编号不合法');if(seen.has(id))err('备份中包含重复记录');seen.add(id);return true;});
}
function cleanProgress(x){
 if(!x||typeof x!=='object'||Array.isArray(x))err('学习进度结构不正确');
 const out={};const keys=Object.keys(x);if(keys.length>300)err('进度条目过多');
 for(const key of keys){if(!validLessonId(key))err('课程编号不合法');const s=x[key]||{};
  out[key]={read:!!s.read,explain:!!s.explain,practiced:!!s.practiced,
   updatedAt:str(s.updatedAt,50),anchor:str(s.anchor,120)};
 }
 return out;
}
function sanitize(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))err('个人数据格式错误');
 const out=empty();out.progress=cleanProgress(raw.progress||{});
 out.bookmarks=Array.isArray(raw.bookmarks)?[...new Set(raw.bookmarks.filter(x=>validLessonId(String(x))))].slice(0,300):[];
 out.notes=uniqueEntries(raw.notes||[],'id',700).map(n=>{
   if(!validLessonId(n.lessonId))err('笔记所属课程错误');
   return {id:n.id,lessonId:n.lessonId,body:str(n.body,8000),createdAt:str(n.createdAt,50),updatedAt:str(n.updatedAt,50)};
 });
 out.attempts=uniqueEntries(raw.attempts||[],'id',7000).map(a=>{
   if(!validLessonId(a.lessonId)||!validAttemptPair(a,'single_choice',/^(?:M0[1-8]-L\d{2}-Q\d{2}|WXGC-A-M0[1-8]-L\d{2}-.+)$/.test(a.questionId))||!Number.isInteger(a.choice)||a.choice<0||a.choice>3)err('答题记录结构异常');
   return ({
   id:a.id,questionId:str(a.questionId,100),lessonId:str(a.lessonId,100),choice:Number(a.choice),correct:!!a.correct,createdAt:str(a.createdAt,50)
   });
 });
 out.journals=uniqueEntries(raw.journals||[],'id',500).map(j=>({
   id:j.id,kind:j.kind==='incense'?'incense':'tea',title:str(j.title,120),body:str(j.body,12000),itemId:validId(j.itemId)?j.itemId:'',createdAt:str(j.createdAt,50),updatedAt:str(j.updatedAt,50)
 }));
 out.collections=uniqueEntries(raw.collections||[],'id',500).map(c=>({
   id:c.id,kind:['incense','tea','teaware','incenseware','book','other'].includes(c.kind)?c.kind:'other',
   name:str(c.name,120),category:str(c.category,100),source:str(c.source,200),acquiredAt:str(c.acquiredAt,50),
   notes:str(c.notes,12000),createdAt:str(c.createdAt,50),updatedAt:str(c.updatedAt,50)
 }));
 out.openAttempts=uniqueEntries(raw.openAttempts||[],'id',2000).map(a=>{
   // The eight original module projects belong to each module's fourth lesson.
   const project=/^WXGC-A-(M0[1-8])-PROJECT-01$/.exec(a.questionId);
   const validProject=project&&project[0]===a.questionId&&a.lessonId===`A-${project[1]}-L04`;
   if(!validLessonId(a.lessonId)||!validAttemptPair(a,'open_response',/^WXGC-A-M0[1-8]-L\d{2}-.+/.test(a.questionId)||validProject))err('开放题记录结构异常');
   return {id:a.id,lessonId:a.lessonId,questionId:str(a.questionId,110),body:str(a.body,8000),createdAt:str(a.createdAt,50)};
 });
 out.referenceBookmarks=Array.isArray(raw.referenceBookmarks)?[...new Set(raw.referenceBookmarks.filter(x=>validLessonId(String(x))))].slice(0,300):[];
 if(Buffer.byteLength(serial(out),'utf8')>MAX_BYTES)err('个人数据已超过当前版本单份限制，需要升级分片备份');
 return out;
}
function makeBackup(state,ownerFingerprint,time){
 const data={format:FORMAT,schemaVersion:2,createdAt:time||new Date().toISOString(),ownerFingerprint,payload:sanitize(state),includesUserImages:false};
 return {...data,sha256:sha(data)};
}
function verifyBackup(backup,ownerFingerprint){
 if(!backup||typeof backup!=='object'||Array.isArray(backup))err('请导入完整的JSON备份文件');
 if(backup.format!==FORMAT||![1,2].includes(backup.schemaVersion))err('不支持的备份格式或版本');
 if(backup.ownerFingerprint!==ownerFingerprint)err('此备份不属于当前体验微信身份；不能自动跨账号恢复');
 if(typeof backup.sha256!=='string'||backup.sha256.length!==64)err('备份校验值缺失');
 const {sha256,...data}=backup;
 if(sha(data)!==sha256)err('备份校验失败，文件可能被修改或损坏');
 return sanitize(backup.payload);
}
function mergeStates(current,restored){
 const a=sanitize(current), b=sanitize(restored), n=empty();
 n.progress={...b.progress,...a.progress};n.bookmarks=[...new Set([...a.bookmarks,...b.bookmarks])];n.referenceBookmarks=[...new Set([...a.referenceBookmarks,...b.referenceBookmarks])];
 const counts={progress:0,bookmarks:0,notes:0,attempts:0,openAttempts:0,journals:0,collections:0,referenceBookmarks:0,conflicts:0};
 counts.progress=Object.keys(b.progress).filter(x=>!(x in a.progress)).length;
 counts.bookmarks=b.bookmarks.filter(x=>!a.bookmarks.includes(x)).length;counts.referenceBookmarks=b.referenceBookmarks.filter(x=>!a.referenceBookmarks.includes(x)).length;
 for(const name of ['notes','attempts','openAttempts','journals','collections']){
  const seen=new Map(a[name].map(x=>[x.id,x]));
  for(const x of b[name]){if(!seen.has(x.id)){seen.set(x.id,x);counts[name]++;}
   else if(serial(seen.get(x.id))!==serial(x))counts.conflicts++;
  }
  n[name]=[...seen.values()];
 }
 return {state:sanitize(n),counts};
}
function patch(state,op,answers,xiangAnswers={}){
 if(!op||typeof op!=='object')err('操作数据无效');
 const n=sanitize(state);const at=new Date().toISOString();let feedback=null;
 if(op.type==='progress'){
  if(!validLessonId(op.lessonId))err('课程编号无效');
  const s=n.progress[op.lessonId]||{read:false,explain:false,practiced:false,anchor:''};
  if(!['read','explain','practiced','anchor'].includes(op.field))err('状态字段不支持');
  s[op.field]=op.field==='anchor'?str(op.value,120):Boolean(op.value);
  s.updatedAt=at;n.progress[op.lessonId]=s;
 } else if(op.type==='bookmark'){
  if(!validLessonId(op.lessonId))err('课程编号无效');
  n.bookmarks=op.bookmarked?[...new Set([...n.bookmarks,op.lessonId])]:n.bookmarks.filter(x=>x!==op.lessonId);
 } else if(op.type==='referenceBookmark'){
  if(!validLessonId(op.lessonId))err('专题资料编号无效');
  n.referenceBookmarks=op.bookmarked?[...new Set([...n.referenceBookmarks,op.lessonId])]:n.referenceBookmarks.filter(x=>x!==op.lessonId);
 } else if(op.type==='note'){
  if(!validLessonId(op.lessonId)||!validId(op.id)||typeof op.body!=='string'||op.body.length>8000)err('笔记无效');
  const existing=n.notes.findIndex(x=>x.id===op.id);
  const value={id:op.id,lessonId:op.lessonId,body:op.body,createdAt:existing<0?at:n.notes[existing].createdAt,updatedAt:at};
  if(existing<0)n.notes.unshift(value);else n.notes[existing]=value;
 } else if(op.type==='deleteNote'){
  if(!validId(op.id))err('笔记编号无效');n.notes=n.notes.filter(x=>x.id!==op.id);
 } else if(op.type==='attempt'){
  const modern=curriculum.answerFor(op.questionId);
  if(modern&&modern.type!=='single_choice')err('请按开放题提交本题思考');
  const ans=modern||(Object.prototype.hasOwnProperty.call(answers,op.questionId)?answers[op.questionId]:null)||
   (Object.prototype.hasOwnProperty.call(xiangAnswers,op.questionId)&&xiangAnswers[op.questionId].type==='single_choice'?xiangAnswers[op.questionId]:null);
  if(!ans||!validId(op.id)||!Number.isInteger(op.choice)||op.choice<0||op.choice>3)err('习题编号或选项错误');
  if(n.attempts.some(a=>a.id===op.id))err('重复作答记录');
  const good=ans.correct_option_index===op.choice;
  n.attempts.unshift({id:op.id,lessonId:ans.lesson_id,questionId:op.questionId,choice:op.choice,correct:good,createdAt:at});
  feedback=modern?curriculum.feedbackFor(modern,op.choice):{correct:good,correctOptionIndex:ans.correct_option_index,explanation:ans.explanation};
 } else if(op.type==='openAttempt'){
  const modern=curriculum.answerFor(op.questionId);
  const ans=modern||(Object.prototype.hasOwnProperty.call(xiangAnswers,op.questionId)?xiangAnswers[op.questionId]:null);
  if(!ans||ans.type!=='open_response'||!validId(op.id)||typeof op.body!=='string'||op.body.trim().length<1||op.body.length>8000)err('开放题内容或编号无效');
  if(n.openAttempts.some(a=>a.id===op.id))err('开放题重复提交');
  n.openAttempts.unshift({id:op.id,lessonId:ans.lesson_id,questionId:op.questionId,body:op.body,createdAt:at});
  feedback=modern?curriculum.feedbackFor(modern):{manual:true,reference:ans.explanation,rubric:ans.rubric};
 } else if(op.type==='collection'){
  if(!validId(op.id)||typeof op.name!=='string'||!op.name.trim()||op.name.length>120||typeof op.notes!=='string'||op.notes.length>12000)err('收藏内容无效');
  const idx=n.collections.findIndex(c=>c.id===op.id);
  const v={id:op.id,kind:['incense','tea','teaware','incenseware','book','other'].includes(op.kind)?op.kind:'other',
   name:str(op.name,120),category:str(op.category,100),source:str(op.source,200),
   acquiredAt:str(op.acquiredAt,50),notes:str(op.notes,12000),createdAt:idx<0?at:n.collections[idx].createdAt,updatedAt:at};
  if(idx<0)n.collections.unshift(v);else n.collections[idx]=v;
 } else if(op.type==='deleteCollection'){
  if(!validId(op.id))err('藏品编号无效');n.collections=n.collections.filter(x=>x.id!==op.id);
 } else if(op.type==='journal'){
  if(!validId(op.id)||!['tea','incense'].includes(op.kind)||typeof op.title!=='string'||typeof op.body!=='string'||op.body.length>12000)err('品鉴记录格式错误');
  const idx=n.journals.findIndex(j=>j.id===op.id);
  const v={id:op.id,kind:op.kind,title:str(op.title,120),body:op.body,itemId:validId(op.itemId)?op.itemId:'',createdAt:idx<0?at:n.journals[idx].createdAt,updatedAt:at};
  if(idx<0)n.journals.unshift(v);else n.journals[idx]=v;
 } else if(op.type==='deleteJournal'){
  if(!validId(op.id))err('手记编号无效');n.journals=n.journals.filter(x=>x.id!==op.id);
 } else err('操作类型不支持');
 return {state:sanitize(n),feedback};
}
module.exports={FORMAT,empty,sanitize,makeBackup,verifyBackup,mergeStates,patch,sha};
