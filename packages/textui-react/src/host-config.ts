import { createContext } from 'react';
import type Reconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants.js';

import type { TextNode, ElementNode, HostNode } from '@mineral/textui';
export interface Container {children: HostNode[]; commit: () => void}
function remove(parent: {children: HostNode[]}, child: HostNode) {
  const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1);
}
function insert(parent: {children: HostNode[]}, child: HostNode, before?: HostNode) {
  remove(parent, child); const index = before ? parent.children.indexOf(before) : parent.children.length;
  parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
}
type Config = Reconciler.HostConfig<string, Record<string, unknown>, Container, ElementNode, TextNode,
  never, never, never, never, HostNode, object, never, ReturnType<typeof setTimeout>, -1, null, null, null, never, never, never>;
let priority = 0;
const context = {};
export const hostConfig: Config = {
  rendererVersion: '0.0.0', rendererPackageName: '@mineral/textui-react', extraDevToolsConfig: null,
  supportsMutation: true, supportsPersistence: false, supportsHydration: false, isPrimaryRenderer: true,
  getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
  createInstance: (type, props) => ({kind: 'element', type, props, children: []}),
  createTextInstance: value => ({kind: 'text', value}), appendInitialChild: insert,
  finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  prepareForCommit: () => null, resetAfterCommit: container => container.commit(), preparePortalMount: () => {},
  appendChild: insert, appendChildToContainer: insert, insertBefore: insert, insertInContainerBefore: insert,
  removeChild: remove, removeChildFromContainer: remove,
  commitUpdate: (node, _type, _before, after) => { node.props = after; },
  commitTextUpdate: (node, _before, after) => { node.value = after; },
  resetTextContent: node => {node.children = [];}, clearContainer: container => {container.children = [];},
  hideInstance: node => {node.hidden = true;}, unhideInstance: node => {node.hidden = false;},
  hideTextInstance: node => {node.hidden = true;}, unhideTextInstance: node => {node.hidden = false;},
  detachDeletedInstance: () => {},
  getInstanceFromNode: () => null, beforeActiveInstanceBlur: () => {}, afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {}, getInstanceFromScope: () => null,
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => {priority = value;},
  resolveUpdatePriority: () => priority || DefaultEventPriority,
  // Reconciler types expose React's internal Context fields; React supplies them at runtime.
  NotPendingTransition: null, HostTransitionContext: createContext(null) as unknown as Config['HostTransitionContext'],
  resetFormInstance: () => {}, requestPostPaintCallback: callback => setTimeout(() => callback(Date.now()), 0),
  shouldAttemptEagerTransition: () => false, trackSchedulerEvent: () => {},
  resolveEventType: () => null, resolveEventTimeStamp: () => Date.now(),
  maySuspendCommit: () => false, maySuspendCommitOnUpdate: () => false, maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true, startSuspendingCommit: () => null, suspendInstance: () => {},
  suspendOnActiveViewTransition: () => {}, waitForCommitToBeReady: () => null, getSuspendedCommitReason: () => null,
  bindToConsole: (_method, args) => () => console.log(...args),
};
