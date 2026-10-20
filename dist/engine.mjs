export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_DEPTH = 128;
export const MAX_NODES = 50000;
export const VERSION = '1.0.0';
const encoder = new TextEncoder();
export const byteLength = text => encoder.encode(text).byteLength;
export const escapePointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

export class JsonHarborError extends Error {
  constructor(message, text = '', offset = 0, code = 'SYNTAX') {
    super(message); this.name = 'JsonHarborError'; this.code = code;
    this.offset = offset;
    const before = text.slice(0, offset).split('\n');
    this.line = before.length; this.column = before.at(-1).length + 1;
  }
}

/** Strict JSON parser. Numeric and string lexemes stay intact in the AST. */
export function parseDocument(text) {
  if (typeof text !== 'string') throw new TypeError('JSON 输入必须是字符串');
  if (byteLength(text) > MAX_BYTES) throw new JsonHarborError('输入超过 2 MiB，请拆分后处理', text, 0, 'LIMIT');
  let i = 0, count = 0, maxDepth = 0;
  const fail = (message, at = i, code = 'SYNTAX') => { throw new JsonHarborError(message, text, at, code); };
  const skip = () => { while (i < text.length && /[ \t\r\n]/.test(text[i])) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      const char = text.charCodeAt(i++);
      if (char === 34) { const raw = text.slice(start, i); return {raw, value: JSON.parse(raw), start}; }
      if (char < 32) fail('字符串中不能直接出现换行或控制字符', i - 1);
      if (char === 92) {
        if (i >= text.length) fail('字符串中的转义不完整');
        const escape = text[i++];
        if (escape === 'u') {
          for (let n = 0; n < 4; n++, i++) if (!/[0-9a-fA-F]/.test(text[i] ?? '')) fail('Unicode 转义需要 4 位十六进制数字');
        } else if (!'"\\/bfnrt'.includes(escape)) fail('无效的字符串转义', i - 1);
      }
    }
    fail('字符串缺少结束双引号', start);
  }
  function value(depth) {
    skip();
    if (depth > MAX_DEPTH) fail('嵌套超过 128 层，请拆分后处理', i, 'LIMIT');
    if (++count > MAX_NODES) fail('节点超过 50000 个，请拆分后处理', i, 'LIMIT');
    maxDepth = Math.max(maxDepth, depth);
    const start = i, id = count, char = text[i];
    let node;
    if (char === '{') {
      i++; skip(); const children = [];
      if (text[i] !== '}') {
        while (true) {
          if (text[i] !== '"') fail('对象键名必须使用双引号');
          const key = string(); skip();
          if (text[i] !== ':') fail('键名后缺少冒号');
          i++; children.push({key: key.value, keyRaw: key.raw, keyStart: key.start, node: value(depth + 1)}); skip();
          if (text[i] === '}') break;
          if (text[i] !== ',') fail('对象成员之间需要逗号，或使用 } 结束对象');
          i++; skip(); if (text[i] === '}') fail('JSON 不允许尾随逗号');
        }
      }
      if (text[i] !== '}') fail('对象缺少结束符 }');
      i++; node = {id, type: 'object', start, end: i, children};
    } else if (char === '[') {
      i++; skip(); const children = [];
      if (text[i] !== ']') {
        while (true) {
          children.push(value(depth + 1)); skip();
          if (text[i] === ']') break;
          if (text[i] !== ',') fail('数组元素之间需要逗号，或使用 ] 结束数组');
          i++; skip(); if (text[i] === ']') fail('JSON 不允许尾随逗号');
        }
      }
      if (text[i] !== ']') fail('数组缺少结束符 ]');
      i++; node = {id, type: 'array', start, end: i, children};
    } else if (char === '"') {
      const token = string(); node = {id, type: 'string', start, end: i, raw: token.raw, value: token.value};
    } else if (char === '-' || /[0-9]/.test(char ?? '')) {
      const raw = text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)?.[0];
      if (!raw) fail('无效的 JSON 数字');
      i += raw.length;
      if (i < text.length && !/[ \t\r\n,\]}]/.test(text[i])) fail('无效的 JSON 数字，请检查前导零、小数或指数');
      node = {id, type: 'number', start, end: i, raw};
    } else {
      const literal = ['true', 'false', 'null'].find(word => text.startsWith(word, i));
      if (!literal) fail(i >= text.length ? 'JSON 内容不完整，缺少值' : '此处需要 JSON 值；字符串和键名请使用双引号');
      i += literal.length; node = {id, type: literal === 'null' ? 'null' : 'boolean', start, end: i, raw: literal};
    }
    return node;
  }
  skip(); if (i === text.length) fail('请先输入 JSON', i, 'EMPTY');
  const root = value(0); skip(); if (i < text.length) fail('根值后还有多余内容');
  const warnings = [], stats = {nodes: count, depth: maxDepth, keys: 0, objects: 0, arrays: 0, numbers: 0, strings: 0, bigNumbers: 0, duplicates: 0, bytes: byteLength(text)};
  walk(root, (node, pointer) => {
    if (node.type === 'object') {
      stats.objects++; const seen = new Set(); stats.keys += node.children.length;
      for (const entry of node.children) {
        if (seen.has(entry.key)) {
          stats.duplicates++;
          if (warnings.length < 100) warnings.push({code: 'DUPLICATE_KEY', message: `重复键 ${JSON.stringify(entry.key)}；格式化会保留，但路径提取或对比可能有歧义`, offset: entry.keyStart, pointer: pointer + '/' + escapePointer(entry.key)});
        }
        seen.add(entry.key);
      }
    } else if (node.type === 'array') stats.arrays++;
    else if (node.type === 'number') {
      stats.numbers++;
      if (!Number.isFinite(Number(node.raw)) || (/^-?[0-9]+$/.test(node.raw) && !Number.isSafeInteger(Number(node.raw)))) stats.bigNumbers++;
    } else if (node.type === 'string') stats.strings++;
  });
  return {root, stats, warnings};
}

