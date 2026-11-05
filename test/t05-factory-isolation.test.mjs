// T05 — Factory governance and company isolation (CompanyFactory).
//
// Invariants: (a) companyId is unique; (b) creation is admin-self-service
// or governance-only; (c) each instance owns independent balance, limits
// and registry entries (one company's spending/config never touches
// another's); (d) companyOf tracks every created paymaster.
// Why existing coverage misses it: demos deploy a single company and never
// attempt duplicates, unauthorized creates, or cross-company interference.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const cfg = (companyId, admin, treasury, extra = {}) => ({
  companyId, admin, treasury,
  globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
  maxSponsorCost: 100n, withdrawalDelay: 0, ...extra,
});

test("T05 factory: uniqueness, authorization, isolation", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, alice, bob, attacker] = chain.signers;
  const A = await alice.getAddress(), B = await bob.getAddress();
  const registry = await deploy(artifacts, "MockRegistry", deployer);
  const R = await registry.getAddress();

  // Self-service factory (governance = 0).
  const factory = await deploy(artifacts, "CompanyFactory", deployer, [ethers.ZeroAddress, R]);

  // (b) unauthorized: attacker tries to create a company owned by Alice.
  await expectRevert(
    () => factory.connect(attacker).createCompany.staticCall(cfg(id(51), A, A)),
    "not authorized"
  );
  // Self-service happy path: Alice creates her own company, funded.
  const tx = await factory.connect(alice).createCompany(cfg(id(51), A, A), { value: ethers.parseEther("5") });
  const rc = await tx.wait();
  const created = rc.logs.find((l) => { try { return factory.interface.parseLog(l).name === "CompanyCreated"; } catch { return false; } });
  const paymasterAddr = factory.interface.parseLog(created).args.paymaster;
  // (d) registry tracking.
  assert.equal(await factory.companyOf(paymasterAddr), id(51));
  assert.equal((await factory.companies(id(51))).paymaster, paymasterAddr);

  // (a) duplicate companyId.
  await expectRevert(
    () => factory.connect(alice).createCompany.staticCall(cfg(id(51), A, A)),
    "company exists"
  );
  // Zero companyId.
  await expectRevert(
    () => factory.connect(alice).createCompany.staticCall(cfg(id(0), A, A)),
    "companyId=0"
  );

  // Governance path: only governance may create on behalf of others.
  const govFactory = await deploy(artifacts, "CompanyFactory", deployer, [A, R]);
  await (await govFactory.connect(alice).createCompany(cfg(id(52), B, B))).wait(); // governance Alice, admin Bob
  const c52 = await govFactory.companies(id(52));
  assert.notEqual(c52.paymaster, ethers.ZeroAddress, "governance-created company must be tracked");
  await expectRevert(
    () => govFactory.connect(attacker).createCompany.staticCall(cfg(id(53), B, B)),
    "not authorized"
  );

  // (c) isolation: second company has independent balance and limits.
  await (await factory.connect(bob).createCompany(cfg(id(54), B, B), { value: ethers.parseEther("1") })).wait();
  const c1 = new ethers.Contract(paymasterAddr, artifacts.CompanyPaymaster.abi, alice);
  const c2addr = (await factory.companies(id(54))).paymaster;
  const c2 = new ethers.Contract(c2addr, artifacts.CompanyPaymaster.abi, bob);
  assert.equal(await chain.nativeBalance(paymasterAddr), ethers.parseEther("5"));
  assert.equal(await chain.nativeBalance(c2addr), ethers.parseEther("1"));
  await (await c1.setGlobalCreditLimit(10n)).wait();
  assert.equal(await c1.globalCreditLimit(), 10n);
  assert.equal(await c2.globalCreditLimit(), 1000n, "company 2 limit must be unaffected");
});
