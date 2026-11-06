// T24 - DaoSwapModule: pool allowlist, deadline, slippage, settlement,
// refunds, native/ERC-20 legs and the tier-3 treasury path.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

const abi = ethers.AbiCoder.defaultAbiCoder();
const ZERO = ethers.ZeroAddress;

function poolKey(currency0, currency1, fee = 3000, tickSpacing = 60) {
  return { currency0, currency1, fee, tickSpacing, hooks: ZERO };
}

function sortedKey(tokenA, tokenB, fee = 3000, tickSpacing = 60) {
  const aIsC0 = BigInt(tokenA) < BigInt(tokenB);
  return {
    key: aIsC0 ? poolKey(tokenA, tokenB, fee, tickSpacing) : poolKey(tokenB, tokenA, fee, tickSpacing),
    aIsC0,
  };
}

async function latestDeadline(chain, seconds = 3600) {
  const latest = await chain.provider.getBlock("latest");
  return BigInt(latest.timestamp + seconds);
}

function swapRequest(key, zeroForOne, amountIn, minAmountOut, deadline) {
  return { key, zeroForOne, amountIn, minAmountOut, deadline };
}

test("T24 DaoSwapModule: ERC-20 swaps, checks and refunds", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, dao, agent, attacker] = chain.signers;
  const daoAddr = await dao.getAddress();
  const agentAddr = await agent.getAddress();

  const pool = await deploy(artifacts, "MockPoolManager", deployer);
  const poolAddr = await pool.getAddress();
  const module = await deploy(artifacts, "DaoSwapModule", deployer, [
    poolAddr,
    daoAddr,
    agentAddr,
  ]);
  const moduleAddr = await module.getAddress();
  const tokenIn = await deploy(artifacts, "MockERC20", deployer, ["USDC", "USDC"]);
  const tokenOut = await deploy(artifacts, "MockERC20", deployer, ["RWA", "RWA"]);
  const inAddr = await tokenIn.getAddress();
  const outAddr = await tokenOut.getAddress();
  const { key, aIsC0 } = sortedKey(inAddr, outAddr);
  const zeroForOne = aIsC0;
  const poolId = ethers.keccak256(
    abi.encode(
      ["tuple(address,address,uint24,int24,address)"],
      [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
    )
  );

  await (await module.connect(dao).setPool(key, true)).wait();

  const amountIn = ethers.parseEther("100");
  const amountOut = ethers.parseEther("95");
  const fund = async (out = amountOut) => {
    await (await tokenIn.mint(moduleAddr, amountIn)).wait();
    await (await tokenOut.mint(poolAddr, out)).wait();
  };
  const setDelta = async (spent = amountIn, received = amountOut) => {
    if (zeroForOne) {
      await (await pool.setNextDelta(-spent, received)).wait();
    } else {
      await (await pool.setNextDelta(received, -spent)).wait();
    }
  };

  await t.test("swaps exact-in, pays the DAO and settles the input", async () => {
    await fund();
    await setDelta();
    const deadline = await latestDeadline(chain);
    const req = swapRequest(key, zeroForOne, amountIn, amountOut, deadline);

    const quoted = await module.connect(agent).swap.staticCall(req);
    assert.equal(quoted, amountOut);

    const tx = await module.connect(agent).swap(req);
    const receipt = await tx.wait();
    const swapped = receipt.logs
      .map((log) => {
        try {
          return module.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "Swapped");
    assert.ok(swapped, "Swapped event missing");
    assert.equal(swapped.args.poolId, poolId);
    assert.equal(swapped.args.caller, agentAddr);
    assert.equal(swapped.args.amountIn, amountIn);
    assert.equal(swapped.args.amountOut, amountOut);

    assert.equal(await tokenIn.balanceOf(moduleAddr), 0n);
    assert.equal(await tokenOut.balanceOf(moduleAddr), 0n);
    assert.equal(await tokenOut.balanceOf(daoAddr), amountOut);
    assert.equal(await pool.tokenSettled(inAddr), amountIn);
    assert.equal(await pool.lastTaker(), daoAddr);
    assert.equal(await pool.lastTakeToken(), outAddr);
    assert.equal(await pool.lastTakeAmount(), amountOut);

    const expectedLimit = zeroForOne
      ? 4295128739n + 1n
      : 1461446703485210103287273052203988822378723970342n - 1n;
    assert.equal(await pool.lastSqrtPriceLimitX96(), expectedLimit);
  });

  await t.test("refunds input the price limit did not consume", async () => {
    await fund();
    await setDelta(ethers.parseEther("80"), ethers.parseEther("50"));
    const deadline = await latestDeadline(chain);
    const req = swapRequest(
      key,
      zeroForOne,
      amountIn,
      ethers.parseEther("10"),
      deadline
    );
    const before = await tokenIn.balanceOf(daoAddr);
    await (await module.connect(agent).swap(req)).wait();
    const refund = amountIn - ethers.parseEther("80");
    assert.equal(await tokenIn.balanceOf(daoAddr), before + refund);
    assert.equal(await tokenIn.balanceOf(moduleAddr), 0n);
    assert.equal(await pool.tokenSettled(inAddr), amountIn + ethers.parseEther("80"));
  });

  await t.test("rejects unauthorized callers, expired deadlines and unknown pools", async () => {
    const deadline = await latestDeadline(chain);
    const req = swapRequest(key, zeroForOne, amountIn, amountOut, deadline);
    await expectRevert(
      () => module.connect(attacker).swap.staticCall(req),
      "not authorized"
    );

    const expired = swapRequest(key, zeroForOne, amountIn, amountOut, 1n);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(expired),
      "expired"
    );

    const otherKey = sortedKey(inAddr, outAddr, 500).key;
    const unknown = swapRequest(otherKey, zeroForOne, amountIn, amountOut, deadline);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(unknown),
      "pool not allowed"
    );
  });

  await t.test("rejects zero amounts, missing input and slippage", async () => {
    const deadline = await latestDeadline(chain);
    const zeroIn = swapRequest(key, zeroForOne, 0n, amountOut, deadline);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(zeroIn),
      "amount=0"
    );
    const zeroOut = swapRequest(key, zeroForOne, amountIn, 0n, deadline);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(zeroOut),
      "amount=0"
    );

    assert.equal(await tokenIn.balanceOf(moduleAddr), 0n);
    const noInput = swapRequest(key, zeroForOne, amountIn, amountOut, deadline);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(noInput),
      "insufficient input"
    );

    await fund();
    await setDelta(amountIn, amountOut - 1n);
    const slippage = swapRequest(key, zeroForOne, amountIn, amountOut, deadline);
    const outBefore = await tokenOut.balanceOf(daoAddr);
    const settledBefore = await pool.tokenSettled(inAddr);
    await expectRevert(
      () => module.connect(agent).swap.staticCall(slippage),
      "slippage"
    );

    // Nothing moved through the failed quote.
    assert.equal(await tokenIn.balanceOf(moduleAddr), amountIn);
    assert.equal(await tokenOut.balanceOf(daoAddr), outBefore);
    assert.equal(await pool.tokenSettled(inAddr), settledBefore);
  });

  await t.test("setPool is DAO-only and validates key ordering", async () => {
    await expectRevert(
      () => module.connect(attacker).setPool.staticCall(key, false),
      "not dao"
    );
    const same = sortedKey(inAddr, inAddr).key;
    await expectRevert(
      () => module.connect(dao).setPool.staticCall(same, true),
      "same currency"
    );
    const unsorted = poolKey(key.currency1, key.currency0);
    await expectRevert(
      () => module.connect(dao).setPool.staticCall(unsorted, true),
      "unsorted key"
    );
  });

  await t.test("unlockCallback cannot be called outside unlock", async () => {
    await expectRevert(
      () => module.connect(attacker).unlockCallback.staticCall("0x"),
      "not manager"
    );
  });
});

