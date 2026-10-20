import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,formatJson,minifyJson,extractJson,diffJson,JsonHarborError,MAX_BYTES} from '../dist/engine.mjs';

test('formatting preserves numeric lexemes, string escapes, duplicate members and order',()=>{
  const text='{"id":9223372036854775807,"price":2.370,"huge":2.3e+500,"zero":-0,"a":"\\u0061","x":1,"x":2}';
  const formatted=formatJson(text,{indent:4});
  assert.equal(minifyJson(formatted),text);
  const doc=parseDocument(text);assert.equal(doc.stats.duplicates,1);assert.equal(doc.stats.bigNumbers,2);
  assert.equal(doc.warnings[0].pointer,'/x');
  const sorted=formatJson('{"z":0,"a":{"z":1,"a":2},"list":[3,2,1]}',{sortKeys:true,indent:0});
  assert.equal(sorted,'{"a":{"a":2,"z":1},"list":[3,2,1],"z":0}');
});
test('strict parser rejects malformed JSON and reports stable source coordinates',()=>{
  for(const text of ['', ' ', '{a:1}', '{"x":1,}', '[1,]', '[,1]', '01', '-01', '1.', '1e', '1e+', '+1', 'NaN', 'Infinity', 'undefined', '{}{}','true false','/*x*/{}','{"x":undefined}','"bad\\x"','"bad\\u00Q0"','"bad\nline"','{"x" 1}','[1 2]','[1','{"x":','"abc','\ufeff{}']){
    assert.throws(()=>parseDocument(text),JsonHarborError,text);
  }
  try{parseDocument('{\n  "x": 1,\n}');assert.fail('Expected error');}catch(e){assert.equal(e.line,3);assert.equal(e.column,1);assert.equal(e.offset,12);}
});
test('JSON Pointer preserves empty, escaped, numeric and prototype-shaped keys',()=>{
  const text='{"":1,"a/b":{"~x":[9223372036854775807]},"__proto__":{"polluted":true},"constructor":2}';
  assert.equal(extractJson(text,'/a~1b/~0x/0'),'9223372036854775807');
  assert.equal(extractJson(text,'/'),'1');assert.equal(extractJson(text,'/__proto__/polluted'),'true');assert.equal({}.polluted,undefined);
  assert.equal(minifyJson(extractJson(text,'')),text);
  for(const pointer of ['a','/~2','/missing','/a~1b/~0x/01','/a~1b/~0x/-','/a~1b/~0x/999999999999999999999'])assert.throws(()=>extractJson(text,pointer));
  assert.throws(()=>extractJson('{"x":1,"x":2}','/x'),/重复键/);
});
test('structural diff ignores object order and string escape spelling, retains exact numbers',()=>{
  assert.equal(diffJson('{"a":1,"b":"\\u0061"}','{"b":"a","a":1}').equal,true);
  const result=diffJson('{"id":9223372036854775807,"price":1,"gone":true,"a":[1,2]}','{"id":9223372036854775808,"price":1.0,"new":null,"a":[1]}');
  assert.equal(result.changes.length,5);
  assert.equal(result.changes.find(c=>c.pointer==='/id').after,'9223372036854775808');
  assert(result.changes.some(c=>c.type==='removed'&&c.pointer==='/a/1'));
  assert.equal(diffJson('null','{}').changes[0].pointer,'');
  assert.throws(()=>diffJson('{"x":1,"x":2}','{}'),/重复键/);
  assert.equal(diffJson('[1,2,3]','[4,5,6]',{limit:2}).truncated,true);
});
test('size, nesting and node limits fail clearly rather than causing a stack overflow',()=>{
  assert.throws(()=>parseDocument(' '.repeat(MAX_BYTES+1)),e=>e.code==='LIMIT');
  assert.throws(()=>parseDocument('['.repeat(130)+'0'+']'.repeat(130)),e=>e.code==='LIMIT');
  assert.throws(()=>parseDocument('['+Array(50001).fill('0').join(',')+']'),e=>e.code==='LIMIT');
  assert.throws(()=>formatJson('{}',{indent:3}),/缩进/);
});
test('formatter agrees with native JSON semantics across deterministic generated valid values',()=>{
  let seed=42;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  function value(depth){if(depth>3)return Math.floor(random()*10000);switch(Math.floor(random()*6)){
    case 0:return null;case 1:return random()>.5;case 2:return '引号"换行\n反斜线\\'+Math.floor(random()*1000);case 3:return Math.floor(random()*100000)-50000;case 4:return Array.from({length:Math.floor(random()*5)},()=>value(depth+1));default:return Object.fromEntries(Array.from({length:Math.floor(random()*5)},(_,i)=>['key/~'+i,value(depth+1)]));}}
  for(let i=0;i<150;i++){const data=value(0),text=JSON.stringify(data);assert.deepEqual(JSON.parse(formatJson(text,{indent:i%2?2:'tab',sortKeys:true})),data);assert.deepEqual(JSON.parse(minifyJson(text)),data);}
});
