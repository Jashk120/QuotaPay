// Fix-validation: applies the RECOMMENDED fix for a failing test, runs it
// (expect PASS), then reverts. Proves the failing tests fail for the
// targeted reason and are sensitive to the invariant.
// Usage: node scripts/fixvalidate.mjs [F1|F2|F3|all]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "C:\\projects\\QuotaPay";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const write = (f, c) => fs.writeFileSync(path.join(ROOT, f), c);

const fixes = {
  F1: { // T01: unlink stale wallet/beneficiary on (re)enrollment
    test: "test/t01-rotation-unlink.test.mjs",
    edits: [{
      file: "contracts/CompanyPaymaster.sol",
      old: "    // Per-transaction charge binding.\n    mapping(address => bytes32) public chargedHash;",
      new: "    // Per-transaction charge binding.\n    mapping(address => bytes32) public chargedHash;\n    // FIX-VALIDATION ONLY: current wallet per beneficiary.\n    mapping(bytes32 => address) public beneficiaryWallet;",
    }, {
      file: "contracts/CompanyPaymaster.sol",
      old: `        require(beneficiaryId != bytes32(0), "beneficiary=0");
        require(wallet != address(0), "wallet=0");
`,
      new: `        require(beneficiaryId != bytes32(0), "beneficiary=0");
        require(wallet != address(0), "wallet=0");

        // FIX-VALIDATION ONLY: unlink stale associations.
        address prevWallet = beneficiaryWallet[beneficiaryId];
        if (prevWallet != address(0) && prevWallet != wallet) {
            walletActive[prevWallet] = false;
            walletBeneficiary[prevWallet] = bytes32(0);
        }
        bytes32 priorBeneficiary = walletBeneficiary[wallet];
        if (priorBeneficiary != bytes32(0) && priorBeneficiary != beneficiaryId) {
            beneficiaries[priorBeneficiary].active = false;
        }
        beneficiaryWallet[beneficiaryId] = wallet;
`,
    }],
  },
  F2: { // T02: authorized implies chargeable — enforce in the view
    test: "test/t02-dead-beneficiary.test.mjs",
    edits: [{
      file: "contracts/CompanyPaymaster.sol",
      old: `        Beneficiary storage b = beneficiaries[beneficiaryId];
        return b.active && (b.expiry == 0 || block.timestamp <= uint256(b.expiry));`,
      new: `        Beneficiary storage b = beneficiaries[beneficiaryId];
        if (b.perPeriodLimit < creditPerTx) return false; // FIX-VALIDATION ONLY
        return b.active && (b.expiry == 0 || block.timestamp <= uint256(b.expiry));`,
    }],
  },
  F3: { // T06: config must preserve liveness
    test: "test/t06-config-liveness.test.mjs",
    edits: [{
      file: "contracts/QuotaPayPreVerify.sol",
      old: `        userCap = userCap_;
        globalCap = globalCap_;
        txFee = txFee_;`,
      new: `        require(txFee_ > 0, "fee=0"); // FIX-VALIDATION ONLY
        require(userCap_ > 0 && globalCap_ > 0, "caps=0"); // FIX-VALIDATION ONLY
        userCap = userCap_;
        globalCap = globalCap_;
        txFee = txFee_;`,
    }, {
      file: "contracts/QuotaPayPreVerify.sol",
      old: `    function setTxFee(uint256 txFee_) external onlyOwner {
        txFee = txFee_;`,
      new: `    function setTxFee(uint256 txFee_) external onlyOwner {
        require(txFee_ > 0, "fee=0"); // FIX-VALIDATION ONLY
        txFee = txFee_;`,
    }, {
      file: "contracts/QuotaPayPreVerify.sol",
      old: `    function setCaps(uint256 userCap_, uint256 globalCap_) external onlyOwner {
        require(globalCap_ >= totalSpent, "global below spent");`,
      new: `    function setCaps(uint256 userCap_, uint256 globalCap_) external onlyOwner {
        require(globalCap_ >= totalSpent, "global below spent");
        require(userCap_ > 0 && globalCap_ > 0, "caps=0"); // FIX-VALIDATION ONLY`,
    }, {
      file: "contracts/CompanyPaymaster.sol",
      old: `        require(limit >= companySpent, "limit below spent");`,
      new: `        require(limit >= companySpent, "limit below spent");
        require(limit > 0, "limit=0"); // FIX-VALIDATION ONLY`,
    }, {
      file: "contracts/CompanyFactory.sol",
      old: `        require(companies[cfg.companyId].paymaster == address(0), "company exists");`,
      new: `        require(companies[cfg.companyId].paymaster == address(0), "company exists");
        require(msg.value >= cfg.maxSponsorCost, "underfunded"); // FIX-VALIDATION ONLY`,
    }],
  },
};

const which = process.argv[2] ?? "all";
const ids = which === "all" ? Object.keys(fixes) : [which];

function suiteResult(out) {
  const passes = [...out.matchAll(/pass (\d+)/g)].map((m) => parseInt(m[1], 10));
  const fails = [...out.matchAll(/fail (\d+)/g)].map((m) => parseInt(m[1], 10));
  const p = passes.length > 0 ? passes[passes.length - 1] : 0;
  const f = fails.length > 0 ? fails[fails.length - 1] : 0;
  return { p, f };
}
for (const id of ids) {
  const f = fixes[id];
  const backups = new Map();
  try {
    for (const e of f.edits) {
      if (!backups.has(e.file)) backups.set(e.file, read(e.file));
      const cur = read(e.file);
      if (!cur.includes(e.old)) throw new Error(`anchor not found in ${e.file}`);
      write(e.file, cur.replace(e.old, e.new));
    }
    const r = spawnSync("node", ["--test", f.test], { cwd: ROOT, timeout: 240000, encoding: "utf8" });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const { p: npass, f: nfail } = suiteResult(out);
    const passed = npass > 0 && nfail === 0;
    console.log(`${id} (${f.test}): ${passed ? "PASS-WITH-FIX (sensitive, fails for the right reason)" : "STILL-FAILING — investigate"}`);
    if (!passed) {
      const lines = out.split("\n").filter((l) => /AssertionError|BUG|Error:/.test(l)).slice(0, 8);
      console.log(lines.join("\n"));
    }
  } finally {
    for (const [file, content] of backups) write(file, content);
  }
}
// confirm restoration
console.log("contracts restored");
