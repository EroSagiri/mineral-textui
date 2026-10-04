import { dirname, basename } from 'node:path';
import { createNodeHost } from '@mineral/textui-host-node';
import { startApplication } from '@mineral/textui';
import type { Application } from '@mineral/textui';

export interface RunningFileApplication {
  filePath: string;
  close(): Promise<void>;
}

/** CLI composition chooses a file Host; the library runtime receives only a port. */
export async function launchFileApplication(
  application: Application,
  filePath: string,
  onError: (error: Error) => void,
): Promise<RunningFileApplication> {
  const host = createNodeHost(dirname(filePath), {
    onError: error => onError(error instanceof Error ? error : new Error(String(error))),
  });
  try {
    const app = await startApplication(application, {
      host,
      screen: basename(filePath, '.md'),
      onError,
    });
    return {
      filePath,
      async close() {
        try {
          await app.close();
        } finally {
          await host.close();
        }
      },
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}
