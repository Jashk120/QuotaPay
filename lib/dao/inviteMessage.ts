/**
 * Shared by the API and the member's browser. The member signs exactly this
 * string; the signature is hashed into the secret that produces the Poseidon
 * commitment. Keep the format stable.
 */
export function inviteMessage(dao: string, code: string): string {
  return `QuotaPay membership:\ndao:${dao.toLowerCase()}\ncode:${code}`;
}
