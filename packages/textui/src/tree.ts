export interface TextNode {kind:'text'; value:string; hidden?:boolean}
export interface ElementNode {kind:'element'; type:string; props:Record<string,unknown>; children:HostNode[]; hidden?:boolean}
export type HostNode = TextNode | ElementNode;
