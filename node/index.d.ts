export type JsonNode = {id:number;type:'number'|'string'|'boolean'|'null';start:number;end:number;raw:string;value?:string} | {id:number;type:'array';start:number;end:number;children:JsonNode[]} | {id:number;type:'object';start:number;end:number;children:{key:string;keyRaw:string;keyStart:number;node:JsonNode}[]};
export interface Document {root:JsonNode;stats:{nodes:number;depth:number;keys:number;objects:number;arrays:number;numbers:number;strings:number;bigNumbers:number;duplicates:number;bytes:number};warnings:{code:string;message:string;offset:number;pointer:string}[]}
export interface FormatOptions {indent?:0|2|4|'tab';sortKeys?:boolean;compact?:boolean}
export interface DiffResult {equal:boolean;changes:{type:'added'|'removed'|'changed';pointer:string;before?:string;after?:string}[];truncated:boolean}
export class JsonHarborError extends Error {code:string;offset:number;line:number;column:number}
export const MAX_BYTES:number,MAX_DEPTH:number,MAX_NODES:number,VERSION:string;
export function byteLength(text:string):number;
export function escapePointer(key:string):string;
export function parseDocument(text:string):Document;
export function walk(node:JsonNode,visit:(node:JsonNode,pointer:string)=>void,pointer?:string):void;
export function formatNode(node:JsonNode,options?:FormatOptions):string;
export function formatJson(text:string,options?:FormatOptions):string;
export function minifyJson(text:string):string;
export function nodeAtPointer(document:Document,pointer:string):JsonNode;
export function extractJson(text:string,pointer:string,options?:FormatOptions):string;
export function diffJson(before:string,after:string,options?:{limit?:number}):DiffResult;
