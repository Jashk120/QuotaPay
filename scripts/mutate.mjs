// Mutation runner: applies one source mutant, runs its target test file,
// reports KILLED (test failed as required) vs SURVIVED, then restores.
// Usage: node scripts/mutate.mjs [M1|M2|...|all]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "C:\\projects\\QuotaPay";
const mutants = {
  M1: { // remove owner gate on QPPV.setCredit -> T07 non-owner prong must fail
    file: "contracts/QuotaPayPreVerify.sol",
    test: "test/t07-access-gates.test.mjs",
    old: "function setCredit(address user, uint256 value) external onlyOwner {",
    new: "function setCredit(address user, uint256 value) external {",
  },
  M2: { // drop replay protection -> T03 replay prong must fail
    file: "contracts/CompanyPaymaster.sol",
    test: "test/t03-signed-enrollment.test.mjs",
    old: "        usedEnrollment[digest] = true;",
    new: "        // MUTANT: replay protection removed",
  },
  M3: { // drop high-s rejection -> T03 malleability prong must fail
    file: "contracts/CompanyPaymaster.sol",
    test: "test/t03-signed-enrollment.test.mjs",
    old: `        // Reject malleable (high-s) signatures.
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "bad s"
        );`,
    new: `        // MUTANT: high-s accepted`,
  },
  M4: { // drop reservation release on execute -> T04 accounting must fail
    file: "contracts/CompanyPaymaster.sol",
    test: "test/t04-withdrawal-lifecycle.test.mjs",
    old: "        req.amount = 0;\n        req.unlockAt = 0;\n        pendingWithdrawals -= amount;",
    new: "        req.amount = 0;\n        req.unlockAt = 0;\n        // MUTANT: reservation never released",
  },
  M5: { // drop duplicate-company guard -> T05 dup prong must fail
    file: "contracts/CompanyFactory.sol",
    test: "test/t05-factory-isolation.test.mjs",
    old: '        require(companies[cfg.companyId].paymaster == address(0), "company exists");',
    new: '        // MUTANT: duplicates allowed',
  },
  M6: { // drop factory authorization -> T05 unauthorized prong must fail
    file: "contracts/CompanyFactory.sol",
    test: "test/t05-factory-isolation.test.mjs",
    old: `        require(
            cfg.admin == msg.sender || (governance != address(0) && msg.sender == governance),
            "not authorized"
        );`,
    new: `        // MUTANT: open creation`,
  },
  M7: { // drop entrypoint gate on QPPV.charge -> T08 reason assertion must fail
    file: "contracts/QuotaPayPreVerify.sol",
    test: "test/t08-entrypoint-gate.test.mjs",
    old: '        require(msg.sender == address(0xaa), "not entrypoint");',
    new: '        // MUTANT: entrypoint gate removed',
  },
  M8: { // drop walletActive from isAuthorized -> T09 wallet-revoke prong must fail
    file: "contracts/CompanyPaymaster.sol",
    test: "test/t09-revocation.test.mjs",
    old: "        if (beneficiaryId == bytes32(0) || !walletActive[wallet]) return false;",
    new: "        if (beneficiaryId == bytes32(0)) return false; // MUTANT: walletActive ignored",
  },
  M9: { // drop withdrawal delay -> T04 early-execute prong must fail
    file: "contracts/CompanyPaymaster.sol",
    test: "test/t04-withdrawal-lifecycle.test.mjs",
    old: '        require(block.timestamp >= req.unlockAt, "not unlocked");',
    new: '        // MUTANT: no delay',
  },
  M10: { // drop zero-address guard on QPPV.withdraw (burn to 0x0 succeeds) -> T10 must fail
    file: "contracts/QuotaPayPreVerify.sol",
    test: "test/t10-custody.test.mjs",
    old: '        require(to != address(0), "zero address");',
    new: '        // MUTANT: zero address allowed',
  },
};

function suiteResult(out) {
  // node:test summary block: "pass N" / "fail N" lines (glyph-prefixed).
  const passes = [...out.matchAll(/pass (\d+)/g)].map((m) => parseInt(m[1], 10));
  const fails = [...out.matchAll(/fail (\d+)/g)].map((m) => parseInt(m[1], 10));
  const p = passes.length > 0 ? passes[passes.length - 1] : 0;
  const f = fails.length > 0 ? fails[fails.length - 1] : 0;
  return { p, f };
}
const which = process.argv[2] ?? "all";
const ids = which === "all" ? Object.keys(mutants) : [which];
const results = [];
for (const id of ids) {
  const m = mutants[id];
  if (!m) { console.log(`unknown mutant ${id}`); process.exit(1); }
  const fp = path.join(ROOT, m.file);
  const orig = fs.readFileSync(fp, "utf8");
  if (!orig.includes(m.old)) {
    results.push(`${id}: ERROR — anchor not found`);
    continue;
  }
  fs.writeFileSync(fp, orig.replace(m.old, m.new));
  const r = spawnSync("node", ["--test", m.test], { cwd: ROOT, timeout: 240000, encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const { p, f } = suiteResult(out);
  const passed = p > 0 && f === 0;
  results.push(`${id} (${m.file} :: ${m.test}): ${passed ? "SURVIVED — TEST VACUOUS" : "KILLED"}`);
  fs.writeFileSync(fp, orig); // restore
  // verify restoration
  const check = fs.readFileSync(fp, "utf8");
  if (check !== orig) results.push(`${id}: ERROR — restore failed`);
}
console.log(results.join("\n"));
