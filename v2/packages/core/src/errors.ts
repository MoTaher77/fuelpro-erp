/** One error type for every rule the core refuses. `status` follows HTTP so the server can pass it through;
    the desktop and phone editions show `code` + `message` the same way. */
export class AppError extends Error {
  status: number; code: string; extra?: Record<string, unknown>;
  constructor(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
    super(message || code); this.status = status; this.code = code; this.extra = extra;
  }
}
export const bad = (code: string, msg?: string, extra?: Record<string, unknown>) => new AppError(400, code, msg, extra);
export const conflict = (code: string, msg?: string, extra?: Record<string, unknown>) => new AppError(409, code, msg, extra);
export const notFound = (what?: string) => new AppError(404, 'NOT_FOUND', `${what || 'Resource'} not found`);
export const forbidden = (msg?: string) => new AppError(403, 'FORBIDDEN', msg || 'You do not have permission for this action');
export const unprocessable = (code: string, msg?: string) => new AppError(422, code, msg);
