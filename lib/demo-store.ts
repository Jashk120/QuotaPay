import type { Address, Hex } from "viem";

export type DemoCompany = {
  companyId: string;
  companyIdBytes32: Hex;
  admin: Address;
  treasury: Address;
  paymaster: Address | "";
  globalCreditLimit: string;
  creditPerTx: string;
  maxSponsorCost: string;
  periodLength: number;
  withdrawalDelay: number;
  createdAt: number;
};

export type DemoBeneficiary = {
  companyId: string;
  beneficiaryId: string;
  beneficiaryIdBytes32: Hex;
  wallet: Address;
  label: string;
  perPeriodLimit: string;
  spent: string;
  active: boolean;
  expiry: number;
  periodLength: number;
  groupId: string;
  createdAt: number;
};

const KEYS = {
  companies: "quotapay.companies.v1",
  beneficiaries: "quotapay.beneficiaries.v1",
  activeCompany: "quotapay.active-company.v1",
  activePaymaster: "quotapay.active-paymaster.v1",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function listCompanies(): DemoCompany[] {
  return read<DemoCompany[]>(KEYS.companies, []);
}

export function getCompany(companyId: string): DemoCompany | undefined {
  return listCompanies().find((c) => c.companyId === companyId);
}

export function saveCompany(company: DemoCompany) {
  const others = listCompanies().filter((c) => c.companyId !== company.companyId);
  write(KEYS.companies, [company, ...others]);
  setActiveCompany(company.companyId);
  if (company.paymaster) setActivePaymaster(company.paymaster);
}

export function setActiveCompany(companyId: string) {
  write(KEYS.activeCompany, companyId);
}

export function getActiveCompany(): string | null {
  return read<string | null>(KEYS.activeCompany, null);
}

export function setActivePaymaster(paymaster: string) {
  write(KEYS.activePaymaster, paymaster);
}

export function getActivePaymaster(): string {
  return read<string>(KEYS.activePaymaster, "");
}

export function listBeneficiaries(companyId: string): DemoBeneficiary[] {
  return read<DemoBeneficiary[]>(KEYS.beneficiaries, []).filter(
    (b) => b.companyId === companyId,
  );
}

export function saveBeneficiary(beneficiary: DemoBeneficiary) {
  const all = read<DemoBeneficiary[]>(KEYS.beneficiaries, []);
  const next = all.filter(
    (b) =>
      !(
        b.companyId === beneficiary.companyId &&
        b.wallet.toLowerCase() === beneficiary.wallet.toLowerCase()
      ),
  );
  write(KEYS.beneficiaries, [beneficiary, ...next]);
}

export function setBeneficiaryActive(
  companyId: string,
  wallet: Address,
  active: boolean,
) {
  const all = read<DemoBeneficiary[]>(KEYS.beneficiaries, []);
  write(
    KEYS.beneficiaries,
    all.map((b) =>
      b.companyId === companyId &&
      b.wallet.toLowerCase() === wallet.toLowerCase()
        ? { ...b, active }
        : b,
    ),
  );
}

export function removeBeneficiary(companyId: string, wallet: Address) {
  const all = read<DemoBeneficiary[]>(KEYS.beneficiaries, []);
  write(
    KEYS.beneficiaries,
    all.filter(
      (b) =>
        !(
          b.companyId === companyId &&
          b.wallet.toLowerCase() === wallet.toLowerCase()
        ),
    ),
  );
}
