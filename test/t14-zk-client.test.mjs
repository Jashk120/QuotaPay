// T14 — browser-side witness/nullifier helper.
//
// The ZK paymaster's session binding depends on the client computing the same
// Poseidon values as the circuit. This test pins that against the committed
// proof's public signals; the full prover is exercised by scripts/zk-proof.mjs
// and T12.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildZkWitness,
  computeZkNullifiers,
  expectedPublicSignals,
  parseZkCredential,
  samePublicSignals,
} from "../lib/zk/client.ts";

const SESSION_KEY = "0x348836a9b164f241945205b5a92f496bb8c3c1d8";

test("T14 client witness matches the committed circuit proof", async (t) => {
  const credential = parseZkCredential(
    JSON.parse(fs.readFileSync("test/fixtures/zk/credential.json", "utf8")),
  );
  const publicSignals = JSON.parse(
    fs.readFileSync("test/fixtures/zk/public.json", "utf8"),
  );

  await t.test("public signals match in order", () => {
    const witness = buildZkWitness(credential, SESSION_KEY);
    assert.equal(
      samePublicSignals(expectedPublicSignals(witness), publicSignals),
      true,
      "client witness must produce the circuit's public signals",
    );
  });

  await t.test("session key changes the binding value, not the identity", () => {
    const a = computeZkNullifiers({
      secret: credential.secret,
      epoch: credential.epoch,
      sessionKey: SESSION_KEY,
    });
    const b = computeZkNullifiers({
      secret: credential.secret,
      epoch: credential.epoch,
      sessionKey: "0x000000000000000000000000000000000000dEaD",
    });
    assert.equal(
      a.identityNullifier.toString(),
      b.identityNullifier.toString(),
      "identity nullifier must depend only on (secret, epoch)",
    );
    assert.notEqual(
      a.sessionNullifier.toString(),
      b.sessionNullifier.toString(),
      "session nullifier must depend on the session key",
    );
  });

  await t.test("credential validation rejects a short path", () => {
    assert.throws(
      () =>
        parseZkCredential({
          ...credential,
          pathElements: ["0"],
        }),
      /pathElements must have 20 entries/,
    );
  });
});
