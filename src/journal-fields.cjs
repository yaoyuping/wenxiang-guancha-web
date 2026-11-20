// Optional vocabulary, never auto-filled as an observed result.
const vocab={
 incense:{aroma:['木质','甜润','奶脂联想','树脂','辛香','花香','清凉联想','焦味','闷味'],observation:[]},
 tea:{aroma:['花香','果香','清香','焙火香','木质','焦味'],taste:['鲜','甜','苦','涩','酸'],texture:['轻盈','柔和','厚实','顺滑','粗涩'],color:['浅黄','金黄','橙黄','橙红','红褐','明亮','浑浊'],aftertaste:['短','较持久','尚不明显'],salivation:['尚不明显','可感受到'],leafBase:['舒展','尚未舒展','较整齐','较破碎']}
};
const fields={incense:[{key:'aroma',label:'气味',hint:'先选你实际闻见的，也可以只写自己的词。'},{key:'observation',label:'变化',hint:'这一段出现、减弱或消失的是什么？'}],tea:[{key:'aroma',label:'香气',hint:'闻到的气味，与入口滋味分开。'},{key:'taste',label:'滋味',hint:'入口后，哪些味觉更明显？'},{key:'texture',label:'汤感',hint:'写入口的质地，不用把“厚”当作质量分数。'},{key:'color',label:'汤色',hint:'尽量在同一杯具与光线下比较。'},{key:'aftertaste',label:'回甘',hint:'咽下后，甜感是否出现、持续多久？'},{key:'salivation',label:'生津',hint:'只记这次感受，未察觉就留空。'},{key:'leafBase',label:'叶底',hint:'记录舒展、整碎、色泽与均匀程度。'}]};
function group(kind){return kind==='tea'?'infusions':'stages';}
function words(kind,field,value){const selected=String(value||'').split('、').map(x=>x.trim());return ((vocab[kind]||{})[field]||[]).map(word=>({word,selected:selected.includes(word)}));}
function toggle(value,word,kind,field){if(!((vocab[kind]||{})[field]||[]).includes(word))return String(value||'');const tokens=String(value||'').split('、').map(x=>x.trim()).filter(Boolean);const next=tokens.includes(word)?tokens.filter(x=>x!==word):[...tokens,word];return next.join('、');}
function summarize(form){const g=group(form.kind),rows=form[g]||[];return rows.map((r,i)=>({id:r.id,index:i,label:form.kind==='tea'?'第 '+(i+1)+' 泡':['初闻','变化','余韵'][i]||'第 '+(i+1)+' 段',preview:[r.aroma,form.kind==='tea'?r.taste:r.observation].filter(Boolean).join(' · ')||'尚未填写',hasContent:Object.keys(r).some(k=>!['id','position'].includes(k)&&r[k]!==''&&r[k]!=null)}));}
module.exports={fields,group,words,toggle,summarize};
