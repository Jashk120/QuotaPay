/**
 * Shared challenge for `/api/dao/execute`.
 *
 * The route moves treasury funds through the agent, so it must not be callable
 * by an arbitrary client. The admin wallet signs this message over the exact
 * calldata; the route verifies it against `DaoCore.admin()` before submitting.
 */
export const EXECUTE_NONCE_WINDOW_MS = 5 * 60_000;

export function executeMessage(to: string, data: string, nonce: string): string {
  return `QuotaPay DAO execute:\nto:${to}\ndata:${data}\nnonce:${nonce}`;
}
