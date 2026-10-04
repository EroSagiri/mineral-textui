export type ControlType = 'input' | 'number' | 'check' | 'select' | 'action' | 'output';
export type ControlValue = string | boolean;
export class ProtocolError extends Error {}
export interface ProtocolOptions {allowEscapedNewlines?: boolean; allowEmptySelection?: boolean}

export interface FieldConstraints { disabled?: boolean; readOnly?: boolean; required?: boolean; min?: number; max?: number; step?: number }
export interface ParsedControl extends FieldConstraints {
  id: string;
  explicitId?: string;
  type: ControlType;
  label: string;
  group?: string;
  value: ControlValue;
  start: number;
  end: number;
  fullStart: number;
  fullEnd: number;
}
export interface ParsedBlock extends FieldConstraints {
  id: string; explicitId?: string; type: string; lang: string; value: string;
  start: number; end: number; fullStart: number; fullEnd: number;
  /** Raw source surrounding the body, including the original fence and newline style. */
  opening: string; closing: string; fence: string; prefix: string;
}
export interface ParsedScreen { text: string; controls: Map<string, ParsedControl>; blocks: Map<string, ParsedBlock> }
export function identity(type: string, label: string, group?: string): string {
  return `@${JSON.stringify([type, group ?? '', label])}`;
}
export function singleLine(value: string): string {
  if (/[\r\n]|<!--|-->/.test(value)) throw new Error('控件值与标签必须是单行，且不能包含 HTML 注释。');
  return value;
}
export function encodeInput(value: string, options: ProtocolOptions = {}): string {
  if (!options.allowEscapedNewlines) singleLine(value);
  if (/<!--|-->/.test(value)) throw new ProtocolError('Input 不能包含协议注释。');
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\n/g,'\\n').replace(/\r/g,'\\r');
}
