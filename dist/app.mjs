import {MAX_BYTES,byteLength,walk,escapePointer} from './engine.mjs';
const $=id=>document.getElementById(id);
const source=$('source'),worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
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
let documentState=null,nodes=new Map(),revision=0,view='tree',selected=null,outputText='',outputLabel='',currentError=null,history=[],diffResult=null,jobId=0,analysisTimer,searchTimer,toastTimer,workerFailed=false;
const pending=new Map();
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
function request(action,text=source.value,options={}){
  if(workerFailed)return Promise.reject(new Error('处理线程不可用，请刷新页面重试'));
  const id=++jobId;$('workerStatus').textContent='处理中…';
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,action,text,options});});
}
worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);$('workerStatus').textContent=pending.size?'处理中…':'就绪';if(data.error)job.reject(data.error);else job.resolve(data.result);};
worker.onerror=()=>{workerFailed=true;for(const job of pending.values())job.reject(new Error('处理线程启动失败，请使用近期版本浏览器并刷新页面'));pending.clear();$('workerStatus').textContent='处理线程不可用';toast('处理线程不可用，请刷新页面重试');};
function highlight(text,element){
  element.replaceChildren();
  if(text.length>200000){element.textContent=text;return;}
  const expression=/("(?:\\[\s\S]|[^"\\])*")(\s*:)?|(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|\b(true|false|null)\b/g;
  let last=0,count=0;const fragment=document.createDocumentFragment();
  for(const match of text.matchAll(expression)){
    if(++count>6000)break;
    fragment.append(document.createTextNode(text.slice(last,match.index)));
    if(match[1]){fragment.append(node('span',match[2]?'token-key':'token-string',match[1]));if(match[2])fragment.append(document.createTextNode(match[2]));}
    else fragment.append(node('span',match[3]?'token-number':'token-literal',match[0]));
    last=match.index+match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(last)));element.append(fragment);
}
function updateEditor(){
  const text=source.value;let lines=1;for(let i=0;i<text.length;i++)if(text.charCodeAt(i)===10)lines++;
  $('lineNumbers').textContent=Array.from({length:Math.min(lines,10000)},(_,i)=>i+1).join('\n');
  source.classList.toggle('plain-text',text.length>200000);
  if(text.length<=200000)highlight(text,$('highlight'));else $('highlight').replaceChildren();
  $('sourceMeta').textContent=`${formatBytes(byteLength(text))} · ${lines} 行`;
  syncScroll();
}
const formatBytes=bytes=>bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KiB':(bytes/1048576).toFixed(2)+' MiB';
function syncScroll(){$('highlight').style.transform=`translate(${-source.scrollLeft}px,${-source.scrollTop}px)`;$('lineNumbers').style.transform=`translateY(${-source.scrollTop}px)`;}
source.addEventListener('scroll',syncScroll);
function clearDerived(){
  documentState=null;selected=null;nodes=new Map();outputText='';diffResult=null;
  $('output').replaceChildren();$('diffSummary').replaceChildren();$('diffResults').replaceChildren(node('div','empty-state','点击「开始对比」查看差异。'));$('diffDownloadBtn').disabled=true;
  ['formatBtn','minifyBtn','sortBtn','downloadBtn','extractBtn'].forEach(id=>$(id).disabled=true);
  ['nodeCount','depthCount','bigCount'].forEach(id=>$(id).textContent='—');
  $('warningCard').hidden=true;$('errorCard').hidden=true;$('searchCount').textContent='';
  $('tree').replaceChildren(node('div','empty-state',source.value.trim()?'正在解析…':'粘贴一份 JSON，结构会在这里展开。'));
}
function changed(immediate=false){
  revision++;clearTimeout(analysisTimer);clearTimeout(searchTimer);clearDerived();updateEditor();
  $('validity').className='idle';$('validity').replaceChildren(node('i'),document.createTextNode(source.value.trim()?'正在校验…':'等待输入'));
  if(!source.value.trim())return;
  if(immediate)analyze();else analysisTimer=setTimeout(analyze,300);
}
source.addEventListener('input',()=>changed());
function showSourceError(error){
  currentError=error;$('validity').className='invalid';$('validity').replaceChildren(node('i'),document.createTextNode(error.code==='LIMIT'?'超出限制':'需要检查'));
  $('errorMessage').textContent=error.message;$('errorLocation').textContent=`第 ${error.line??1} 行，第 ${error.column??1} 列`;$('errorCard').hidden=false;
  $('tree').replaceChildren(node('div','empty-state','修正左侧输入后，这里会自动更新。'));
}
async function analyze(){
  const ticket=revision,text=source.value;
  try{
    const doc=await request('analyze',text);if(ticket!==revision)return;
    documentState=doc;currentError=null;walk(doc.root,(n,p)=>nodes.set(n.id,{node:n,pointer:p}));
    $('validity').className='valid';$('validity').replaceChildren(node('i'),document.createTextNode('有效 JSON'));
    $('nodeCount').textContent=doc.stats.nodes.toLocaleString();$('depthCount').textContent=doc.stats.depth;$('bigCount').textContent=doc.stats.bigNumbers;
    ['formatBtn','minifyBtn','sortBtn','downloadBtn','extractBtn'].forEach(id=>$(id).disabled=false);
    $('errorCard').hidden=true;
    if(doc.stats.duplicates){$('warningCard').textContent=`⚠ ${doc.stats.duplicates} 处重复键。格式化会保留所有成员；有歧义的路径与对比会拒绝执行。`;$('warningCard').hidden=false;}
    renderTree();if($('search').value)runSearch();if(view==='output')updateOutput();
  }catch(error){if(ticket===revision)showSourceError(error);}
}
function loadText(text,name,{remember=false}={}){
  if(remember){history.push(source.value);if(history.length>5)history.shift();}
  source.value=text;source.scrollTop=0;source.scrollLeft=0;$('undoBtn').disabled=!history.length;
  if(name)$('fileName').textContent=name;
  changed(true);
}
function setView(next){
  view=next;document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$(button.dataset.view+'Panel').hidden=!active;});
  if(view==='output'&&!outputText&&documentState)updateOutput();
  $('copyBtn').textContent=view==='diff'?'▣ 复制差异':view==='tree'?'▣ 复制节点':'▣ 复制结果';
}
document.querySelectorAll('[data-view]').forEach(button=>{
  button.onclick=()=>setView(button.dataset.view);
  button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-view]')];let index=tabs.indexOf(button);index=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;setView(tabs[index].dataset.view);tabs[index].focus();};
});
function selectTree(nodeData,pointer,element){
  selected={node:nodeData,pointer};$('pointer').value=pointer;$('pointerHint').textContent=`${nodeData.type} · ${pointer||'根值（空路径）'}`;
  $('tree').querySelectorAll('.selected').forEach(e=>e.classList.remove('selected'));element?.classList.add('selected');
}
function preview(n){return n.type==='string'?JSON.stringify(n.value):n.raw??`${n.children.length} ${n.type==='array'?'项':'个字段'}`;}
function renderTree(){
  const container=$('tree');container.replaceChildren();if(!documentState)return;
  const root=documentState.root;
  function branch(n,label,pointer,depth){
    if(n.type!=='object'&&n.type!=='array'){
      const row=node('div','tree-leaf');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`${pointer||'根值'} ${n.type}`);
      row.append(node('span','tree-key',label+':'),node('span','tree-value '+n.type,preview(n)));
      row.onclick=()=>selectTree(n,pointer,row);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}};return row;
    }
    const wrapper=node('div','tree-node'+(depth===0?' root':'')),details=node('details'),summary=node('summary');
    summary.append(node('span','tree-arrow','▶'),node('span','tree-key',label),node('span','tree-kind',n.type==='object'?'{ }':'[ ]'),node('span','tree-size',`${n.children.length} ${n.type==='object'?'个字段':'项'}`));
    summary.addEventListener('click',()=>selectTree(n,pointer,summary));details.append(summary);wrapper.append(details);
    let shown=0,childrenContainer=null,more=null;
    function populate(){
      if(!childrenContainer){childrenContainer=node('div');details.append(childrenContainer);}
      more?.remove();const end=Math.min(shown+100,n.children.length);
      for(;shown<end;shown++){
        const entry=n.children[shown],object=n.type==='object',child=object?entry.node:entry,key=object?entry.key:String(shown);
        childrenContainer.append(branch(child,object?JSON.stringify(key):`[${key}]`,pointer+'/'+escapePointer(key),depth+1));
      }
      if(shown<n.children.length){more=node('button','tree-more',`继续显示（还剩 ${n.children.length-shown} 项）`);more.onclick=populate;childrenContainer.append(more);}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!childrenContainer)populate();});
    if(depth<2){details.open=true;populate();}
    return wrapper;
  }
  container.append(branch(root,'root','',0));
}
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);if(!$('search').value){$('searchCount').textContent='';renderTree();}else searchTimer=setTimeout(runSearch,220);});
async function runSearch(){
  if(!documentState)return;const text=source.value,ticket=revision,query=$('search').value;if(!query)return;
  try{const result=await request('search',text,{query});if(ticket!==revision||query!==$('search').value)return;
    $('searchCount').textContent=`${result.total} 个匹配${result.total>200?' · 显示前 200':''}`;$('tree').replaceChildren();
    for(const item of result.found){const row=node('button','search-result');row.append(node('b','',item.pointer||'(root)'),node('span','',item.preview));row.onclick=()=>{const data=nodes.get(item.id);if(data)selectTree(data.node,data.pointer,row);};$('tree').append(row);}
    if(!result.found.length)$('tree').append(node('div','empty-state','没有找到匹配的键、值或路径。'));
  }catch(error){toast(error.message);}
}
function indentation(){return $('indent').value==='tab'?'tab':Number($('indent').value);}
async function updateOutput(){
  if(!documentState)return;const ticket=revision;
  try{const result=await request('format',source.value,{indent:indentation()});if(ticket!==revision)return;outputText=result;outputLabel=`完整文档 · ${indentation()==='tab'?'Tab':indentation()+' 空格'}`;$('outputLabel').textContent=outputLabel;highlight(result,$('output'));}
  catch(error){if(ticket===revision)toast(error.message);}
}
async function transform(action,sortKeys=false){
  if(!source.value.trim())return;const text=source.value,ticket=revision;
  try{const result=await request(action,text,{indent:indentation(),sortKeys});if(ticket!==revision){toast('输入已变化，请重新执行');return;}if(result===text){toast('当前内容已是该格式');return;}loadText(result,null,{remember:true});toast(action==='minify'?'已压缩，数字原文保留':sortKeys?'已递归排序键名，数组顺序保留':'已格式化，数字原文保留');}
  catch(error){if(ticket===revision){if(!documentState||error.code==='SYNTAX')showSourceError(error);toast(error.message);}}
}
$('formatBtn').onclick=()=>transform('format');$('minifyBtn').onclick=()=>transform('minify');$('sortBtn').onclick=()=>transform('format',true);
$('undoBtn').onclick=()=>{if(history.length)loadText(history.pop());};
$('indent').onchange=()=>{outputText='';if(view==='output')updateOutput();};
source.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();transform('format');}
  if(e.key==='Tab'){e.preventDefault();const insert=indentation()==='tab'?'\t':' '.repeat(indentation());source.setRangeText(insert,source.selectionStart,source.selectionEnd,'end');changed();}
});
$('locateBtn').onclick=()=>{if(currentError){source.focus();const position=Math.min(source.value.length,currentError.offset??0);source.setSelectionRange(position,Math.min(position+1,source.value.length));source.scrollTop=Math.max(0,((currentError.line??1)-4)*23);syncScroll();}};
$('exampleBtn').onclick=()=>{loadText(sample,'example.json',{remember:!!source.value});toast('已载入含 19 位 ID 的示例');};
$('clearBtn').onclick=()=>loadText('','source.json',{remember:!!source.value});
$('pasteBtn').onclick=async()=>{if(!navigator.clipboard?.readText){toast('请直接在左侧使用 Ctrl / ⌘ + V 粘贴');source.focus();return;}try{const text=await navigator.clipboard.readText();if(byteLength(text)>MAX_BYTES){toast('剪贴板内容超过 2 MiB');return;}if(!text.trim()){toast('剪贴板中没有文本');return;}loadText(text,'clipboard.json',{remember:!!source.value});}catch{toast('浏览器未允许读取剪贴板，请在左侧直接粘贴');source.focus();}};
$('extractBtn').onclick=async()=>{if(!documentState)return;const ticket=revision,pointer=$('pointer').value;try{const result=await request('get',source.value,{pointer,indent:indentation()});if(ticket!==revision)return;outputText=result;outputLabel=`提取 ${pointer||'(root)'}`;setView('output');$('outputLabel').textContent=outputLabel;highlight(result,$('output'));}catch(error){$('pointerHint').textContent=error.message;toast(error.message);}};
$('pointer').onkeydown=e=>{if(e.key==='Enter')$('extractBtn').click();};$('backToRootBtn').onclick=()=>{outputText='';updateOutput();};
async function copy(text){if(!text){toast('暂时没有可复制的结果');return;}try{await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('复制未获允许，可选中文本复制或下载结果');}}
$('copyBtn').onclick=()=>{if(view==='diff'){copy(diffResult?JSON.stringify(diffResult,null,2):'');return;}if(view==='tree'){const n=selected?.node??documentState?.root;copy(n?source.value.slice(n.start,n.end):'');}else copy(outputText);};
function download(text,name,type='application/json'){if(!text){toast('暂时没有可导出的内容');return;}const url=URL.createObjectURL(new Blob([text],{type})),link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已导出文件');}
function outputName(suffix){return $('fileName').textContent.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]/g,'-')+suffix+'.json';}
$('downloadBtn').onclick=()=>{if(documentState)download(source.value,outputName('-harbor'));};$('downloadResultBtn').onclick=()=>download(outputText,outputName('-result'));
async function loadFile(file){if(!file)return;if(file.size>MAX_BYTES){toast('文件超过 2 MiB，请拆分后处理');return;}try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());loadText(text,file.name,{remember:!!source.value});toast('文件已导入');}catch{toast('无法读取文件，请使用有效的 UTF-8 编码 JSON 文件');}finally{$('fileInput').value='';}}
$('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>loadFile(e.target.files[0]);
let dragDepth=0;const zone=$('dropZone');
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});document.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();dragDepth=0;zone.classList.remove('dragging');loadFile(e.dataTransfer.files[0]);}});
zone.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){dragDepth++;zone.classList.add('dragging');}});zone.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;zone.classList.remove('dragging');}});
function resetDiff(){diffResult=null;$('diffDownloadBtn').disabled=true;$('diffSummary').replaceChildren();$('diffResults').replaceChildren(node('div','empty-state','内容已变化，请重新开始对比。'));}
$('compareSource').addEventListener('input',resetDiff);
$('diffExampleBtn').onclick=()=>{loadText(sample,'example.json',{remember:!!source.value});$('compareSource').value=sample.replace('129.90','139.90').replace('"active": true','"active": false').replace('"limit": null','"limit": 20,\n    "theme": "dark"');resetDiff();};
$('compareBtn').onclick=async()=>{
  const text=source.value,other=$('compareSource').value,ticket=revision;if(!text.trim()||!other.trim()){toast('请在左侧和对比输入区各放入一份 JSON');return;}
  try{const result=await request('diff',text,{other});if(ticket!==revision||other!==$('compareSource').value)return;diffResult=result;$('diffDownloadBtn').disabled=false;$('diffSummary').replaceChildren();$('diffResults').replaceChildren();
    for(const [type,label]of [['added','新增'],['removed','删除'],['changed','修改']])$('diffSummary').append(node('span',type,`${label} ${result.changes.filter(c=>c.type===type).length}`));
    if(result.equal)$('diffResults').append(node('div','empty-state','✓ 两份 JSON 在当前对比规则下相同。'));
    for(const change of result.changes){const item=node('div','diff-item '+change.type),values=node('div','diff-values');item.append(node('span','diff-path',change.pointer||'(root)'));if(change.before!==undefined)values.append(node('del','',`− ${change.before.length>300?change.before.slice(0,300)+'…':change.before}`));if(change.after!==undefined)values.append(node('ins','',`+ ${change.after.length>300?change.after.slice(0,300)+'…':change.after}`));item.append(values);$('diffResults').append(item);}
    if(result.truncated)$('diffResults').append(node('p','field-note','仅显示前 500 处差异，请缩小文档范围。导出的报告也受此限制。'));
  }catch(error){if(ticket!==revision||other!==$('compareSource').value)return;diffResult=null;$('diffDownloadBtn').disabled=true;$('diffSummary').replaceChildren();$('diffResults').replaceChildren(node('p','diff-error',`${error.message}${error.code==='SYNTAX'?`（第 ${error.line} 行，第 ${error.column} 列；请检查两侧输入）`:''}`));}
};
$('diffDownloadBtn').onclick=()=>{if(diffResult)download(JSON.stringify(diffResult,null,2),'jsonharbor-diff.json');};
$('guideBtn').onclick=()=>$('guide').showModal();$('closeGuide').onclick=()=>$('guide').close();$('guide').addEventListener('click',e=>{if(e.target===$('guide')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
loadText(sample,'example.json');
