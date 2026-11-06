// Compile QuotaPay contracts with solc-js. Cached by source hash so
// mutation re-runs only recompile when sources actually changed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const ROOT = "C:\\projects\\QuotaPay";
const HEGOTA = "C:\\projects\\poolframes\\workshop\\node_modules\\@forshtat\\hegota-support";
const CACHE = new URL("./.artifacts-cache.json", import.meta.url);

const LOCAL_SOURCES = {
  "CompanyPaymaster.sol": "contracts/CompanyPaymaster.sol",
  "CompanyFactory.sol": "contracts/CompanyFactory.sol",
  "BlindTokenPaymaster.sol": "contracts/BlindTokenPaymaster.sol",
  "ZkPaymaster.sol": "contracts/ZkPaymaster.sol",
  "Groth16Verifier.sol": "contracts/zk/Groth16Verifier.sol",
  "QuotaPayPreVerify.sol": "contracts/QuotaPayPreVerify.sol",
  "CompanyTypes.sol": "contracts/libraries/CompanyTypes.sol",
  "IStakingRegistry.sol": "contracts/interfaces/IStakingRegistry.sol",
  "mocks.sol": "test/helpers/mocks.sol",
};

export function loadSources(extra = {}) {
  const sources = {};
  for (const [name, rel] of Object.entries({ ...LOCAL_SOURCES, ...extra })) {
    sources[name] = { content: fs.readFileSync(path.join(ROOT, rel), "utf8") };
  }
  return sources;
}

function findImports(importPath, importer) {
  // Remap the npm package import to the workshop's installed copy.
  if (importPath.startsWith("@forshtat/hegota-support/")) {
    const rel = importPath.slice("@forshtat/hegota-support/".length);
    const full = path.join(HEGOTA, rel);
    return { contents: fs.readFileSync(full, "utf8") };
  }
  // Solc canonicalizes "./libraries/X.sol" to "libraries/X.sol", so resolve
  // relative imports against the importer's directory and both source roots.
  const candidates = [];
  if (importer) {
    const importerDir = importer.includes("/")
      ? importer.slice(0, importer.lastIndexOf("/"))
      : "";
    if (importerDir) {
      candidates.push(path.join(ROOT, "contracts", importerDir, importPath));
      candidates.push(path.join(HEGOTA, "contracts", importerDir, importPath));
    }
  }
  candidates.push(path.join(ROOT, "contracts", importPath));
  candidates.push(path.join(HEGOTA, "contracts", importPath));
  candidates.push(path.join(ROOT, importPath));
  for (const c of candidates) {
    const norm = path.normalize(c);
    if (fs.existsSync(norm)) return { contents: fs.readFileSync(norm, "utf8") };
  }
  return { error: `unresolved import ${importPath} from ${importer}` };
}

export function compileAll() {
  const sources = loadSources();
  const hash = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex");

  if (fs.existsSync(CACHE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      if (cached.hash === hash) return cached.artifacts;
    } catch {
      /* recompile */
    }
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (output.errors) {
    const fatal = output.errors.filter((e) => e.severity === "error");
    if (fatal.length > 0) {
      throw new Error("solc errors:\n" + fatal.map((e) => e.formattedMessage).join("\n"));
    }
  }
  const artifacts = {};
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, c] of Object.entries(contracts)) {
      artifacts[name] = {
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object,
        deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      };
    }
  }
  for (const need of [
    "CompanyPaymaster",
    "CompanyFactory",
    "QuotaPayPreVerify",
    "BlindTokenPaymaster",
    "ZkPaymaster",
    "Groth16Verifier",
    "MockRegistry",
    "RevertingTreasury",
  ]) {
    if (!artifacts[need] || !artifacts[need].bytecode || artifacts[need].bytecode === "0x") {
      throw new Error(`missing bytecode for ${need}`);
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify({ hash, artifacts }));
  return artifacts;
}

