// T18 - DaoFactory: one-transaction wiring, defaults and isolation.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

function parseEvent(contract, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === name) return parsed.args;
    } catch {
      /* not from this contract */
    }
  }
  throw new Error(`${name} event not found`);
}

test("T18 DaoFactory: deploy, wire and isolate DAOs", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, alice, bob] = chain.signers;
  const adminAddr = await admin.getAddress();
  const signerAddr = await agentSigner.getAddress();
  const aliceAddr = await alice.getAddress();
  const bobAddr = await bob.getAddress();

  const coreFactory = await deploy(artifacts, "DaoCoreFactory", deployer);
  const accountFactory = await deploy(artifacts, "AgentAccountFactory", deployer);
  const moduleFactory = await deploy(artifacts, "AssetModuleFactory", deployer);
  const coreFactoryAddr = await coreFactory.getAddress();
  const accountFactoryAddr = await accountFactory.getAddress();
  const moduleFactoryAddr = await moduleFactory.getAddress();
  const factory = await deploy(artifacts, "DaoFactory", deployer, [
    coreFactoryAddr,
    accountFactoryAddr,
    moduleFactoryAddr,
    ethers.ZeroAddress,
  ]);

  const token = await deploy(artifacts, "MockERC20", deployer, ["USDC", "USDC"]);
  const tokenAddr = await token.getAddress();
  const assetId = id(0x5150);
  const daoId = id(9101);

  const cfg = (overrides = {}) => [
    overrides.daoId ?? daoId,
    overrides.admin ?? adminAddr,
    overrides.agentSigner ?? signerAddr,
    overrides.frameEnforced ?? true,
    overrides.memberPeriodLength ?? 86400,
    overrides.addMemberLimit ?? 3,
    overrides.votePeriod ?? 3600,
    overrides.quorumBps ?? 5000,
  ];
  const tokenCaps = [[tokenAddr, ethers.parseEther("100"), ethers.parseEther("500"), 86400]];
  const assets = [[assetId, tokenAddr, ethers.parseEther("10"), ethers.parseEther("1000")]];
  const rules = [[aliceAddr, "0x12345678", true, 1]];

  let coreAddr;
  let accountAddr;
  let moduleAddr;

  await t.test("deploys and wires a DAO in one transaction", async () => {
    const tx = await factory.createDao(cfg(), rules, tokenCaps, assets, {
      value: ethers.parseEther("2"),
    });
    const receipt = await tx.wait();
    const created = parseEvent(factory, receipt, "DaoCreated");
    coreAddr = created.daoCore;
    accountAddr = created.agentAccount;
    moduleAddr = created.assetModule;

    const core = new ethers.Contract(coreAddr, artifacts.DaoCore.abi, deployer);
    const account = new ethers.Contract(
      accountAddr,
      artifacts.AgentAccount.abi,
      deployer
    );
    const module = new ethers.Contract(
      moduleAddr,
      artifacts.AssetModule.abi,
      deployer
    );

    assert.equal(created.daoId, daoId);
    assert.equal(created.admin, adminAddr);
    assert.equal(created.funding, ethers.parseEther("2"));
    assert.equal((await factory.daoIdOf(coreAddr)).toLowerCase(), daoId.toLowerCase());
    assert.equal((await factory.daos(daoId)).daoCore, coreAddr);

    assert.equal(await core.admin(), adminAddr);
    assert.equal(await core.agentAccount(), accountAddr);
    assert.equal(await core.assetModule(), moduleAddr);
    assert.equal(await account.dao(), coreAddr);
    assert.equal(await account.agentSigner(), signerAddr);
    assert.equal(await module.dao(), coreAddr);
    assert.equal(
      await chain.nativeBalance(coreAddr),
      ethers.parseEther("2"),
      "treasury must be funded"
    );

    assert.equal((await core.tokenCaps(tokenAddr)).allowed, true);
    assert.equal(
      (await core.tokenCaps(tokenAddr)).perTx,
      ethers.parseEther("100")
    );
    const info = await module.assetInfo(assetId);
    assert.equal(info.token, tokenAddr);
    assert.equal(info.cap, ethers.parseEther("1000"));

    // Default policy comes from DaoCore, not from the caller.
    assert.equal(
      (await account.rules(coreAddr, core.interface.getFunction("spend").selector))
        .tier,
      1n
    );
    assert.equal(
      (
        await account.rules(
          coreAddr,
          core.interface.getFunction("removeMember").selector
        )
      ).tier,
      2n
    );
    assert.equal(
      (
        await account.rules(
          coreAddr,
          core.interface.getFunction("addMembersAuthorized").selector
        )
      ).tier,
      2n
    );
    assert.equal(
      (
        await account.rules(
          coreAddr,
          core.interface.getFunction("executeProposal").selector
        )
      ).allowed,
      true
    );
    assert.equal(
      (
        await account.rules(
          coreAddr,
          core.interface.getFunction("castVote").selector
        )
      ).allowed,
      false
    );
    // Extra caller-supplied rule was applied.
    assert.equal((await account.rules(aliceAddr, "0x12345678")).allowed, true);
  });

  await t.test("rejects duplicate ids and empty ids", async () => {
    await expectRevert(
      () => factory.createDao.staticCall(cfg(), [], [], []),
      "dao exists"
    );
    await expectRevert(
      () => factory.createDao.staticCall(cfg({ daoId: id(0) }), [], [], []),
      "daoId=0"
    );
  });

  await t.test("separate DAOs own separate accounts, modules and balances", async () => {
    const tx = await factory.createDao(
      cfg({ daoId: id(9102), admin: bobAddr }),
      [],
      [],
      [],
      { value: ethers.parseEther("1") }
    );
    const created = parseEvent(factory, await tx.wait(), "DaoCreated");
    assert.notEqual(created.daoCore, coreAddr);
    assert.notEqual(created.agentAccount, accountAddr);
    assert.notEqual(created.assetModule, moduleAddr);
    assert.equal(
      await chain.nativeBalance(created.daoCore),
      ethers.parseEther("1")
    );
    assert.equal(
      await chain.nativeBalance(coreAddr),
      ethers.parseEther("2"),
      "first DAO balance must be untouched"
    );
  });

  await t.test("factory constructor rejects zero wiring", async () => {
    const iface = new ethers.Interface(artifacts.DaoFactory.abi);
    const data = ethers.concat([
      artifacts.DaoFactory.bytecode,
      iface.encodeDeploy([
        ethers.ZeroAddress,
        accountFactoryAddr,
        moduleFactoryAddr,
        ethers.ZeroAddress,
      ]),
    ]);
    await expectRevert(() => chain.provider.call({ data }), "coreFactory=0");
  });
});
