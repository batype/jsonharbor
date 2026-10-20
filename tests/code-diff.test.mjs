import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCode,foldRows,inlineChange} from '../dist/code-diff.mjs';

function reconstruct(result,key){return result.rows.filter(r=>r[key]!==undefined).map(r=>r[key]).join('\n');}
test('code diff aligns unchanged context, insertions, removals, replacements and exact long IDs',()=>{
  const before='a\nkeep\nid:9223372036854775807\ngone\nend',after='new\na\nkeep\nid:9223372036854775808\nend\nextra';
  const result=compareCode(before,after,{mode:'raw'});
  assert.equal(reconstruct(result,'before'),before);assert.equal(reconstruct(result,'after'),after);
  assert(result.rows.some(r=>r.kind==='equal'&&r.before==='keep'&&r.oldLine===2&&r.newLine===3));
  assert.equal(result.added,3);assert.equal(result.removed,2);assert.equal(result.groups,3);
  assert.deepEqual(inlineChange('"id": 9223372036854775807','"id": 9223372036854775808'),{start:24,beforeEnd:25,afterEnd:25});
  assert.deepEqual(inlineChange('x😀y','x😁y'),{start:1,beforeEnd:3,afterEnd:3});
});
test('formatted mode ignores indentation only and preserves number tokens, duplicate members and key order',()=>{
  assert.equal(compareCode('{"x":1}','{\n  "x": 1\n}').groups,0);
  const result=compareCode('{"id":9223372036854775807,"x":2.370,"x":-0}','{"id":9223372036854775808,"x":2.37,"x":0}');
  assert.match(reconstruct(result,'before'),/9223372036854775807/);assert.match(reconstruct(result,'before'),/2\.370/);assert.equal(result.groups,1);
  assert(compareCode('{"a":1,"b":2}','{"b":2,"a":1}').groups>0);
  assert.throws(()=>compareCode('{bad','{}'));assert(compareCode('{bad','{}',{mode:'raw'}).groups>0);
});
test('folding preserves context and expands selected unchanged ranges including entirely equal files',()=>{
  const result=compareCode(Array.from({length:40},(_,i)=>String(i)).join('\n'),Array.from({length:40},(_,i)=>i===20?'changed':String(i)).join('\n'),{mode:'raw'});
  const folded=foldRows(result.rows);assert.equal(folded.filter(r=>r.kind==='fold').length,2);
  assert(folded.some(r=>r.oldLine===18));assert(folded.some(r=>r.oldLine===24));
  assert.equal(foldRows(result.rows,{expanded:new Set([0,21])}).length,40);
  assert.equal(foldRows(compareCode('a\nb\nc','a\nb\nc',{mode:'raw'}).rows)[0].count,3);
});
test('line diff reconstructs deterministic inputs and bounded fallback retains all changes',()=>{
  let seed=7;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  for(let n=0;n<200;n++){
    const a=Array.from({length:Math.floor(random()*25)},()=>String(Math.floor(random()*8))).join('\n'),b=Array.from({length:Math.floor(random()*25)},()=>String(Math.floor(random()*8))).join('\n');
    const result=compareCode(a,b,{mode:'raw'});assert.equal(reconstruct(result,'before'),a);assert.equal(reconstruct(result,'after'),b);
    assert.equal(result.groups===0,a===b);for(const row of result.rows)if(row.kind==='equal')assert.equal(row.before,row.after);
    const x=a.split('\n'),y=b.split('\n'),lcs=Array.from({length:x.length+1},()=>new Uint16Array(y.length+1));
    for(let i=1;i<=x.length;i++)for(let j=1;j<=y.length;j++)lcs[i][j]=x[i-1]===y[j-1]?lcs[i-1][j-1]+1:Math.max(lcs[i-1][j],lcs[i][j-1]);
    assert.equal(result.added+result.removed,x.length+y.length-2*lcs[x.length][y.length]);
  }
  const a=Array.from({length:600},(_,i)=>'before'+i).join('\n'),b=Array.from({length:600},(_,i)=>'after'+i).join('\n');
  const result=compareCode(a,b,{mode:'raw'});assert.equal(result.coarse,true);assert.equal(reconstruct(result,'before'),a);assert.equal(reconstruct(result,'after'),b);
  assert.throws(()=>compareCode('x\n'.repeat(10001),'{}',{mode:'raw'}),/10000/);
});

test('worker keeps field reports separate from code diffs and permits raw invalid edits safely',async()=>{
  const messages=[];globalThis.self={postMessage:data=>messages.push(data)};
  await import('../dist/worker.mjs');
  const compare=(text,other,mode='formatted')=>{self.onmessage({data:{id:1,action:'diff',text,options:{other,mode}}});return messages.at(-1);};
  const result=compare('{"id":9223372036854775807}','{"id":9223372036854775808}').result;
  assert.equal(result.fields.changes[0].before,'9223372036854775807');assert.equal(result.code.groups,1);
  const duplicate=compare('{"x":1,"x":2}','{"x":1,"x":3}').result;assert.match(duplicate.fieldError,/重复键/);assert.equal(duplicate.code.groups,1);
  assert.equal(compare('{bad','{}','raw').result.code.groups,1);assert(compare('{bad','{}').error);
  delete globalThis.self;
});
