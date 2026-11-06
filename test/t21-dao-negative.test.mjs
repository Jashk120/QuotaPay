// T21 - DaoCore negative paths that the happy-path tests do not cover.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const abi = ethers.AbiCoder.defaultAbiCoder();
const h = (types, values) => ethers.keccak256(abi.encode(types, values));
const ACTION_ADD_MEMBERS = 1;

test("T21 DaoCore: rejected roots, targets, votes and emergency pause", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, alice, attacker] = chain.signers;
  const adminAddr = await admin.getAddress();
  const signerAddr = await agentSigner.getAddress();
  const attackerAddr = await attacker.getAddress();
  const deployerAddr = await deployer.getAddress();

  const agent = await deploy(artifacts, "MockAgent", deployer);
  const agentAddr = await agent.getAddress();
  const core = await deploy(artifacts, "DaoCore", deployer, [
    [id(9301), adminAddr, signerAddr, true, 86400, 10, 3600, 5000],
    deployerAddr,
  ]);
  const coreAddr = await core.getAddress();
  await (await core.initializeAgent(agentAddr)).wait();
  await (
    await core.configureTokenCaps([
      {
        token: ethers.ZeroAddress,
        perTx: ethers.parseEther("1"),
        perPeriod: ethers.parseEther("2"),
        periodLength: 86400,
      },
    ])
  ).wait();

  const agentExecute = (fn, args = []) => {
    const data = core.interface.encodeFunctionData(fn, args);
    return agent.execute(coreAddr, data);
  };
  const staticAgent = (fn, args = []) => {
    const data = core.interface.encodeFunctionData(fn, args);
    return agent.execute.staticCall(coreAddr, data);
  };

  const walletFor = async (address) => {
    const accounts = chain.gp.getInitialAccounts();
    const entry = Object.entries(accounts).find(
      ([addr]) => addr.toLowerCase() === address.toLowerCase()
    );
    return new ethers.Wallet(entry[1].secretKey, chain.provider);
  };
  const adminWallet = await walletFor(adminAddr);
  const actionTypes = {
    Action: [
      { name: "daoCore", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "actionType", type: "uint8" },
      { name: "paramsHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const latest = await chain.provider.getBlock("latest");
  const expiry = BigInt(latest.timestamp + 3600);

  await t.test("membership roots, indices and slots are validated", async () => {
    await expectRevert(
      () => staticAgent("addMembers", [[111n], [0n], ethers.ZeroHash]),
      "root=0"
    );
    await expectRevert(
      () => staticAgent("addMembers", [[111n], [1n << 20n], id(0x4001)]),
      "index"
    );

    await (await agentExecute("addMembers", [[111n], [0n], id(0x4001)])).wait();
    await expectRevert(
      () => staticAgent("addMembers", [[222n], [0n], id(0x4002)]),
      "slot used"
    );
    await expectRevert(
      () => staticAgent("addMembers", [[111n], [1n], id(0x4002)]),
      "commitment used"
    );
  });

  await t.test("admin authorization is bound to chain and domain", async () => {
    const paramsHash = h(
      ["uint256[]", "uint256[]", "bytes32"],
      [[333n], [2n], id(0x4003)]
    );
    const signature = await adminWallet.signTypedData(
      {
        name: "DaoCore",
        version: "1",
        chainId: 999,
        verifyingContract: coreAddr,
      },
      actionTypes,
      {
        daoCore: coreAddr,
        chainId: 1337,
        actionType: ACTION_ADD_MEMBERS,
        paramsHash,
        nonce: 0n,
        expiry,
      }
    );
    const auth = { nonce: 0n, expiry, signature };
    await expectRevert(
      () =>
        staticAgent("addMembersAuthorized", [
          [333n],
          [2n],
          id(0x4003),
          auth,
        ]),
      "bad signature"
    );
  });

  await t.test("proposal targets, selectors and deadlines are gated", async () => {
    await expectRevert(
      () => staticAgent("createProposal", [attackerAddr, "0x", 0n, ethers.ZeroHash, ethers.ZeroHash]),
      "target not allowed"
    );

    await expectRevert(
      () => core.connect(admin).setVotePaymaster.staticCall(attackerAddr),
      "paymaster not contract"
    );

    const castVoteData = core.interface.encodeFunctionData("castVote", [
      1n,
      true,
      1n,
    ]);
    await expectRevert(
      () => staticAgent("createProposal", [coreAddr, castVoteData, 0n, ethers.ZeroHash, ethers.ZeroHash]),
      "selector not allowed"
    );

    const tokenCapData = core.interface.encodeFunctionData("setTokenCap", [
      ethers.ZeroAddress,
      true,
      1n,
      1n,
      1n,
    ]);
    const past = BigInt((await chain.provider.getBlock("latest")).timestamp - 1);
    await expectRevert(
      () => staticAgent("createProposal", [coreAddr, tokenCapData, past, ethers.ZeroHash, ethers.ZeroHash]),
      "deadline"
    );

    // A proposal created before the first paymaster would permanently close
    // the admin bootstrap path, so it is rejected up front.
    await expectRevert(
      () => staticAgent("createProposal", [coreAddr, tokenCapData, 0n, ethers.ZeroHash, ethers.ZeroHash]),
      "no paymaster"
    );
  });

  await t.test("vote windows, quorum and rejection are enforced", async () => {
    const paymaster = await deploy(artifacts, "MockVotePaymaster", deployer);
    const paymasterAddr = await paymaster.getAddress();
    await (await core.connect(admin).setVotePaymaster(paymasterAddr)).wait();

    const data = core.interface.encodeFunctionData("setTokenCap", [
      ethers.ZeroAddress,
      true,
      1n,
      1n,
      1n,
    ]);

    await (await agentExecute("createProposal", [coreAddr, data, 0n, ethers.ZeroHash, ethers.ZeroHash])).wait();
    await expectRevert(() => core.connect(alice).castVote.staticCall(99n, true, 1n), "unknown proposal");

    await chain.increaseTime(3601);
    await expectRevert(() => core.connect(alice).castVote.staticCall(1n, true, 1n), "voting closed");
    await expectRevert(() => core.connect(alice).executeProposal.staticCall(1n), "quorum");

    await (await agentExecute("createProposal", [coreAddr, data, 0n, ethers.ZeroHash, ethers.ZeroHash])).wait();
    const proposalId = await core.proposalCount();
    await (await paymaster.setConsumed(coreAddr, proposalId, 5001n, true)).wait();
    await (await paymaster.setChoice(coreAddr, proposalId, 5001n, false)).wait();
    await (await core.connect(alice).castVote(proposalId, false, 5001n)).wait();
    await chain.increaseTime(3601);
    await expectRevert(
      () => core.connect(alice).executeProposal.staticCall(proposalId),
      "rejected"
    );
  });

  await t.test("governance can rotate the vote paymaster", async () => {
    const paymasterAddr = await core.votePaymaster();
    const paymaster = new ethers.Contract(
      paymasterAddr,
      artifacts.MockVotePaymaster.abi,
      deployer
    );
    const nextPaymaster = await deploy(artifacts, "MockVotePaymaster", deployer);
    const nextPaymasterAddr = await nextPaymaster.getAddress();
    const data = core.interface.encodeFunctionData("setVotePaymaster", [
      nextPaymasterAddr,
    ]);
    await (
      await agentExecute("createProposal", [
        coreAddr,
        data,
        0n,
        ethers.ZeroHash,
        ethers.ZeroHash,
      ])
    ).wait();
    const proposalId = await core.proposalCount();
    await (await paymaster.setConsumed(coreAddr, proposalId, 6001n, true)).wait();
    await (await paymaster.setChoice(coreAddr, proposalId, 6001n, true)).wait();
    await (await core.connect(alice).castVote(proposalId, true, 6001n)).wait();
    await chain.increaseTime(3601);
    await (await core.connect(alice).executeProposal(proposalId)).wait();
    assert.equal(await core.votePaymaster(), nextPaymasterAddr);
  });

  await t.test("bootstrap and governance-only setters stay closed", async () => {
    await expectRevert(
      () => core.connect(admin).setVotePaymaster.staticCall(attackerAddr),
      "proposals exist"
    );
    await expectRevert(
      () =>
        core
          .connect(attacker)
          .setTokenCap.staticCall(ethers.ZeroAddress, true, 1n, 1n, 1n),
      "not governance"
    );
    await expectRevert(
      () => core.connect(admin).setFrameEnforced.staticCall(false),
      "not governance"
    );
  });

  await t.test("the admin can pause the agent directly or through DaoCore", async () => {
    const core2 = await deploy(artifacts, "DaoCore", deployer, [
      [id(9302), adminAddr, signerAddr, true, 86400, 10, 3600, 5000],
      deployerAddr,
    ]);
    const core2Addr = await core2.getAddress();
    const account2 = await deploy(artifacts, "AgentAccount", deployer, [
      adminAddr,
      signerAddr,
      true,
      deployerAddr,
    ]);
    const account2Addr = await account2.getAddress();
    await (await account2.initializeDao(core2Addr)).wait();
    await (await core2.initializeAgent(account2Addr)).wait();

    await expectRevert(
      () => core2.connect(attacker).pauseAgent.staticCall(true),
      "not admin"
    );
    await (await core2.connect(admin).pauseAgent(true)).wait();
    assert.equal(await account2.paused(), true);
    await (await account2.connect(admin).pause(false)).wait();
    assert.equal(await account2.paused(), false);
  });
});
