// T19 - AssetModule and the DAO asset tiers.
//
// Tier 1 buys within the per-asset cap, tier 2 disposes with an admin EIP-712
// signature, and tier 3 adds an asset or buys above the cap through a proposal.
// The approval is always reset to zero after an acquisition.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const abi = ethers.AbiCoder.defaultAbiCoder();
const h = (types, values) => ethers.keccak256(abi.encode(types, values));

const ACTION_DISPOSE_ASSET = 4;

test("T19 assets: tier-1 buy, tier-2 dispose, tier-3 proposals", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, alice, bob, attacker] = chain.signers;
  const adminAddr = await admin.getAddress();
  const agentSignerAddr = await agentSigner.getAddress();
  const bobAddr = await bob.getAddress();
  const deployerAddr = await deployer.getAddress();

  const agent = await deploy(artifacts, "MockAgent", deployer);
  const agentAddr = await agent.getAddress();
  const core = await deploy(artifacts, "DaoCore", deployer, [
    [id(9201), adminAddr, agentSignerAddr, true, 86400, 10, 3600, 5000],
    deployerAddr,
  ]);
  const coreAddr = await core.getAddress();
  await (await core.initializeAgent(agentAddr)).wait();

  const token = await deploy(artifacts, "MockERC20", deployer, ["USD", "USD"]);
  const tokenAddr = await token.getAddress();
  const assetId = id(0x5150);
  const module = await deploy(artifacts, "AssetModule", deployer, [coreAddr]);
  const moduleAddr = await module.getAddress();

  await (
    await core.initializeAssetModule(moduleAddr)
  ).wait();
  await (
    await core.initializeAssets([
      {
        assetId,
        token: tokenAddr,
        unitPrice: ethers.parseEther("10"),
        cap: ethers.parseEther("1000"),
      },
    ])
  ).wait();
  await (
    await core.configureTokenCaps([
      {
        token: tokenAddr,
        perTx: ethers.parseEther("1000"),
        perPeriod: ethers.parseEther("5000"),
        periodLength: 86400,
      },
    ])
  ).wait();
  await token.mint(coreAddr, ethers.parseEther("100000"));

  const agentExecute = (fn, args = []) => {
    const data = core.interface.encodeFunctionData(fn, args);
    return agent.execute(coreAddr, data);
  };

  const walletFor = async (address) => {
    const accounts = chain.gp.getInitialAccounts();
    const entry = Object.entries(accounts).find(
      ([addr]) => addr.toLowerCase() === address.toLowerCase()
    );
    return new ethers.Wallet(entry[1].secretKey, chain.provider);
  };
  const adminWallet = await walletFor(adminAddr);
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
  const signAuth = async (actionType, paramsHash, signer = adminWallet) => {
    const nonce = await core.adminNonce();
    const latest = await chain.provider.getBlock("latest");
    const expiry = BigInt(latest.timestamp + 3600);
    const signature = await signer.signTypedData(domain(), actionTypes, {
      daoCore: coreAddr,
      chainId: 1337,
      actionType,
      paramsHash,
      nonce,
      expiry,
    });
    return { nonce, expiry, signature };
  };

  const paymaster = await deploy(artifacts, "MockVotePaymaster", deployer);
  const paymasterAddr = await paymaster.getAddress();
  await (await core.connect(admin).setVotePaymaster(paymasterAddr)).wait();
  await (await agentExecute("addMembers", [[111n], [0n], id(0x3001)])).wait();

  const passProposal = async (target, data, nullifier) => {
    await (
      await agentExecute("createProposal", [
        target,
        data,
        0n,
        ethers.ZeroHash,
        ethers.ZeroHash,
      ])
    ).wait();
    const proposalId = await core.proposalCount();
    await (await paymaster.setConsumed(coreAddr, proposalId, nullifier, true)).wait();
    await (await paymaster.setChoice(coreAddr, proposalId, nullifier, true)).wait();
    await (await core.connect(alice).castVote(proposalId, true, nullifier)).wait();
    await chain.increaseTime(3601);
    await (await core.connect(alice).executeProposal(proposalId)).wait();
  };

  await t.test("tier-1 acquisition is atomic and resets the allowance", async () => {
    const before = await token.balanceOf(coreAddr);
    await (await agentExecute("acquireAsset", [assetId, 5n])).wait();

    assert.equal(await module.holdings(coreAddr, assetId), 5n);
    assert.equal(
      await token.balanceOf(moduleAddr),
      ethers.parseEther("50"),
      "module received the cost"
    );
    assert.equal(
      await token.balanceOf(coreAddr),
      before - ethers.parseEther("50")
    );
    assert.equal(
      await token.allowance(coreAddr, moduleAddr),
      0n,
      "no residual approval"
    );
  });

  await t.test("above-cap buy reverts", async () => {
    const data = core.interface.encodeFunctionData("acquireAsset", [
      assetId,
      101n,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, data),
      "asset cap"
    );

    // The cap is cumulative: 96 units are below the per-transaction cap but
    // would take the total position (5 + 96) past it.
    const cumulative = core.interface.encodeFunctionData("acquireAsset", [
      assetId,
      96n,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, cumulative),
      "asset cap"
    );
  });

  await t.test("tier-3 above-cap acquisition executes through a proposal", async () => {
    const data = core.interface.encodeFunctionData("acquireAssetAboveCap", [
      assetId,
      150n,
    ]);
    await passProposal(coreAddr, data, 7001n);
    assert.equal(await module.holdings(coreAddr, assetId), 155n);
    assert.equal(await token.allowance(coreAddr, moduleAddr), 0n);
  });

  await t.test("tier-2 disposal checks signature, nonce and expiry", async () => {
    const paramsHash = h(
      ["bytes32", "uint256", "address"],
      [assetId, 3n, bobAddr]
    );
    const auth = await signAuth(ACTION_DISPOSE_ASSET, paramsHash);
    await (
      await agentExecute("disposeAsset", [assetId, 3n, bobAddr, auth])
    ).wait();

    assert.equal(await module.holdings(coreAddr, assetId), 152n);
    assert.equal(await token.balanceOf(bobAddr), ethers.parseEther("30"));
    assert.equal(await core.adminNonce(), 1n);

    const replayData = core.interface.encodeFunctionData("disposeAsset", [
      assetId,
      2n,
      bobAddr,
      auth,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, replayData),
      "nonce"
    );

    const expired = { ...auth, nonce: 1n, expiry: 1n };
    const expiredData = core.interface.encodeFunctionData("disposeAsset", [
      assetId,
      2n,
      bobAddr,
      expired,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, expiredData),
      "expired"
    );

    const wrongSigner = await walletFor(bobAddr);
    const wrong = await signAuth(ACTION_DISPOSE_ASSET, paramsHash, wrongSigner);
    const wrongData = core.interface.encodeFunctionData("disposeAsset", [
      assetId,
      2n,
      bobAddr,
      wrong,
    ]);
    await expectRevert(
      () => agent.execute.staticCall(coreAddr, wrongData),
      "bad signature"
    );
  });

  await t.test("tier-3 allowlists a new asset", async () => {
    const token2 = await deploy(artifacts, "MockERC20", deployer, ["RWA", "RWA"]);
    const token2Addr = await token2.getAddress();
    const newAssetId = id(0x5151);
    const data = module.interface.encodeFunctionData("allowAsset", [
      newAssetId,
      token2Addr,
      ethers.parseEther("20"),
      ethers.parseEther("500"),
    ]);
    await passProposal(moduleAddr, data, 7002n);

    const info = await module.assetInfo(newAssetId);
    assert.equal(info.token, token2Addr);
    assert.equal(info.cap, ethers.parseEther("500"));

    await token2.mint(coreAddr, ethers.parseEther("1000"));
    await (await agentExecute("acquireAsset", [newAssetId, 4n])).wait();
    assert.equal(await module.holdings(coreAddr, newAssetId), 4n);
  });

  await t.test("asset ids are immutable once allowlisted", async () => {
    const standalone = await deploy(artifacts, "AssetModule", deployer, [
      deployerAddr,
    ]);
    await (
      await standalone.allowAsset(id(0x7777), tokenAddr, 1n, 10n)
    ).wait();
    await expectRevert(
      () => standalone.allowAsset.staticCall(id(0x7777), tokenAddr, 2n, 20n),
      "asset exists"
    );
  });

  await t.test("module and DAO gates reject outsiders", async () => {
    await expectRevert(
      () => core.connect(attacker).acquireAsset.staticCall(assetId, 1n),
      "not agent"
    );
    await expectRevert(
      () => module.connect(attacker).buy.staticCall(assetId, 1n),
      "not dao"
    );
    await expectRevert(
      () =>
        module
          .connect(attacker)
          .allowAsset.staticCall(id(0x9999), tokenAddr, 1n, 1n),
      "not dao"
    );
  });
});
