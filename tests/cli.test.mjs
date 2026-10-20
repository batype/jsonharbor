import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/jsonharbor.mjs',import.meta.url));
function run(args,input=''){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args]);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
test('CLI formats stdin without rounding numbers and validates syntax',async()=>{
  const result=await run(['format','-'],'{"id":9223372036854775807}');assert.equal(result.code,0);assert.match(result.stdout,/9223372036854775807/);
  const bad=await run(['validate','-'],'{"x":}');assert.equal(bad.code,2);assert.match(bad.stderr,/line 1/);
  assert.equal((await run(['--version'])).stdout.trim(),'1.0.0');
});
test('CLI get/diff are executable and output protects input and existing files',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'jsonharbor-test-'));
  try{
    const a=path.join(dir,'a.json'),b=path.join(dir,'b.json'),out=path.join(dir,'out.json'),alias=path.join(dir,'alias.json');
    await writeFile(a,'{"id":9223372036854775807}');await writeFile(b,'{"id":9223372036854775808}');
    assert.equal((await run(['get',a,'/id'])).stdout.trim(),'9223372036854775807');
    const difference=await run(['diff',a,b,'--json']);assert.equal(difference.code,1);assert.equal(JSON.parse(difference.stdout).changes[0].after,'9223372036854775808');
    assert.equal((await run(['diff',a,a])).code,0);
    assert.equal((await run(['format',a,'--out',out])).code,0);
    assert.equal((await run(['minify',a,'--out',out])).code,2);
    assert.equal((await run(['format',a,'--out',a,'--force'])).code,2);
    await link(a,alias);assert.equal((await run(['format',a,'--out',alias,'--force'])).code,2);
    const invalid=path.join(dir,'invalid.json');await writeFile(invalid,Buffer.from([34,0xff,34]));assert.match((await run(['validate',invalid])).stderr,/UTF-8/);
    assert.equal(await readFile(a,'utf8'),'{"id":9223372036854775807}');
  }finally{await rm(dir,{recursive:true,force:true});}
});
