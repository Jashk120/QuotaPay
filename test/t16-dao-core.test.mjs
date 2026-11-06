// T16 - DaoCore membership, caps, admin signatures and proposals.
//
// DaoCore is exercised directly with a contract stand-in for AgentAccount:
// `DaoCore.onlyAgent` compares msg.sender with the configured agent, so a
// forwarder is enough on a vanilla EVM (the real VERIFY path is covered by the
// AgentAccount and ZK tests).
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const abi = ethers.AbiCoder.defaultAbiCoder();
const h = (types, values) => ethers.keccak256(abi.encode(types, values));

const ACTION_ADD_MEMBERS = 1;
const ACTION_REMOVE_MEMBER = 2;
const ACTION_SET_ROLE = 3;

test("T16 DaoCore: members, caps, admin auth, proposals", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, alice, bob, attacker] = chain.signers;
  const adminAddr = await admin.getAddress();
  const agentSignerAddr = await agentSigner.getAddress();
  const attackerAddr = await attacker.getAddress();
  // Ganache's eth_signTypedData_v4 expects an object, while ethers sends the
  // serialized string. Sign with the same account as a local wallet instead.
  const initialAccounts = chain.gp.getInitialAccounts();
  const adminEntry = Object.entries(initialAccounts).find(
    ([address]) => address.toLowerCase() === adminAddr.toLowerCase()
  );
  const adminWallet = new ethers.Wallet(adminEntry[1].secretKey, chain.provider);

  const agent = await deploy(artifacts, "MockAgent", deployer);
  const agentAddr = await agent.getAddress();
  const core = await deploy(artifacts, "DaoCore", deployer, [
    [id(9001), adminAddr, agentSignerAddr, true, 86400, 3, 3600, 5000],
    await deployer.getAddress(),
  ]);
  const coreAddr = await core.getAddress();
  await (await core.initializeAgent(agentAddr)).wait();
  await (
    await core.configureTokenCaps([
      {
        token: ethers.ZeroAddress,
        perTx: ethers.parseEther("1"),
        perPeriod: ethers.parseEther("1.5"),
        periodLength: 86400,
      },
    ])
  ).wait();
  await (await core.deposit({ value: ethers.parseEther("5") })).wait();

  const agentExecute = (fn, args = []) => {
    const data = core.interface.encodeFunctionData(fn, args);
    return agent.execute(coreAddr, data);
  };

  const domain = () => ({
    name: "DaoCore",
    version: "1",
    chainId: 1337,
    verifyingContract: coreAddr,
  });
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
  const signAuth = async (actionType, paramsHash) => {
    const nonce = await core.adminNonce();
    const latest = await chain.provider.getBlock("latest");
    const expiry = BigInt(latest.timestamp + 3600);
    const signature = await adminWallet.signTypedData(domain(), actionTypes, {
      daoCore: coreAddr,
      chainId: 1337,
      actionType,
      paramsHash,
      nonce,
      expiry,
    });
    return { nonce, expiry, signature };
  };

  await t.test("adds members, records roots and the commitment journal", async () => {
    const root = id(0x1001);
    const commitments = [111n, 222n];
    const indices = [0n, 1n];
    const auth = await signAuth(
      ACTION_ADD_MEMBERS,
      h(["uint256[]", "uint256[]", "bytes32"], [commitments, indices, root])
    );
    await (
      await agentExecute("addMembers", [commitments, indices, root, auth])
    ).wait();
    assert.equal(await core.memberCount(), 2n);
    assert.equal(await core.membershipRoot(), root);
    assert.equal(await core.knownRoot(root), true);
    assert.equal(await core.leafCommitment(0), 111n);
    assert.equal(await core.leafCommitment(1), 222n);
    assert.notEqual(await core.journalRoot(), ethers.ZeroHash);
  });

  await t.test("rejects duplicates, empty batches and non-agent callers", async () => {
    const duplicate = [[111n], [2n], id(0x1002)];
    const auth = await signAuth(
      ACTION_ADD_MEMBERS,
      h(["uint256[]", "uint256[]", "bytes32"], duplicate)
    );
    const data = core.interface.encodeFunctionData("addMembers", [
      ...duplicate,
      auth,
    ]);
    await expectRevert(() => agent.execute.staticCall(coreAddr, data), "commitment used");
    await expectRevert(
      () =>
        core
          .connect(attacker)
          .addMembers.staticCall([444n], [3n], id(0x1003), {
            nonce: 0n,
            expiry: 0n,
            signature: "0x",
          }),
      "not agent"
    );
  });

  await t.test("rate limit escalates to an admin-authorized add", async () => {
    const first = [[444n], [3n], id(0x1002)];
    const firstAuth = await signAuth(
      ACTION_ADD_MEMBERS,
      h(["uint256[]", "uint256[]", "bytes32"], first)
    );
    await (await agentExecute("addMembers", [...first, firstAuth])).wait();
    assert.equal(await core.memberCount(), 3n);

    const next = [[555n], [4n], id(0x1003)];
    const paramsHash = h(
      ["uint256[]", "uint256[]", "bytes32"],
      next
    );
    const auth = await signAuth(ACTION_ADD_MEMBERS, paramsHash);
    const data = core.interface.encodeFunctionData("addMembers", [
      ...next,
      auth,
    ]);
    await expectRevert(() => agent.execute.staticCall(coreAddr, data), "rate limit");

    await (
      await agentExecute("addMembersAuthorized", [...next, auth])
    ).wait();
    assert.equal(await core.memberCount(), 4n);
    assert.equal(await core.adminNonce(), 3n);
  });

  await t.test("tier-1 spend enforces per-tx and per-period caps", async () => {
    const before = await chain.nativeBalance(await bob.getAddress());
    await (
      await agentExecute("spend", [
        ethers.ZeroAddress,
        await bob.getAddress(),
        ethers.parseEther("1"),
        ethers.ZeroHash,
        ethers.ZeroHash,
      ])
    ).wait();
    assert.equal(
      await chain.nativeBalance(await bob.getAddress()),
      before + ethers.parseEther("1")
    );

    const overPerTx = core.interface.encodeFunctionData("spend", [
      ethers.ZeroAddress,
      await bob.getAddress(),
      ethers.parseEther("1.1"),
      ethers.ZeroHash,
      ethers.ZeroHash,
    ]);
    await expectRevert(() => agent.execute.staticCall(coreAddr, overPerTx), "per-tx cap");

    const overPeriod = core.interface.encodeFunctionData("spend", [
      ethers.ZeroAddress,
      await bob.getAddress(),
      ethers.parseEther("0.6"),
      ethers.ZeroHash,
      ethers.ZeroHash,
    ]);
    await expectRevert(() => agent.execute.staticCall(coreAddr, overPeriod), "period cap");

    await chain.increaseTime(86401);
    await (
      await agentExecute("spend", [
        ethers.ZeroAddress,
        await bob.getAddress(),
        ethers.parseEther("1"),
        ethers.ZeroHash,
        ethers.ZeroHash,
      ])
    ).wait();
  });

  await t.test("tier-2 removal checks signature, expiry, nonce and role", async () => {
    const newRoot = id(0x1004);
    const paramsHash = h(["uint256", "bytes32"], [1n, newRoot]);
    const auth = await signAuth(ACTION_REMOVE_MEMBER, paramsHash);
    await (await agentExecute("removeMember", [1n, newRoot, auth])).wait();
    assert.equal(await core.memberCount(), 3n);
    assert.equal(await core.leafCommitment(1), 0n);
    assert.equal(await core.membershipRoot(), newRoot);
    assert.equal(await core.adminNonce(), 4n);

    // Replaying the same nonce fails even for a different member.
    const replayData = core.interface.encodeFunctionData("removeMember", [
      4n,
      id(0x1005),
      auth,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, replayData),
      "nonce"
    );

    const expired = { ...auth, nonce: 2n, expiry: 1n, signature: auth.signature };
    const expiredData = core.interface.encodeFunctionData("removeMember", [
      4n,
      id(0x1005),
      expired,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, expiredData),
      "expired"
    );

    const roleParams = h(["uint256", "uint8"], [3n, 2n]);
    const roleAuth = await signAuth(ACTION_SET_ROLE, roleParams);
    await (await agentExecute("setRole", [3n, 2n, roleAuth])).wait();
    assert.equal(await core.memberRole(3), 2n);
  });

  await t.test("proposal: proof gate, quorum, execution and replay", async () => {
    const paymaster = await deploy(artifacts, "MockVotePaymaster", deployer);
    const paymasterAddr = await paymaster.getAddress();
    await (await core.connect(admin).setVotePaymaster(paymasterAddr)).wait();

    const data = core.interface.encodeFunctionData("setTokenCap", [
      ethers.ZeroAddress,
      true,
      ethers.parseEther("2"),
      ethers.parseEther("4"),
      86400,
    ]);
    await (
      await agentExecute("createProposal", [
        coreAddr,
        data,
        0n,
        id(0xaaa1),
        id(0xbbb1),
      ])
    ).wait();
    assert.equal(await core.proposalCount(), 1n);

    const proposal = await core.getProposal(1);
    assert.equal(proposal.snapshotMembers, 3n);
    assert.equal(proposal.snapshotRoot, await core.membershipRoot());

    await expectRevert(
      () => core.connect(alice).castVote.staticCall(1n, true, 42n),
      "no proof"
    );

    await (await paymaster.setConsumed(coreAddr, 1n, 42n, true)).wait();
    await (await paymaster.setConsumed(coreAddr, 1n, 43n, true)).wait();
    await (await paymaster.setChoice(coreAddr, 1n, 42n, true)).wait();
    await (await paymaster.setChoice(coreAddr, 1n, 43n, true)).wait();
    await (await core.connect(alice).castVote(1n, true, 42n)).wait();
    await (await core.connect(bob).castVote(1n, true, 43n)).wait();
    await expectRevert(
      () => core.connect(alice).castVote.staticCall(1n, true, 42n),
      "voted"
    );

    await expectRevert(
      () => core.connect(alice).executeProposal.staticCall(1n),
      "voting open"
    );

    await chain.increaseTime(3601);
    await (await core.connect(alice).executeProposal(1n)).wait();
    assert.equal((await core.tokenCaps(ethers.ZeroAddress)).perTx, ethers.parseEther("2"));
    await expectRevert(
      () => core.connect(alice).executeProposal.staticCall(1n),
      "executed"
    );
  });

  await t.test("bootstrap is factory-only and agent-only paths stay closed", async () => {
    await expectRevert(
      () => core.connect(attacker).initializeAgent.staticCall(attackerAddr),
      "not factory"
    );
    await expectRevert(
      () =>
        core
          .connect(attacker)
          .setTokenCap.staticCall(ethers.ZeroAddress, true, 1n, 1n, 1n),
      "not governance"
    );
  });
});
