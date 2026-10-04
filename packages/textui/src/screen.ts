export type ScreenId = string;
export type Revision = string;
export type Unsubscribe = () => void;
export interface ScreenSnapshot {id: ScreenId; text: string; revision: Revision}
export interface ScreenChange {before: ScreenSnapshot; after: ScreenSnapshot; origin?: string}
export interface ScreenWriteOptions {expectedRevision: Revision | null; origin?: string}
export interface ScreenPort {
  getScreen(id: ScreenId): Promise<ScreenSnapshot | null>;
  setScreen(id: ScreenId, text: string, options: ScreenWriteOptions): Promise<ScreenSnapshot>;
  onScreenChange(id: ScreenId, listener: (change: ScreenChange) => void): Promise<Unsubscribe>;
}
export class ScreenConflictError extends Error {
  override name = 'ScreenConflictError';
  constructor(readonly id: string, readonly expectedRevision: Revision | null, readonly actualRevision: Revision | null) {
    super(`屏幕 ${id} 版本冲突：预期 ${expectedRevision ?? '不存在'}，实际 ${actualRevision ?? '不存在'}。`);
  }
}
export function assertRevision(id: string, current: ScreenSnapshot | null, options: ScreenWriteOptions): void {
  if (!options || options.expectedRevision === undefined) throw new TypeError('expectedRevision 必填；创建请传 null。');
  if ((current?.revision ?? null) !== options.expectedRevision) throw new ScreenConflictError(id, options.expectedRevision, current?.revision ?? null);
}
/** The empty revision is a notification-only predecessor for a newly created screen. */
export function absentSnapshot(id: string): ScreenSnapshot {return Object.freeze({id, text:'', revision:''});}

export interface ScreenDirectory {listScreens(): Promise<ScreenId[]>}
export interface ScreenLifecycle {deleteScreen(id: ScreenId, expectedRevision: Revision): Promise<void>}
export interface TextPatch {from: number; to: number; insert: string}
export interface ScreenPatch {patchScreen(id: ScreenId, patches: TextPatch[], expectedRevision: Revision): Promise<ScreenSnapshot>}
export interface ScreenFeedEvent {cursor: string; change: ScreenChange}
/** Cursor is independent of revision; each implementing Host defines retention and resumption. */
export interface ScreenChangeFeed {watchScreen(id: ScreenId, options?: {afterCursor?: string}): AsyncIterable<ScreenFeedEvent>}
