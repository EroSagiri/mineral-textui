import type { Application } from '@mineral/textui';
import { requireControls } from '@mineral/textui';
import type { ParsedScreen as Document } from '@mineral/textui';

function countOf(document: Document): number {
  const text = document.controls.get('count')?.value;
  if (typeof text !== 'string' || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error('Count 必须是非负安全整数。');
  return Number(text);
}

export const counter: Application = {
  name: '计数器',
  // Preserve user-added controls with the text-only protocol options.
  protocol: { allowEscapedNewlines: true, allowEmptySelection: true },
  initialContent: `# Counter

Count: 0 <!-- textui:id=count type=output -->

- [ ] Increment <!-- textui:id=increment type=action -->
- [ ] Reset <!-- textui:id=reset type=action -->

勾选操作并保存，执行后自动取消勾选。这里可以添加自己的备注。
`,
  validate(document) {
    requireControls(document, { count: 'output', increment: 'action', reset: 'action' });
    countOf(document);
  },
  handle(events, document) {
    counter.validate(document);
    let value = countOf(document);
    for (const event of events) {
      if (event.type !== 'trigger') continue;
      if (event.target === 'increment') value++;
      if (event.target === 'reset') value = 0;
    }
    if (!Number.isSafeInteger(value)) throw new Error('计数超出安全整数范围。');
    return { count: String(value) };
  },
};
