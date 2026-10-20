import {formatJson,byteLength,MAX_BYTES} from './engine.mjs';

// Bounded Myers line diff. If the edit distance is very large, retain exact
// common edges and show the remaining range as a replacement, never as equal.
export function compareCode(before,after,{mode='formatted'}={}) {
  if(!['formatted','raw'].includes(mode))throw new TypeError('未知代码对比模式');
  if(byteLength(before)>MAX_BYTES||byteLength(after)>MAX_BYTES)throw new Error('代码对比输入最大为 2 MiB');
  const prepare=(text,label)=>{if(mode==='raw')return text;try{return formatJson(text,{indent:2});}catch(error){throw new Error(`${label}：${error.message}${error.line?`（第 ${error.line} 行，第 ${error.column} 列）`:''}`);}};
  const a=prepare(before,'原始 JSON').split('\n'),b=prepare(after,'修改后的 JSON').split('\n');
  if(a.length>10000||b.length>10000)throw new Error('代码视图每侧最多 10000 行，请缩小文档范围；仍可查看字段差异。');
  let prefix=0,suffix=0;
  while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix),trace=[];
  let v=new Map([[1,0]]),effort=0,edits=null;
  outer:for(let d=0;d<=Math.min(left.length+right.length,512);d++){
    trace.push(new Map(v));
    for(let k=-d;k<=d;k+=2){
      if(++effort>1000000)break outer;
      let x=k===-d||(k!==d&&(v.get(k-1)??-Infinity)<(v.get(k+1)??-Infinity))?(v.get(k+1)??0):(v.get(k-1)??0)+1;
      let y=x-k;
      while(x<left.length&&y<right.length&&left[x]===right[y]){x++;y++;if(++effort>1000000)break outer;}
      v.set(k,x);
      if(x>=left.length&&y>=right.length){
        edits=[];let bx=left.length,by=right.length;
        for(let depth=d;depth>=0;depth--){
          const previous=trace[depth],diagonal=bx-by;
          const pk=diagonal===-depth||(diagonal!==depth&&(previous.get(diagonal-1)??-Infinity)<(previous.get(diagonal+1)??-Infinity))?diagonal+1:diagonal-1;
          const px=previous.get(pk)??0,py=px-pk;
          while(bx>px&&by>py){edits.push({type:'equal',text:left[--bx]});by--;}
          if(depth){if(bx===px)edits.push({type:'added',text:right[--by]});else edits.push({type:'removed',text:left[--bx]});}
        }
        edits.reverse();break outer;
      }
    }
  }
  const coarse=edits===null;
  if(coarse)edits=[...left.map(text=>({type:'removed',text})),...right.map(text=>({type:'added',text}))];
  const operations=[...a.slice(0,prefix).map(text=>({type:'equal',text})),...edits,...(suffix?a.slice(a.length-suffix).map(text=>({type:'equal',text})):[])];
  const rows=[];let oldLine=1,newLine=1,group=0;
  for(let i=0;i<operations.length;){
    if(operations[i].type==='equal'){rows.push({kind:'equal',before:operations[i].text,after:operations[i].text,oldLine:oldLine++,newLine:newLine++});i++;continue;}
    const removed=[],added=[];group++;
    while(i<operations.length&&operations[i].type!=='equal'){const op=operations[i++];(op.type==='removed'?removed:added).push(op.text);}
    for(let n=0;n<Math.max(removed.length,added.length);n++)rows.push({kind:removed[n]!==undefined&&added[n]!==undefined?'changed':removed[n]!==undefined?'removed':'added',before:removed[n],after:added[n],oldLine:removed[n]!==undefined?oldLine++:null,newLine:added[n]!==undefined?newLine++:null,group});
  }
  return {rows,groups:group,added:operations.filter(o=>o.type==='added').length,removed:operations.filter(o=>o.type==='removed').length,oldLines:a.length,newLines:b.length,mode,coarse};
}

export function inlineChange(before,after){
  let start=0,end=0;
  while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;
  while(end<Math.min(before.length,after.length)-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  // Do not split a UTF-16 surrogate pair across separate highlight elements.
  if(start>0&&/[\uDC00-\uDFFF]/.test(before[start]??'')&&/[\uD800-\uDBFF]/.test(before[start-1]))start--;
  if(end>0&&/[\uDC00-\uDFFF]/.test(before[before.length-end]??'')&&/[\uD800-\uDBFF]/.test(before[before.length-end-1]??''))end--;
  return {start,beforeEnd:before.length-end,afterEnd:after.length-end};
}

export function foldRows(rows,{context=3,expanded=new Set()}={}){
  const result=[];
  for(let i=0;i<rows.length;){
    if(rows[i].kind!=='equal'){result.push({...rows[i],index:i});i++;continue;}
    let end=i;while(end<rows.length&&rows[end].kind==='equal')end++;
    const start=i,keepBefore=start?context:0,keepAfter=end<rows.length?context:0;
    if(end-start>keepBefore+keepAfter+2&&!expanded.has(start)){
      for(;i<start+keepBefore;i++)result.push({...rows[i],index:i});
      result.push({kind:'fold',start,count:end-start-keepBefore-keepAfter});
      i=end-keepAfter;
    }
    for(;i<end;i++)result.push({...rows[i],index:i});
  }
  return result;
}
