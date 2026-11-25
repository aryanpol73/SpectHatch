import type { IncomingMessage, ServerResponse } from 'node:http';
export function serveFile(
  root: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  headers?: Record<string, string>,
): Promise<void>;