export function walk(node, visit, pointer = '') {
  visit(node, pointer);
  if (node.type === 'object') for (const entry of node.children) walk(entry.node, visit, pointer + '/' + escapePointer(entry.key));
  if (node.type === 'array') node.children.forEach((child, i) => walk(child, visit, pointer + '/' + i));
}

export function formatNode(root, {indent = 2, sortKeys = false, compact = false} = {}) {
  if (![0, 2, 4, 'tab'].includes(indent)) throw new TypeError('缩进只能是 0、2、4 或 tab');
  const unit = compact || indent === 0 ? '' : indent === 'tab' ? '\t' : ' '.repeat(indent), chunks = [];
  function write(node, depth) {
    if (node.type !== 'object' && node.type !== 'array') { chunks.push(node.raw); return; }
    const object = node.type === 'object', entries = object && sortKeys ? [...node.children].sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : node.children;
    chunks.push(object ? '{' : '[');
    entries.forEach((entry, index) => {
      if (index) chunks.push(','); if (unit) chunks.push('\n', unit.repeat(depth + 1));
      if (object) chunks.push(entry.keyRaw, unit ? ': ' : ':');
      write(object ? entry.node : entry, depth + 1);
    });
    if (unit && entries.length) chunks.push('\n', unit.repeat(depth));
    chunks.push(object ? '}' : ']');
  }
  write(root, 0); const result = chunks.join('');
  if (byteLength(result) > MAX_BYTES) throw new JsonHarborError('格式化结果超过 2 MiB，请减小缩进或改用压缩', '', 0, 'LIMIT');
  return result;
}
export const formatJson = (text, options) => formatNode(parseDocument(text).root, options);
export const minifyJson = text => formatJson(text, {compact: true});

export function nodeAtPointer(document, pointer) {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) throw new JsonHarborError('请输入 JSON Pointer，例如 /projects/0/name；空路径表示根值', '', 0, 'POINTER');
  let node = document.root;
  for (const encoded of pointer === '' ? [] : pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(encoded)) throw new JsonHarborError('路径转义只能使用 ~0 和 ~1', '', 0, 'POINTER');
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node.type === 'object') {
      const matches = node.children.filter(entry => entry.key === key);
      if (matches.length > 1) throw new JsonHarborError(`路径中的重复键 ${JSON.stringify(key)} 有歧义，请先处理重复键`, '', 0, 'AMBIGUOUS');
      node = matches[0]?.node;
    } else if (node.type === 'array' && /^(0|[1-9][0-9]*)$/.test(key) && Number.isSafeInteger(Number(key))) node = node.children[Number(key)];
    else node = undefined;
    if (!node) throw new JsonHarborError('没有找到这个路径，请检查键名和数组下标', '', 0, 'NOT_FOUND');
  }
  return node;
}
export const extractJson = (text, pointer, options) => formatNode(nodeAtPointer(parseDocument(text), pointer), options);

export function diffJson(before, after, {limit = 500} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('差异数量限制必须为 1–5000');
  const a = parseDocument(before), b = parseDocument(after);
  if (a.stats.duplicates || b.stats.duplicates) throw new JsonHarborError('对比包含重复键的对象有歧义，请先处理重复键；原文不会被修改', '', 0, 'AMBIGUOUS');
  const changes = []; let truncated = false;
  function add(type, pointer, oldNode, newNode) {
    if (changes.length === limit) { truncated = true; return; }
    changes.push({type, pointer, before: oldNode ? formatNode(oldNode, {compact: true}) : undefined, after: newNode ? formatNode(newNode, {compact: true}) : undefined});
  }
  function compare(x,y,pointer) {
    if (truncated) return;
    if (!x) return add('added', pointer, undefined, y);
    if (!y) return add('removed', pointer, x, undefined);
    if (x.type !== y.type) return add('changed', pointer, x, y);
    if (x.type === 'object') {
      const left = new Map(x.children.map(e => [e.key,e.node])), right = new Map(y.children.map(e => [e.key,e.node]));
      for (const key of new Set([...left.keys(), ...right.keys()])) compare(left.get(key),right.get(key),pointer+'/'+escapePointer(key));
    } else if (x.type === 'array') {
      for (let i=0;i<Math.max(x.children.length,y.children.length);i++) compare(x.children[i],y.children[i],pointer+'/'+i);
    } else if (x.type === 'string' ? x.value !== y.value : x.raw !== y.raw) add('changed',pointer,x,y);
  }
  compare(a.root,b.root,'');
  return {equal: changes.length === 0, changes, truncated};
}
