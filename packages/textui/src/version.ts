const epochLine=/^<!-- textui:epoch=(\d+) -->\r?$/m;
export function epochOf(text: string): number {return Number(epochLine.exec(text)?.[1] ?? 0);}
/** Protocol acknowledgement changes the document even when an Action has no business output. */
export function stampText(text: string, before: string): string {
  if (text===before) return text;
  const newline=text.includes('\r\n')?'\r\n':'\n';
  const marker=`<!-- textui:epoch=${Math.max(epochOf(text),epochOf(before))+1} -->`;
  return epochLine.test(text) ? text.replace(epochLine,marker+(newline==='\r\n'?'\r':''))
    : text+(text.endsWith('\n')?newline:newline+newline)+marker+newline;
}
