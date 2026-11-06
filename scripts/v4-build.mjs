#!/usr/bin/env node
/**
 * Build the vendored Uniswap v4 contracts with the canonical v4 settings.
 *
 * Sources live under contracts/uniswap/ and are pinned in that directory's
 * README. The DAO build keeps using solc 0.8.28 + shanghai; this script uses the
 * separate `solc826` alias (solc 0.8.26) because v4-core pins 0.8.26 exactly.
 *
 *   node scripts/v4-build.mjs
 *
 * Output: build/v4/{PoolManager,StateView}.json + build/v4/sizes.json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc826");

const VENDOR = path.resolve("contracts/uniswap");
const OUT = path.resolve("build/v4");

// Canonical v4 settings (v4-core/foundry.toml).
const SETTINGS = {
  evmVersion: "cancun",
  viaIR: true,
  optimizer: { enabled: true, runs: 44_444_444 },
  metadata: { bytecodeHash: "none" },
};

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith(".sol")) files.push(full);
  }
  return files;
}

function sourceKey(file) {
  const rel = path.relative(VENDOR, file).replaceAll("\\", "/");
  // Core internal imports are relative, so keeping the canonical package name
  // as the prefix lets StateView's `@uniswap/v4-core/src/...` imports resolve.
  if (rel.startsWith("v4-core/")) return `@uniswap/${rel}`;
  return rel;
}

function collectSources() {
  const sources = {};
  for (const file of walk(VENDOR)) {
    sources[sourceKey(file)] = { content: fs.readFileSync(file, "utf8") };
  }
  return sources;
}

function compile() {
  const input = {
    language: "Solidity",
    sources: collectSources(),
    settings: {
      ...SETTINGS,
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length > 0) {
    throw new Error(
      "solc errors:\n" + fatal.map((e) => e.formattedMessage).join("\n"),
    );
  }
  return output;
}

function pick(output, source, name) {
  const contract = output.contracts?.[source]?.[name];
  if (!contract) throw new Error(`missing ${name} in ${source}`);
  const bytecode = "0x" + contract.evm.bytecode.object;
  const deployedBytecode = "0x" + contract.evm.deployedBytecode.object;
  return {
    name,
    source,
    abi: contract.abi,
    bytecode,
    deployedBytecode,
    runtimeSize: (deployedBytecode.length - 2) / 2,
  };
}

function main() {
  const started = Date.now();
  const output = compile();
  const artifacts = {
    PoolManager: pick(
      output,
      "@uniswap/v4-core/src/PoolManager.sol",
      "PoolManager",
    ),
    StateView: pick(
      output,
      "v4-periphery/src/lens/StateView.sol",
      "StateView",
    ),
    V4PoolSeeder: pick(
      output,
      "v4-seeder/V4PoolSeeder.sol",
      "V4PoolSeeder",
    ),
  };

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, artifact] of Object.entries(artifacts)) {
    fs.writeFileSync(
      path.join(OUT, `${name}.json`),
      JSON.stringify(artifact, null, 2) + "\n",
    );
  }
  const sizes = Object.fromEntries(
    Object.entries(artifacts).map(([name, a]) => [
      name,
      { runtimeSize: a.runtimeSize, eip170Headroom: 24_576 - a.runtimeSize },
    ]),
  );
  fs.writeFileSync(
    path.join(OUT, "sizes.json"),
    JSON.stringify(
      {
        solc: "0.8.26",
        settings: SETTINGS,
        sizes,
        builtAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(JSON.stringify(sizes, null, 2));
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (artifact.runtimeSize > 24_576) {
      throw new Error(
        `${name} is ${artifact.runtimeSize} bytes, over the EIP-170 limit`,
      );
    }
  }
  console.log(`wrote ${OUT}`);
}

main();
