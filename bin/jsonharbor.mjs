#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {formatJson,minifyJson,parseDocument,extractJson,diffJson,MAX_BYTES,VERSION} from '../dist/engine.mjs';
const help=`JSON Harbor — local, lossless JSON utilities

Usage:
  jsonharbor format [input.json|-] [--indent 2|4|tab] [--sort] [-o output.json]
  jsonharbor minify [input.json|-] [-o output.json]
  jsonharbor validate [input.json|-]
  jsonharbor get input.json '/projects/0/name' [-o output.json]
  jsonharbor diff before.json after.json [--json]

  --force       Allow replacing an existing output; never the input or its links
  -h, --help    Show help
  -v, --version Show version

Duplicate keys are preserved during formatting and warned about. Ambiguous paths
and object comparisons are rejected. Numbers retain their exact input lexemes.
Diff ignores object key order; arrays compare by index; numbers compare literally.
Diff exit codes: 0 equal, 1 different, 2 error. Other commands: 0 success, 2 error.
Input limit: 2 MiB, 128 nested levels, 50000 nodes. No uploads or API key.
`;
async function read(input='-') {
  const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Error('输入必须是有效的 UTF-8 编码');}};
  if (input!=='-') {if((await stat(input)).size>MAX_BYTES)throw new Error('输入超过 2 MiB');return decode(await readFile(input));}
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>MAX_BYTES)throw new Error('输入超过 2 MiB');chunks.push(chunk);}
  return decode(Buffer.concat(chunks));
}
async function output(text,file,force,inputs) {
  if(!file){process.stdout.write(text+'\n');return;}
  let target;
  try{target=await stat(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const input of inputs.filter(p=>p&&p!=='-')){
    if(path.resolve(input)===path.resolve(file))throw new Error('输入和输出必须是不同文件');
    const source=await stat(input);
    if(target&&target.ino===source.ino&&target.dev===source.dev)throw new Error('输出不能是指向输入文件的链接');
  }
  await writeFile(file,text+'\n',{flag:force?'w':'wx'});
}
try {
  const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{indent:{type:'string',default:'2'},sort:{type:'boolean'},out:{type:'string',short:'o'},force:{type:'boolean'},json:{type:'boolean'},help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'}}});
  if(v.help){console.log(help);}
  else if(v.version){console.log(VERSION);}
  else {
    const [command,...args]=p;
    if(!['format','minify','validate','get','diff'].includes(command))throw new Error('请选择 format / minify / validate / get / diff；用 --help 查看示例');
    const expected=['get','diff'].includes(command)?2:1;
    if(args.length>expected||(['get','diff'].includes(command)&&args.length!==expected))throw new Error('参数数量不正确，请查看 --help');
    const input=args[0]??'-',text=await read(input);
    const indent=v.indent==='tab'?'tab':Number(v.indent);let result;
    if(command==='format')result=formatJson(text,{indent,sortKeys:!!v.sort});
    if(command==='minify')result=minifyJson(text);
    if(command==='get')result=extractJson(text,args[1],{indent});
    if(command==='validate'){
      const doc=parseDocument(text);result=JSON.stringify({valid:true,stats:doc.stats,warnings:doc.warnings},null,2);
    }
    if(command==='diff'){
      const diff=diffJson(text,await read(args[1]));
      result=v.json?JSON.stringify(diff,null,2):diff.equal?'No differences':diff.changes.map(c=>`${c.type.toUpperCase()} ${c.pointer||'(root)'}\n  - ${c.before??'(absent)'}\n  + ${c.after??'(absent)'}`).join('\n')+(diff.truncated?'\nShowing the first 500 differences.':'');
      process.exitCode=diff.equal?0:1;
    }
    await output(result,v.out,v.force,command==='diff'?args:[input]);
    if(['format','minify','get'].includes(command)){
      const doc=parseDocument(text);if(doc.stats.duplicates)console.error(`注意：原文包含 ${doc.stats.duplicates} 处重复键，格式化仍保留这些成员。`);
    }
  }
} catch(error) {console.error(`jsonharbor: ${error.message}${error.line?` (line ${error.line}, column ${error.column})`:''}`);process.exitCode=2;}
