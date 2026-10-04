import type { Application } from '@mineral/textui';
import { requireControls } from '@mineral/textui';

export const form: Application = {
  name: '交互式表单',
  // This text-only form also permits escaped line breaks and no selected theme.
  protocol: { allowEscapedNewlines: true, allowEmptySelection: true },
  initialContent: `# User

> Name: [June] <!-- textui:id=name type=input -->

- [x] Enable sound <!-- textui:id=sound type=check -->

( ) Light <!-- textui:id=light type=select group=theme -->
(*) Dark <!-- textui:id=dark type=select group=theme -->

## 主表单

- [ ] Submit <!-- textui:id=submit-main type=action -->

## 预览表单

- [ ] Submit <!-- textui:id=submit-preview type=action -->

Main submissions: 0 <!-- textui:id=main-count type=output -->
Preview submissions: 0 <!-- textui:id=preview-count type=output -->
Result: 尚未提交 <!-- textui:id=result type=output -->

编辑字段、勾选操作并保存。两处 Submit 独立工作，提交后自动复位。
`,
  validate(document) {
    requireControls(document, {
      name: 'input', sound: 'check', light: 'select', dark: 'select',
      'submit-main': 'action', 'submit-preview': 'action',
      'main-count': 'output', 'preview-count': 'output', result: 'output',
    });
    if (document.controls.get('light')!.group !== 'theme' || document.controls.get('dark')!.group !== 'theme') throw new Error('主题选项必须属于 theme 分组。');
    for (const id of ['main-count', 'preview-count']) {
      const value = document.controls.get(id)!.value;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${id} 必须是非负安全整数。`);
    }
  },
  handle(events, document) {
    form.validate(document);
    const updates: Record<string, string> = {};
    const selection = events.filter(event => event.type === 'select').find(event => event.group === 'theme' && event.after !== null);
    const theme = selection?.after ?? (document.controls.get('light')!.value ? 'light' : document.controls.get('dark')!.value ? 'dark' : 'none');
    const name = String(document.controls.get('name')!.value).replace(/[\r\n]/g, ' ');
    for (const event of events) {
      if (event.type !== 'trigger' || !['submit-main', 'submit-preview'].includes(event.target)) continue;
      const countId = event.target === 'submit-main' ? 'main-count' : 'preview-count';
      const count = Number(document.controls.get(countId)!.value) + 1;
      if (!Number.isSafeInteger(count)) throw new Error('提交次数超出安全整数范围。');
      updates[countId] = String(count);
      updates.result = `${event.target === 'submit-main' ? '主表单' : '预览表单'}提交成功；Name=${name}；sound=${document.controls.get('sound')!.value ? 'on' : 'off'}；theme=${theme}`;
    }
    return updates;
  },
};