test("T24 DaoSwapModule: native legs and factory wiring", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, dao, agent, attacker] = chain.signers;
  const daoAddr = await dao.getAddress();
  const agentAddr = await agent.getAddress();

  await t.test("native output reaches the DAO", async () => {
    const pool = await deploy(artifacts, "MockPoolManager", deployer);
    const poolAddr = await pool.getAddress();
    const usdc = await deploy(artifacts, "MockERC20", deployer, ["USDC", "USDC"]);
    const usdcAddr = await usdc.getAddress();
    const module = await deploy(artifacts, "DaoSwapModule", deployer, [
      poolAddr,
      daoAddr,
      agentAddr,
    ]);
    const moduleAddr = await module.getAddress();

    // currency0 = native (address(0) sorts first), currency1 = USDC.
    const key = poolKey(ZERO, usdcAddr);
    await (await module.connect(dao).setPool(key, true)).wait();

    const amountIn = ethers.parseEther("100");
    const amountOut = ethers.parseEther("0.2");
    await (await usdc.mint(moduleAddr, amountIn)).wait();
    await (await usdc.mint(poolAddr, 0n)).wait();
    await (await deployer.sendTransaction({ to: poolAddr, value: amountOut })).wait();
    // USDC -> ETH is zeroForOne = false: amount0 is the native output.
    await (await pool.setNextDelta(amountOut, -amountIn)).wait();

    const before = await chain.nativeBalance(daoAddr);
    const deadline = await latestDeadline(chain);
    await (
      await module
        .connect(agent)
        .swap(swapRequest(key, false, amountIn, amountOut, deadline))
    ).wait();

    assert.equal(await chain.nativeBalance(daoAddr), before + amountOut);
    assert.equal(await usdc.balanceOf(moduleAddr), 0n);
    assert.equal(await pool.tokenSettled(usdcAddr), amountIn);
    assert.equal(await pool.lastTakeToken(), ZERO);
  });

  await t.test("native input is credited through settle{value}", async () => {
    const pool = await deploy(artifacts, "MockPoolManager", deployer);
    const poolAddr = await pool.getAddress();
    const usdc = await deploy(artifacts, "MockERC20", deployer, ["USDC", "USDC"]);
    const usdcAddr = await usdc.getAddress();
    const module = await deploy(artifacts, "DaoSwapModule", deployer, [
      poolAddr,
      daoAddr,
      agentAddr,
    ]);
    const moduleAddr = await module.getAddress();

    const key = poolKey(ZERO, usdcAddr);
    await (await module.connect(dao).setPool(key, true)).wait();

    const amountIn = ethers.parseEther("0.3");
    const amountOut = ethers.parseEther("50");
    await (await usdc.mint(poolAddr, amountOut)).wait();
    await (await agent.sendTransaction({ to: moduleAddr, value: amountIn })).wait();
    // ETH -> USDC is zeroForOne = true: amount0 is the native input.
    await (await pool.setNextDelta(-amountIn, amountOut)).wait();

    const deadline = await latestDeadline(chain);
    await (
      await module
        .connect(agent)
        .swap(swapRequest(key, true, amountIn, amountOut, deadline))
    ).wait();

    assert.equal(await pool.totalNativeSettled(), amountIn);
    assert.equal(await usdc.balanceOf(daoAddr), amountOut);
    assert.equal(await chain.nativeBalance(moduleAddr), 0n);
  });

  await t.test("DaoFactory wires the module and its agent policy", async () => {
    const pool = await deploy(artifacts, "MockPoolManager", deployer);
    const poolAddr = await pool.getAddress();
    const coreFactory = await deploy(artifacts, "DaoCoreFactory", deployer);
    const accountFactory = await deploy(artifacts, "AgentAccountFactory", deployer);
    const assetFactory = await deploy(artifacts, "AssetModuleFactory", deployer);
    const swapFactory = await deploy(artifacts, "DaoSwapModuleFactory", deployer, [
      poolAddr,
    ]);
    const factory = await deploy(artifacts, "DaoFactory", deployer, [
      await coreFactory.getAddress(),
      await accountFactory.getAddress(),
      await assetFactory.getAddress(),
      await swapFactory.getAddress(),
    ]);

    const adminAddr = await dao.getAddress();
    const signerAddr = await agent.getAddress();
    const cfg = [
      id(9401),
      adminAddr,
      signerAddr,
      true,
      86400,
      3,
      3600,
      5000,
    ];
    const receipt = await (await factory.createDao(cfg, [], [], [])).wait();
    const created = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "DaoCreated");
    assert.ok(created, "DaoCreated missing");

    const core = new ethers.Contract(
      created.args.daoCore,
      artifacts.DaoCore.abi,
      deployer
    );
    const account = new ethers.Contract(
      created.args.agentAccount,
      artifacts.AgentAccount.abi,
      deployer
    );
    const swapModuleAddr = await core.swapModule();
    assert.notEqual(swapModuleAddr, ZERO);
    assert.equal(
      (await core.proposalTargetAllowed(swapModuleAddr)),
      true
    );

    const module = new ethers.Contract(
      swapModuleAddr,
      artifacts.DaoSwapModule.abi,
      deployer
    );
    assert.equal(await module.poolManager(), poolAddr);
    assert.equal(await module.dao(), created.args.daoCore);
    assert.equal(await module.agentAccount(), created.args.agentAccount);

    const swapSelector = module.interface.getFunction("swap").selector;
    const setPoolSelector = module.interface.getFunction("setPool").selector;
    const aboveCapSelector = module.interface.getFunction("swapAboveCap").selector;
    assert.equal(await core.assetSelectorAllowed(swapSelector), false);
    assert.equal(await core.assetSelectorAllowed(setPoolSelector), true);
    assert.equal(await core.assetSelectorAllowed(aboveCapSelector), true);

    const rule = await account.rules(swapModuleAddr, swapSelector);
    assert.equal(rule.allowed, true);
    assert.equal(rule.tier, 1n);

    // The module is not a standing approver or holder.
    assert.equal(await module.poolAllowed(id(0)), false);
  });
});

