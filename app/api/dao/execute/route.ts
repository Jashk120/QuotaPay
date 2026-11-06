import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  isAddress,
  toFunctionSelector,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { Address as OxAddress, Secp256k1 } from "ox";
import { buildAgentActionFrameTx, signFrameTx } from "@/lib/daoFrameTx.mjs";
import {
  CHARGE_CALLDATA,
  sendFrameSponsoredTransfer,
  sendRawSponsoredTransfer,
} from "@/lib/devnetFrameTx";
import { agentAccountAbi, daoCoreAbi } from "@/lib/daoAbis.mjs";
import { config } from "@/lib/config";
import { executeMessage, EXECUTE_NONCE_WINDOW_MS } from "@/lib/dao/executeAuth";

/**
 * Server-side DAO execution.
 *
 * `DaoCore` write methods are `onlyAgent`, and the agent is a contract account
 * (`tx.sender`). A browser wallet cannot call them directly, so the console
 * posts the prepared calldata here and this route builds, signs and submits an
 * EIP-8141 frame transaction with the agent key. The key never reaches the
 * client.
 */

const ALLOWED_SELECTORS = new Set(
  [
    "spend(address,address,uint256,bytes32,bytes32)",
    "acquireAsset(bytes32,uint256)",
    "disposeAsset(bytes32,uint256,address,(uint256,uint256,bytes))",
    "setRole(uint256,uint8,(uint256,uint256,bytes))",
    "removeMember(uint256,bytes32,(uint256,uint256,bytes))",
    "addMembers(uint256[],uint256[],bytes32,(uint256,uint256,bytes))",
    "addMembersAuthorized(uint256[],uint256[],bytes32,(uint256,uint256,bytes))",
  ].map((signature) => toFunctionSelector(signature).toLowerCase()),
);

type Body = {
  to?: string;
  data?: string;
  actionType?: number;
  promptHash?: string;
  planHash?: string;
  address?: string;
  signature?: string;
  nonce?: string;
};

/** Replay guard for execute signatures. Process-local; a restart clears it. */
const usedSignatures = new Set<string>();

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const core = (process.env.DAO_CORE ?? config.daoCoreAddress) as Address | "";
  const paymaster = (process.env.DAO_GAS_PAYMASTER ??
    config.daoGasPaymaster) as Address | "";
  const agentKey = process.env.DAO_AGENT_KEY as Hex | undefined;
  const rpcUrl =
    process.env.DAO_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? config.rpcUrl;
  const chainId = Number(
    process.env.DAO_CHAIN_ID ??
      process.env.NEXT_PUBLIC_CHAIN_ID ??
      config.chainId,
  );

  if (!core || !isAddress(core)) return bad("DAO_CORE is not configured", 503);
  if (!paymaster || !isAddress(paymaster)) {
    return bad("DAO_GAS_PAYMASTER is not configured", 503);
  }
  if (!agentKey) return bad("DAO_AGENT_KEY is not configured", 503);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("invalid JSON body");
  }

  const to = body.to ?? "";
  const data = body.data ?? "";
  if (!isAddress(to) || to.toLowerCase() !== core.toLowerCase()) {
    return bad("call target is not the configured DaoCore");
  }
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length < 10) {
    return bad("calldata is missing or malformed");
  }
  const selector = data.slice(0, 10).toLowerCase();
  if (!ALLOWED_SELECTORS.has(selector)) {
    return bad(`selector ${selector} is not an allowed DAO write`, 403);
  }

  const client = createPublicClient({ transport: http(rpcUrl) });

  try {
    const [agentAccount, admin] = await Promise.all([
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "agentAccount",
      }) as Promise<Address>,
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "admin",
      }) as Promise<Address>,
    ]);

    const testMode =
      process.env.AGENT_TEST_MODE === "true" ||
      process.env.AGENT_TEST_MODE === "1";

    if (!testMode) {
      const address = body.address ?? "";
      const signature = body.signature ?? "";
      const nonce = body.nonce ?? "";
      if (!isAddress(address) || !/^0x[0-9a-fA-F]+$/.test(signature) || !nonce) {
        return bad("missing execute authorization", 401);
      }
      if (address.toLowerCase() !== admin.toLowerCase()) {
        return bad(
          `execute authorization is not from the DAO admin (${admin})`,
          403,
        );
      }
      const ts = Number(nonce);
      if (
        !Number.isFinite(ts) ||
        Math.abs(Date.now() - ts) > EXECUTE_NONCE_WINDOW_MS
      ) {
        return bad("stale execute authorization", 401);
      }
      if (usedSignatures.has(signature)) {
        return bad("replayed execute authorization", 401);
      }
      const valid = await verifyMessage({
        address: admin,
        message: executeMessage(to, data, nonce),
        signature: signature as Hex,
      });
      if (!valid) return bad("bad execute authorization", 401);
      usedSignatures.add(signature);
      if (usedSignatures.size > 1024) usedSignatures.clear();
    }

    const expectedSigner = (await client.readContract({
      address: agentAccount,
      abi: agentAccountAbi,
      functionName: "agentSigner",
    })) as Address;

    const derived = OxAddress.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: agentKey }),
    );

    if (derived.toLowerCase() !== expectedSigner.toLowerCase()) {
      return bad(
        `DAO_AGENT_KEY does not match AgentAccount.agentSigner (${expectedSigner})`,
        403,
      );
    }

    const nonce = await client.getTransactionCount({ address: agentAccount });

    const tx = buildAgentActionFrameTx({
      chainId,
      nonce: BigInt(nonce),
      agentAccount,
      agentSigner: derived,
      paymaster,
      chargeData: CHARGE_CALLDATA,
      calls: [
        {
          to: to as Address,
          data: data as Hex,
          // Admin actions (addMembers/removeMember/setRole) write several
          // storage slots and do an ECDSA recover; 350k was not enough.
          executionGas: 900_000n,
          stateGas: 900_000n,
        },
      ],
    });

    const signed = signFrameTx(tx, agentKey);

    let hash: Hex;
    try {
      // The alt-mempool validates the structured form. Its raw 0x06 envelope
      // path rejects the same transaction during validation-prefix simulation
      // (`StorageReadNonSender`), so structured submission is the working path
      // on this devnet.
      hash = await sendFrameSponsoredTransfer(rpcUrl, signed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/method|not supported|unsupported/i.test(message)) throw cause;
      hash = await sendRawSponsoredTransfer(rpcUrl, signed);
    }

    return NextResponse.json({
      ok: true,
      hash,
      actionType: body.actionType ?? 0,
      promptHash: body.promptHash ?? null,
      planHash: body.planHash ?? null,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return bad(message.slice(0, 500), 502);
  }
}
