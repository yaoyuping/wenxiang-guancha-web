'use strict';
// Immutable curriculum lookup and feedback formatting. No database or migration.
const data=require('./data/curriculum-r11');
const lessons=new Map(data.lessons.map(lesson=>[lesson.id,lesson]));
const questions=new Map(data.questions.map(question=>[question.id,question]));
if(lessons.size!==data.lessons.length||questions.size!==data.questions.length)throw new Error('R11 curriculum contains duplicate identifiers');
for(const question of questions.values()){
 const lesson=lessons.get(question.lesson_id);
 if(!lesson||!lesson.question_ids.includes(question.id))throw new Error('R11 question does not belong to its lesson');
 if(!['single_choice','open'].includes(question.type))throw new Error('R11 question type is unsupported');
}
const labels={required:'应说明的要点',acceptable_variants:'可接受的不同表述',rubric:'自评要点',evaluation_criteria:'评价要点',evaluation:'评价说明'};
const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
function prose(value){
 if(value===undefined||value===null)return '';
 if(Array.isArray(value))return value.map(item=>'• '+prose(item)).join('\n');
 if(typeof value==='object')return Object.entries(value).map(([key,item])=>(labels[key]||key)+'：\n'+prose(item)).join('\n\n');
 return String(value);
}
function questionFor(id){return typeof id==='string'?questions.get(id)||null:null;}
function lessonFor(id){return typeof id==='string'?lessons.get(id)||null:null;}
function answerFor(id){
 const question=questionFor(id);if(!question)return null;
 const choice=question.type==='single_choice';
 const index=choice?question.options.findIndex(option=>option.key===question.answer):-1;
 if(choice&&index<0)throw new Error('R11 correct option is missing');
 return {lesson_id:question.lesson_id,type:choice?'single_choice':'open_response',correct_option_index:choice?index:null,question};
}
function recordMatches(record,type){const question=questionFor(record.questionId);return !!question&&question.lesson_id===record.lessonId&&(type==='single_choice'?question.type==='single_choice':question.type==='open');}
function feedbackFor(answer,selected){
 const q=answer.question,manual=q.type==='open';
 const sections=['答案／评价要点：\n'+prose(q.answer),'解析：\n'+prose(q.explanation)];
 if(q.option_explanations&&JSON.stringify(q.option_explanations)!==JSON.stringify(q.explanation))sections.push('逐项解释：\n'+prose(q.option_explanations));
 if(q.acceptable_variants&&JSON.stringify(q.acceptable_variants)!==JSON.stringify(q.answer&&q.answer.acceptable_variants))sections.push('可接受的不同表述：\n'+prose(q.acceptable_variants));
 if(q.evaluation_criteria)sections.push('评价要点：\n'+prose(q.evaluation_criteria));
 if(q.common_error)sections.push('常见误区：\n'+prose(q.common_error));
 const reference=sections.join('\n\n');
 return {manual,correct:manual?null:answer.correct_option_index===selected,correctOptionIndex:manual?null:answer.correct_option_index,
  questionId:q.id,questionVersion:q.version,curriculumVersion:data.version,
  reference,explanation:reference,rubric:prose(q.answer&&q.answer.rubric||q.evaluation_criteria||q.rubric||''),
  answer:clone(q.answer),explanationData:clone(q.explanation),optionExplanations:clone(q.option_explanations),
  acceptableVariants:clone(q.acceptable_variants||q.answer&&q.answer.acceptable_variants),evaluationCriteria:clone(q.evaluation_criteria),commonError:clone(q.common_error),sourceIds:clone(q.source_ids)};
}
const tastingLessons=data.lessons.map(lesson=>({id:lesson.id,title:lesson.title,kind:lesson.track==='tea34'?'tea':'incense'}));
module.exports={version:data.version,lessonFor,questionFor,answerFor,recordMatches,feedbackFor,prose,tastingLessons};
