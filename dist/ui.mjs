export function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
export function highlight(text,element){
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
