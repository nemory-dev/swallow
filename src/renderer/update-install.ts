/** A rejected save must leave the app running with its draft still on screen. */
export async function saveAndInstallUpdate(busy: () => boolean, saves: (() => Promise<void>)[], install: () => Promise<void>): Promise<void> {
  if (busy()) throw new Error('진행 중인 작업을 마친 뒤 업데이트해 주세요.');
  for (const save of saves) await save();
  if (busy()) throw new Error('진행 중인 작업을 마친 뒤 업데이트해 주세요.');
  await install();
}
