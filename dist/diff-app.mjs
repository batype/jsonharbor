import {byteLength} from './engine.mjs';
import {node,highlight} from './ui.mjs';
import {foldRows,inlineChange} from './code-diff.mjs';
const $=id=>document.getElementById(id);
const source=$('source'),worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
let diffResult=null,jobId=0,workerFailed=false,toastTimer;
const pending=new Map();
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
const sample=`{
  "project": "JSON Harbor",
  "description": "每一位数字，都值得保留。",
  "user": {
    "id": 9223372036854775807,
    "name": "林间来信",
    "active": true
  },
  "projects": [
    {
      "name": "每天一个开源小项目",
      "version": "1.0.0",
      "price": 129.90,
      "tags": ["local-first", "open-source"]
    }
  ],
  "settings": {
    "notifications": false,
    "limit": null
  }
}`;
function request(action,text=source.value,options={}){
  if(workerFailed)return Promise.reject(new Error('处理线程不可用，请刷新页面重试'));
  const id=++jobId;$('workerStatus').textContent='处理中…';
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,action,text,options});});
}
worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);$('workerStatus').textContent=pending.size?'处理中…':'就绪';if(data.error)job.reject(data.error);else job.resolve(data.result);};
worker.onerror=()=>{workerFailed=true;for(const job of pending.values())job.reject(new Error('处理线程启动失败，请使用近期版本浏览器并刷新页面'));pending.clear();$('workerStatus').textContent='处理线程不可用';toast('处理线程不可用，请刷新页面重试');};
async function copy(text){if(!text){toast('暂时没有可复制的结果');return;}try{await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('复制未获允许，可选中文本复制或下载结果');}}
function download(text,name,type='application/json'){if(!text){toast('暂时没有可导出的内容');return;}const url=URL.createObjectURL(new Blob([text],{type})),link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已导出文件');}
let diffGeneration=0,diffLayout=matchMedia('(max-width: 600px)').matches?'unified':'split',activeGroup=0,expandedContext=new Set(),codePage=0;
const CODE_PAGE_SIZE=400;
function resetDiff(){
  diffGeneration++;diffResult=null;activeGroup=0;expandedContext=new Set();codePage=0;
  $('codeComparison').hidden=true;$('waitingPlaceholder').hidden=false;$('copyBtn').disabled=true;
  $('compareBtn').textContent='⇄ 开始对比';$('diffDownloadBtn').disabled=true;$('diffSummary').replaceChildren();$('diffResults').replaceChildren(node('div','empty-state','内容已变化，请重新开始对比。'));
  $('codeDiffBody').replaceChildren(node('div','empty-state','粘贴两份 JSON，点击「开始对比」查看代码变化。'));
  $('codeDiffStats').textContent='等待对比';$('codeDiffNotice').hidden=true;$('codePaging').hidden=true;
  updateChangeNavigation();
}
function updateChangeNavigation(){
  const total=diffResult?.code?.groups??0;
  $('changePosition').textContent=`${activeGroup} / ${total}`;
  $('prevChangeBtn').disabled=$('nextChangeBtn').disabled=!total||diffLayout==='fields';
}
function setDiffLayout(layout){
  diffLayout=layout;
  for(const [id,value]of [['splitDiffBtn','split'],['unifiedDiffBtn','unified'],['fieldDiffBtn','fields']])$(id).setAttribute('aria-pressed',String(value===layout));
  $('codeDiffBody').hidden=layout==='fields';$('diffResults').hidden=layout!=='fields';
  $('foldUnchanged').disabled=layout==='fields';
  codePage=0;renderCodeDiff();updateChangeNavigation();
}
function codeText(text,other,type){
  text=text.replace(/\r/g,'␍');if(other!==undefined)other=other.replace(/\r/g,'␍');
  const code=node('code','diff-code-text');
  if(other===undefined||text===other||text.length>4000||other.length>4000){highlight(text,code);return code;}
  const change=type==='removed'?inlineChange(text,other):inlineChange(other,text),end=type==='removed'?change.beforeEnd:change.afterEnd;
  highlight(text.slice(0,change.start),code);
  if(end>change.start){const mark=node('mark','inline-'+type);highlight(text.slice(change.start,end),mark);code.append(mark);}
  const tail=node('span');highlight(text.slice(end),tail);code.append(tail);return code;
}
function diffLine(row,side,{unified=false,kind=row.kind}={}){
  const text=side==='before'?row.before:row.after,line=side==='before'?row.oldLine:row.newLine;
  const type=kind==='equal'?'equal':side==='before'?'removed':'added';
  const element=node('div','diff-code-line '+(text===undefined?'missing':type));
  if(row.group){element.dataset.group=row.group;element.classList.toggle('active-change',row.group===activeGroup);}
  if(unified){element.append(node('span','diff-line-number',side==='before'||kind==='equal'?row.oldLine??'':''),node('span','diff-line-number',side==='after'||kind==='equal'?row.newLine??'':''));}
  else element.append(node('span','diff-line-number',line??''));
  element.append(node('span','diff-line-sign',text===undefined||type==='equal'?'':type==='removed'?'−':'+'));
  if(text!==undefined)element.append(codeText(text,kind==='changed'?(side==='before'?row.after:row.before):undefined,type));
  else element.append(node('code','diff-code-text',' '));
  return element;
}
function contextRow(row){
  const button=node('button','diff-context',`↕ 展开 ${row.count} 行未修改代码`);
  button.onclick=()=>{expandedContext.add(row.start);renderCodeDiff();};return button;
}
function visibleCodeRows(){return !diffResult?.code?[]:$('foldUnchanged').checked?foldRows(diffResult.code.rows,{expanded:expandedContext}):diffResult.code.rows;}
function renderCodeDiff(){
  const model=diffResult?.code,body=$('codeDiffBody');
  $('codePaging').hidden=true;if(!model)return;
  if(diffLayout==='fields')return;
  const allRows=visibleCodeRows();codePage=Math.max(0,Math.min(codePage,Math.ceil(allRows.length/CODE_PAGE_SIZE)-1));
  const rows=allRows.slice(codePage*CODE_PAGE_SIZE,(codePage+1)*CODE_PAGE_SIZE);body.replaceChildren();
  if(diffLayout==='split'){
    const columns=node('div','diff-columns'),scrolls=[];
    for(const [side,title]of [['before','原始 JSON · BEFORE'],['after','修改后的 JSON · AFTER']]){
      const pane=node('section','diff-column'),heading=node('div','diff-column-heading',title),scroll=node('div','diff-code-scroll');
      scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',side==='before'?'原始代码差异':'修改后代码差异');
      const content=node('div','diff-code-lines');for(const row of rows)content.append(row.kind==='fold'?contextRow(row):diffLine(row,side));
      scroll.append(content);pane.append(heading,scroll);columns.append(pane);scrolls.push(scroll);
    }
    for(const [index,scroll]of scrolls.entries())scroll.onscroll=()=>{const other=scrolls[1-index];if(Math.abs(other.scrollTop-scroll.scrollTop)>1)other.scrollTop=scroll.scrollTop;};
    body.append(columns);
  }else{
    const scroll=node('div','diff-code-scroll unified-code');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','合并代码差异');
    const content=node('div','diff-code-lines');
    for(const row of rows){if(row.kind==='fold')content.append(contextRow(row));else if(row.kind==='equal')content.append(diffLine(row,'before',{unified:true}));else{if(row.before!==undefined)content.append(diffLine(row,'before',{unified:true}));if(row.after!==undefined)content.append(diffLine(row,'after',{unified:true}));}}
    scroll.append(content);body.append(scroll);
  }
  if(allRows.length>CODE_PAGE_SIZE){$('codePaging').hidden=false;$('codePageInfo').textContent=`显示第 ${codePage*CODE_PAGE_SIZE+1}–${Math.min((codePage+1)*CODE_PAGE_SIZE,allRows.length)} 行 / ${allRows.length} 个对齐行（含折叠段）`;$('prevCodePage').disabled=codePage===0;$('nextCodePage').disabled=(codePage+1)*CODE_PAGE_SIZE>=allRows.length;}
}
function navigateChange(direction){
  const count=diffResult?.code?.groups;if(!count)return;
  activeGroup=(activeGroup-1+direction+count)%count+1;
  const rows=visibleCodeRows(),index=rows.findIndex(row=>row.group===activeGroup);codePage=Math.floor(index/CODE_PAGE_SIZE);renderCodeDiff();updateChangeNavigation();
  const target=$('codeDiffBody').querySelector(`[data-group="${activeGroup}"]`);target?.scrollIntoView({block:'nearest'});
}
$('prevChangeBtn').onclick=()=>navigateChange(-1);$('nextChangeBtn').onclick=()=>navigateChange(1);
$('splitDiffBtn').onclick=()=>setDiffLayout('split');$('unifiedDiffBtn').onclick=()=>setDiffLayout('unified');$('fieldDiffBtn').onclick=()=>setDiffLayout('fields');
$('prevCodePage').onclick=()=>{codePage--;renderCodeDiff();};$('nextCodePage').onclick=()=>{codePage++;renderCodeDiff();};
$('foldUnchanged').onchange=()=>{codePage=0;renderCodeDiff();};
$('compareSource').addEventListener('input',()=>{resetDiff();updateInputMeta();});
source.addEventListener('input',()=>{resetDiff();updateInputMeta();});
$('diffExampleBtn').onclick=()=>{loadText(sample);$('compareSource').value=sample.replace('129.90','139.90').replace('"active": true','"active": false').replace('"limit": null','"limit": 20,\n    "theme": "dark"');resetDiff();updateInputMeta();toast('输入已准备好，点击开始对比');};
$('swapDiffBtn').onclick=()=>{const before=source.value,after=$('compareSource').value;if(!after.trim()){toast('请先填写修改后的 JSON');return;}loadText(after);$('compareSource').value=before;resetDiff();updateInputMeta();toast('输入已准备好，点击开始对比');};
$('diffMode').onchange=resetDiff;
async function runComparison(scrollToResult=true){
  const text=source.value,other=$('compareSource').value,mode=$('diffMode').value,ticket=++diffGeneration;
  if(!text.trim()||!other.trim()){toast('请在两侧各放入一份 JSON');(!text.trim()?source:$('compareSource')).focus();return;}
  clearTimeout(toastTimer);$('toast').classList.remove('show');
  $('codeComparison').hidden=false;$('waitingPlaceholder').hidden=true;
  diffResult=null;$('diffDownloadBtn').disabled=true;$('diffSummary').replaceChildren();$('diffResults').replaceChildren();$('codeDiffNotice').hidden=true;$('codeDiffStats').textContent='正在对齐…';updateChangeNavigation();$('codeDiffBody').replaceChildren(node('div','empty-state','正在对齐代码行…'));
  $('compareBtn').textContent='对比中…';
  try{
    const result=await request('diff',text,{other,mode});if(ticket!==diffGeneration)return;
    diffResult=result;expandedContext=new Set();codePage=0;activeGroup=result.code?.groups?1:0;
    $('diffDownloadBtn').disabled=!result.fields;$('copyBtn').disabled=!result.fields;$('diffSummary').replaceChildren();$('diffResults').replaceChildren();
    if(result.fields){
      for(const [type,label]of [['added','新增字段'],['removed','删除字段'],['changed','修改字段']])$('diffSummary').append(node('span',type,`${label} ${result.fields.changes.filter(c=>c.type===type).length}`));
      if(result.fields.equal)$('diffResults').append(node('div','empty-state','✓ 字段相同。字段比较忽略键顺序与字符串转义写法，代码视图仍会展示这些改动。'));
      for(const change of result.fields.changes){const item=node('div','diff-item '+change.type),values=node('div','diff-values');item.append(node('span','diff-path',change.pointer||'(root)'));if(change.before!==undefined)values.append(node('del','',`− ${change.before.length>300?change.before.slice(0,300)+'…':change.before}`));if(change.after!==undefined)values.append(node('ins','',`+ ${change.after.length>300?change.after.slice(0,300)+'…':change.after}`));item.append(values);$('diffResults').append(item);}
      if(result.fields.truncated)$('diffResults').append(node('p','field-note','字段报告仅显示前 500 处差异，导出也受此限制；代码视图另行按行展示。'));
    }else $('diffResults').append(node('p','diff-error',`字段对比暂不可用：${result.fieldError}`));
    const model=result.code;$('codeDiffStats').textContent=model?`${model.groups?model.groups+' 处代码变化':'代码完全相同'} · +${model.added} 行 / −${model.removed} 行`: '代码视图暂不可用';
    const notices=[result.fieldError?`字段对比暂不可用：${result.fieldError}`:'',result.codeError??'',model?.coarse?'差异范围较大：已保留首尾相同行，中间按整段替换显示。':''];
    $('codeDiffNotice').textContent=notices.filter(Boolean).join(' ');$('codeDiffNotice').hidden=!notices.some(Boolean);
    $('diffRule').textContent=mode==='formatted'?'规范化只统一缩进，保留键顺序、字符串和数字原文；字段视图忽略键顺序。':'原文按实际文本行比较，包含空格、缩进和换行差异；字段视图使用 JSON 结构。';
    if(!model){$('codeDiffBody').replaceChildren(node('div','empty-state',result.codeError));setDiffLayout('fields');}else{if(diffLayout==='fields'&&!result.fields)setDiffLayout('split');else renderCodeDiff();}
    updateChangeNavigation();if(scrollToResult)$('codeComparison').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }catch(error){if(ticket!==diffGeneration)return;diffResult=null;setDiffLayout('split');$('codeDiffBody').replaceChildren(node('p','diff-error',`${error.message} 可切换「原文逐行」查看编辑中的代码差异。`));$('codeDiffStats').textContent='请检查输入';}
  finally{if(ticket===diffGeneration)$('compareBtn').textContent='⇄ 开始对比';}
}
$('compareBtn').onclick=()=>runComparison();
$('diffDownloadBtn').onclick=()=>{if(diffResult?.fields)download(JSON.stringify(diffResult.fields,null,2),'jsonharbor-diff.json');};
function updateInputMeta(){
  for(const [input,id]of [[source,'beforeMeta'],[$('compareSource'),'afterMeta']])$(id).textContent=`${byteLength(input.value).toLocaleString()} B · ${input.value?input.value.split('\n').length:0} 行`;
}
function loadText(text){source.value=text;source.scrollTop=source.scrollLeft=0;resetDiff();updateInputMeta();}
$('copyBtn').onclick=()=>copy(diffResult?.fields?JSON.stringify(diffResult.fields,null,2):'');
for(const input of [source,$('compareSource')])input.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();runComparison();}});
setDiffLayout(diffLayout);resetDiff();updateInputMeta();
