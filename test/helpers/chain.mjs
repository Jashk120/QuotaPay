// Fresh in-process chain + deploy helpers. One chain per test file.
import ganache from "ganache";
import { ethers } from "ethers";

export async function newChain() {
  const gp = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337 },
    wallet: { totalAccounts: 10 },
  });
  const provider = new ethers.BrowserProvider(gp);
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const network = await provider.getNetwork();
  return {
    gp,
    provider,
    signers,
    chainId: network.chainId,
    async increaseTime(seconds) {
      await gp.request({ method: "evm_increaseTime", params: [seconds] });
      await gp.request({ method: "evm_mine", params: [] });
    },
  };
}

export async function deploy(artifacts, name, signer, args = [], value = 0n) {
  const { abi, bytecode } = artifacts[name];
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args, value === 0n ? {} : { value });
  await contract.waitForDeployment();
  return contract;
}

/// Expect the thunked call to revert with a reason containing `substr`.
/// Thunks must use `.staticCall(...)` so the revert reason is returned via
/// eth_call (ethers' estimateGas path on ganache drops revert data).
/// Returns the error string for documentation.
export async function expectRevert(thunk, substr) {
  try {
    await thunk();
  } catch (e) {
    if (e && e.message && e.message.startsWith("expected revert")) throw e;
    const msg = String(e?.message ?? e) + (e?.reason ? ` [reason=${e.reason}]` : "");
    if (substr && !msg.includes(substr)) {
      throw new Error(`reverted, but reason mismatch.\n  want substring: ${substr}\n  got: ${msg.slice(0, 500)}`);
    }
    return msg;
  }
  throw new Error(`expected revert${substr ? ` (${substr})` : ""}, but call succeeded`);
}

export const b32 = (s) => ethers.encodeBytes32String(s).slice(0, 66);
export const id = (n) => "0x" + n.toString(16).padStart(64, "0");
