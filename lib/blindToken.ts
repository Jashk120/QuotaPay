import { encodeAbiParameters, keccak256, type Hex } from "viem";

/**
 * DEV-ONLY issuer key. Never use this on a network holding real value.
 *
 * The company backend is the real issuer: it holds `d`, signs only blinded
 * messages, and never sees the token payload or the session key. For the demo
 * the key lives here so the browser can exercise the full blind flow.
 *
 * `n` is 1536-bit and `e` = 65537. That keeps modexp verification inside the
 * stock 100k validation prefix. Production should use a 2048-bit key (or
 * RSA-FDH/PSS) on an alt-mempool with the 1M staked budget.
 */
const N = BigInt(
  "0xcecb571bd14233fdb9e0f05aebd28f39c10490648123ceada6a4ee2cec28d947a36af51de98adfd75415a32449303c24e5884670de1a7f2ef06fa00f830b1f261b81556cddecbffa55faae427af7a5d429ad3e134d68ded9ffd2b574da5e59dc5bd639e1c6f58c2b1c251d2d02c831913eefc3527ab1505809e704f274a830d223e9dba5b46f0e3c9fc32ad301a0dbce90308e645db6b10dabce052223bfb13d6d53b26841d21a034229e42bfd6c0e03d77a094e6c34bdfbbc1f63bd5bb72147",
);
const D = BigInt(
  "0xc8c6e8665bbfd956c9783a252cbd9ccdc837b431c0a8916c4c55e9e1b7d0d95512b73011c0c4531c6fc92a427ac4d84042931341568387647d910368cc24aa33879504e9d4769ed66150288ce77336904d7ea4bc7cf60b18c1a745029559f2079fa532a810007b3eacec8577b6c48983c7084fc61850de514e8dee2abea9af88156ccbf31cf9203babf94326bac44854c6e635bf1699d8479298d62dddb1b71b76fe6dcda6d3c230fa7f5c713b2154387eeb8ffa16945baae5a3cbb803cc7671",
);

export const MODULUS_BYTES = 192;

export function bigIntToBytes(value: bigint, lengthBytes: number): Hex {
  const hex = value.toString(16);
  if (hex.length > lengthBytes * 2) throw new Error("integer too large");
  return `0x${hex.padStart(lengthBytes * 2, "0")}` as Hex;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(`0x${hex}`);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export const DEV_ISSUER = {
  n: N,
  e: 0x10001n,
  d: D,
  modulus: bigIntToBytes(N, MODULUS_BYTES),
  exponent: "0x010001" as Hex,
};

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let oldR = ((a % m) + m) % m;
  let r = m;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("value is not invertible");
  return ((oldS % m) + m) % m;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function randomCoprime(n: bigint): bigint {
  while (true) {
    const r = bytesToBigInt(randomBytes(32)) % n;
    if (r > 1n && gcd(r, n) === 1n) return r;
  }
}

export type TokenFields = {
  sessionKey: `0x${string}`;
  paymaster: `0x${string}`;
  chainId: number | bigint;
  epoch: number | bigint;
  maxCost: bigint;
  serial: Hex;
};

export type BlindToken = TokenFields & {
  signature: Hex;
};

/** Must match `BlindTokenPaymaster._verifyToken`'s abi.encode order/types. */
export function hashToken(fields: TokenFields): bigint {
  const encoded = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      fields.sessionKey,
      fields.paymaster,
      BigInt(fields.chainId),
      BigInt(fields.epoch),
      fields.maxCost,
      fields.serial,
    ],
  );
  return BigInt(keccak256(encoded));
}

export function randomSerial(): Hex {
  return bigIntToBytes(bytesToBigInt(randomBytes(32)), 32);
}

export function buildBlindRequest(fields: TokenFields) {
  const message = hashToken(fields);
  const r = randomCoprime(DEV_ISSUER.n);
  const blinded = (message * modPow(r, DEV_ISSUER.e, DEV_ISSUER.n)) % DEV_ISSUER.n;
  return { message, blinded, blindFactor: r };
}

/** Issuer side: sign the blinded message. */
export function signBlinded(blinded: bigint): bigint {
  return modPow(blinded, DEV_ISSUER.d, DEV_ISSUER.n);
}

/** User side: remove the blinding factor. */
export function finalizeToken(
  fields: TokenFields,
  signedBlinded: bigint,
  blindFactor: bigint,
): BlindToken {
  const signature =
    (signedBlinded * modInverse(blindFactor, DEV_ISSUER.n)) % DEV_ISSUER.n;
  return { ...fields, signature: bigIntToBytes(signature, MODULUS_BYTES) };
}

export function verifyTokenOffline(token: BlindToken): boolean {
  const message = hashToken(token);
  return modPow(BigInt(token.signature), DEV_ISSUER.e, DEV_ISSUER.n) === message;
}

/** One-shot demo helper: the full blind flow in a single process. */
export function issueToken(fields: TokenFields): BlindToken {
  const { blinded, blindFactor } = buildBlindRequest(fields);
  const signedBlinded = signBlinded(blinded);
  return finalizeToken(fields, signedBlinded, blindFactor);
}
