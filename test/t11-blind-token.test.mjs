// T11 — session-bound blind tokens (BlindTokenPaymaster).
//
// Proves the blind RSA flow end to end on a vanilla EVM: the issuer signs a
// blinded payload, the user unblinds it, and the paymaster verifies the
// signature over the session-bound token fields. The frame-context paths
// (charge/fallback, nullifier burn, session binding) need ethrex + 0xaa and
// are covered by the devnet smoke test.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert } from "./helpers/chain.mjs";
import {
  DEV_ISSUER,
  buildBlindRequest,
  finalizeToken,
  randomSerial,
  signBlinded,
  verifyTokenOffline,
} from "../lib/blindToken.ts";

test("T11 session-bound blind tokens", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, user, other] = chain.signers;

  const registry = await deploy(artifacts, "MockRegistry", admin);
  const pm = await deploy(
    artifacts,
    "BlindTokenPaymaster",
    admin,
    [
      await admin.getAddress(),
      await registry.getAddress(),
      100n,
      DEV_ISSUER.modulus,
      DEV_ISSUER.exponent,
    ],
    ethers.parseEther("5"),
  );
  const pmAddress = await pm.getAddress();

  const fields = {
    sessionKey: await user.getAddress(),
    paymaster: pmAddress,
    chainId: 1337,
    epoch: 0n,
    maxCost: 100n,
    serial: randomSerial(),
  };

  // Full blind flow: blind -> issuer signs -> user unblinds.
  const { blinded, blindFactor } = buildBlindRequest(fields);
  const signedBlinded = signBlinded(blinded);
  const token = finalizeToken(fields, signedBlinded, blindFactor);

  await t.test("off-chain blind signature verifies", () => {
    assert.equal(verifyTokenOffline(token), true, "blind RSA round-trip");
  });

  await t.test("contract verifies the blind token", async () => {
    assert.equal(await pm.verifyToken(token), true);
    const gas = await pm.verifyToken.estimateGas(token);
    console.log(`      verifyToken gas: ${gas.toString()}`);
    assert.ok(gas < 80_000n, `verification too expensive: ${gas}`);
  });

  await t.test("tampered fields/signature are rejected", async () => {
    assert.equal(await pm.verifyToken({ ...token, maxCost: 101n }), false);
    assert.equal(
      await pm.verifyToken({ ...token, sessionKey: await other.getAddress() }),
      false,
    );
    assert.equal(
      await pm.verifyToken({ ...token, signature: "0x" + "00".repeat(192) }),
      false,
    );
  });

  await t.test("charge is entrypoint-gated", async () => {
    await expectRevert(
      () => pm.connect(user).charge.staticCall(token),
      "not entrypoint",
    );
  });

  await t.test("admin gates", async () => {
    await expectRevert(
      () => pm.connect(other).setEpoch.staticCall(1n),
      "not admin",
    );
    await expectRevert(
      () => pm.connect(admin).setMaxSponsorCost.staticCall(0n),
      "maxCost=0",
    );
    await expectRevert(
      () => pm.connect(admin).setIssuer.staticCall("0x1234", "0x01"),
      "modulus short",
    );
  });

  await t.test("deposit / delayed withdrawal lifecycle", async () => {
    const before = await chain.nativeBalance(pmAddress);
    await (
      await pm.connect(admin).deposit({ value: ethers.parseEther("1") })
    ).wait();
    assert.equal(
      await chain.nativeBalance(pmAddress),
      before + ethers.parseEther("1"),
    );

    await (
      await pm.connect(admin).requestWithdrawal(ethers.parseEther("0.5"))
    ).wait();
    await (await pm.connect(admin).executeWithdrawal()).wait();
    assert.equal(
      await chain.nativeBalance(pmAddress),
      before + ethers.parseEther("0.5"),
    );
  });
});
