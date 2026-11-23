'use strict';
class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (code, msg, extra) => new HttpError(400, code, msg, extra);
const conflict = (code, msg, extra) => new HttpError(409, code, msg, extra);
const notFound = (what) => new HttpError(404, 'NOT_FOUND', `${what || 'Resource'} not found`);
const forbidden = (msg) => new HttpError(403, 'FORBIDDEN', msg || 'You do not have permission for this action');
const unauthorized = (msg) => new HttpError(401, 'UNAUTHENTICATED', msg || 'Sign in required');
module.exports = { HttpError, bad, conflict, notFound, forbidden, unauthorized };
