import type { Application } from '@mineral/textui';
import { counter } from '../counter/app.ts';
import { form } from '../text-form/app.ts';

export interface AppRegistration {
  id: string;
  application: Application;
}

/** The CLI composes these Core-only applications with a Node file host. */
export const registeredApps: readonly AppRegistration[] = [
  { id: 'counter', application: counter },
  { id: 'form', application: form },
];
