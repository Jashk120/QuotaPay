// T03 — Signed-enrollment integrity (CompanyPaymaster.enrollSigned).
//
// Invariant under test: a backend-signed enrollment is single-use, bound
// to THIS paymaster instance, and unforgeable/malleable-proof.
// Probes: (a) happy path, (b) replay of the same (params, sig),
// (c) signature from a non-admin key, (d) cross-instance replay
// (sig minted for paymaster A submitted to B), (e) high-s malleation.
// Why existing coverage misses it: demos use direct admin enroll(); the
// signed path (the sponsor-credential flow) has no negative tests.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

function types() {
  return {
    Enrollment: [
      { name: "beneficiaryId", type: "bytes32" },
      { name: "wallet", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "periodLength", type: "uint32" },
      { name: "perPeriodLimit", type: "uint256" },
      { name: "groupId", type: "bytes32" },
      { name: "nonce", type: "uint256" },
    ],
  };
}
function domain(chainId, verifyingContract) {
  return { name: "QuotaPay", version: "1", chainId, verifyingContract };
}
function malleateHighS(sigHex) {
  const sig = ethers.Signature.from(sigHex);
  const sHigh = SECP_N - BigInt(sig.s); // ethers v6 keeps r/s as hex strings
  assert(sHigh > SECP_N / 2n, "test bug: expected low-s signature to malleate");
  const vFlip = sig.v === 27 ? 28 : 27;
  // Assemble raw r||s||v bytes: ethers.Signature.from() refuses to
  // construct a high-s signature client-side, which is exactly what we
  // want to feed the contract.
  return ethers.concat([sig.r, ethers.toBeHex(sHigh, 32), ethers.toBeHex(vFlip, 1)]);
}

test("T03 signed enrollment: single-use, instance-bound, malleability-proof", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [funder, treasury, w1] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", funder);
  const R = await registry.getAddress();

  // Admin is an off-chain key (the sponsor backend model).
  const backend = ethers.Wallet.createRandom().connect(chain.provider);
  await (await funder.sendTransaction({ to: await backend.getAddress(), value: ethers.parseEther("2") })).wait();

  const mkPaymaster = (treas) => deploy(
    artifacts, "CompanyPaymaster", funder,
    [R, { companyId: id(3), admin: backend.address, treasury: treas,
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  const pmA = await mkPaymaster(await treasury.getAddress());
  const addrA = await pmA.getAddress();
  const W1 = await w1.getAddress();

  const value = (nonce) => ({
    beneficiaryId: id(41), wallet: W1, expiry: 0, periodLength: 0,
    perPeriodLimit: 100n, groupId: id(0), nonce,
  });

  // (a) happy path.
  const sig1 = await backend.signTypedData(domain(chain.chainId, addrA), types(), value(1n));
  await (await pmA.enrollSigned(id(41), W1, 0, 0, 100n, id(0), 1n, sig1)).wait();
  assert.equal(await pmA.isAuthorized(W1), true, "signed enrollment must authorize");

  // (b) replay.
  await expectRevert(
    () => pmA.enrollSigned.staticCall(id(41), W1, 0, 0, 100n, id(0), 1n, sig1),
    "enrollment used"
  );

  // (c) forged signer.
  const impostor = ethers.Wallet.createRandom().connect(chain.provider);
  const badSig = await impostor.signTypedData(domain(chain.chainId, addrA), types(), value(2n));
  await expectRevert(
    () => pmA.enrollSigned.staticCall(id(41), W1, 0, 0, 100n, id(0), 2n, badSig),
    "bad signature"
  );

  // (d) cross-instance replay: same backend key, digest bound to A, sent to B.
  const pmB = await mkPaymaster(await treasury.getAddress());
  const crossSig = await backend.signTypedData(domain(chain.chainId, addrA), types(), value(3n));
  await expectRevert(
    () => pmB.enrollSigned.staticCall(id(41), W1, 0, 0, 100n, id(0), 3n, crossSig),
    "bad signature"
  );
  // Sanity: the same params signed FOR B work on B.
  const sigB = await backend.signTypedData(
    domain(chain.chainId, await pmB.getAddress()), types(), value(3n));
  await (await pmB.enrollSigned(id(41), W1, 0, 0, 100n, id(0), 3n, sigB)).wait();
  assert.equal(await pmB.isAuthorized(W1), true, "correctly-bound enrollment on B must work");

  // (e) high-s malleation of a fresh valid signature.
  const sig4 = await backend.signTypedData(domain(chain.chainId, addrA), types(), value(4n));
  await expectRevert(
    () => pmA.enrollSigned.staticCall(id(41), W1, 0, 0, 100n, id(0), 4n, malleateHighS(sig4)),
    "bad s"
  );
});