test("T24 DaoSwapModule: tier-3 swap above the cap", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, alice] = chain.signers;
  const adminAddr = await admin.getAddress();
  const signerAddr = await agentSigner.getAddress();
  const aliceAddr = await alice.getAddress();

  const pool = await deploy(artifacts, "MockPoolManager", deployer);
  const poolAddr = await pool.getAddress();
  const mockAgent = await deploy(artifacts, "MockAgent", deployer);
  const agentAddr = await mockAgent.getAddress();
  const core = await deploy(artifacts, "DaoCore", deployer, [
    [id(9402), adminAddr, signerAddr, true, 86400, 3, 3600, 5000],
    await deployer.getAddress(),
  ]);
  const coreAddr = await core.getAddress();
  await (await core.initializeAgent(agentAddr)).wait();
  const module = await deploy(artifacts, "DaoSwapModule", deployer, [
    poolAddr,
    coreAddr,
    agentAddr,
  ]);
  const moduleAddr = await module.getAddress();
  await (await core.initializeSwapModule(moduleAddr)).wait();

  const tokenIn = await deploy(artifacts, "MockERC20", deployer, ["USDC", "USDC"]);
  const tokenOut = await deploy(artifacts, "MockERC20", deployer, ["RWA", "RWA"]);
  const inAddr = await tokenIn.getAddress();
  const outAddr = await tokenOut.getAddress();
  const { key, aIsC0 } = sortedKey(inAddr, outAddr);
  const zeroForOne = aIsC0;

  const amountIn = ethers.parseEther("250");
  const amountOut = ethers.parseEther("200");
  await (await tokenIn.mint(coreAddr, amountIn)).wait();
  await (await tokenOut.mint(poolAddr, amountOut)).wait();
  if (zeroForOne) {
    await (await pool.setNextDelta(-amountIn, amountOut)).wait();
  } else {
    await (await pool.setNextDelta(amountOut, -amountIn)).wait();
  }

  // Membership is required before a proposal can be created.
  await (
    await mockAgent.execute(
      coreAddr,
      core.interface.encodeFunctionData("addMembers", [[111n], [0n], id(0x2401)])
    )
  ).wait();

  const votePaymaster = await deploy(artifacts, "MockVotePaymaster", deployer);
  await (await core.connect(admin).setVotePaymaster(await votePaymaster.getAddress())).wait();

  let nullifier = 800n;
  const proposeAndExecute = async (target, data) => {
    await (
      await mockAgent.execute(
        coreAddr,
        core.interface.encodeFunctionData("createProposal", [
          target,
          data,
          0n,
          ethers.ZeroHash,
          ethers.ZeroHash,
        ])
      )
    ).wait();
    const proposalId = await core.proposalCount();
    nullifier += 1n;
    await (
      await votePaymaster.setConsumed(coreAddr, proposalId, nullifier, true)
    ).wait();
    await (await votePaymaster.setChoice(coreAddr, proposalId, nullifier, true)).wait();
    await (await core.connect(alice).castVote(proposalId, true, nullifier)).wait();
    await chain.increaseTime(3601);
    return core.connect(alice).executeProposal(proposalId);
  };

  await t.test("governance allowlists the pool through the module", async () => {
    await (
      await proposeAndExecute(
        moduleAddr,
        module.interface.encodeFunctionData("setPool", [key, true])
      )
    ).wait();
    const poolId = ethers.keccak256(
      abi.encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]]
      )
    );
    assert.equal(await module.poolAllowed(poolId), true);
  });

  await t.test("proposal pulls from the treasury, swaps and records ACTION_SWAP", async () => {
    const deadline = await latestDeadline(chain, 7200);
    const req = swapRequest(key, zeroForOne, amountIn, amountOut, deadline);
    const before = await tokenIn.balanceOf(coreAddr);

    const receipt = await (
      await proposeAndExecute(
        moduleAddr,
        module.interface.encodeFunctionData("swapAboveCap", [req])
      )
    ).wait();

    assert.equal(await tokenIn.balanceOf(coreAddr), before - amountIn);
    assert.equal(await tokenOut.balanceOf(coreAddr), amountOut);
    assert.equal(await tokenIn.balanceOf(moduleAddr), 0n);
    assert.equal(await tokenOut.balanceOf(moduleAddr), 0n);
    assert.equal(await pool.tokenSettled(inAddr), amountIn);

    // Above-cap swaps bypass the per-token cap: `spend` was not used.
    const cap = await core.tokenCaps(inAddr);
    assert.equal(cap.spent, 0n);

    const events = receipt.logs
      .map((log) => {
        try {
          return core.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((log) => log?.name === "ActionExecuted");
    const swapEvent = events.find((log) => log.args.actionType === 8n);
    assert.ok(swapEvent, "ACTION_SWAP audit event missing");
    assert.equal(swapEvent.args.tier, 3n);
    assert.equal(swapEvent.args.authorizer, coreAddr);
  });

  await t.test("only the module can pull or record", async () => {
    await expectRevert(
      () => core.connect(alice).pullForSwap.staticCall(inAddr, 1n),
      "not swap module"
    );
    await expectRevert(
      () =>
        core
          .connect(alice)
          .recordSwap.staticCall(id(1), 1n, 1n),
      "not swap module"
    );
  });
});
