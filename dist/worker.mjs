import {parseDocument,formatNode,formatJson,minifyJson,extractJson,diffJson,walk} from './engine.mjs';
let cachedText='',cachedDocument=null;
const documentFor=text=>{if(!cachedDocument||cachedText!==text){cachedDocument=parseDocument(text);cachedText=text;}return cachedDocument;};
self.onmessage=({data})=>{
  const {id,action,text,options={}}=data;
  try{
    let result;
    if(action==='analyze')result=documentFor(text);
    else if(action==='format')result=formatJson(text,options);
    else if(action==='minify')result=minifyJson(text);
    else if(action==='get')result=extractJson(text,options.pointer,options);
    else if(action==='diff')result=diffJson(text,options.other);
    else if(action==='search'){
      const doc=documentFor(text),needle=options.query.toLowerCase();const found=[];let total=0;
      walk(doc.root,(node,pointer)=>{
        const value=node.type==='string'?node.value:node.raw??'';
        if(pointer.toLowerCase().includes(needle)||String(value).toLowerCase().includes(needle)){
          total++;if(found.length<200)found.push({id:node.id,pointer,type:node.type,preview:node.raw?.slice(0,100)??`${node.children.length} ${node.type==='array'?'项':'个字段'}`});
        }
      });result={found,total};
    }else throw new Error('未知操作');
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:{message:error.message,offset:error.offset??0,line:error.line??1,column:error.column??1,code:error.code??'ERROR'}});}
};
