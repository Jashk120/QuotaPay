import { DaoShell } from "@/components/dao/dao-shell";

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DaoShell>{children}</DaoShell>;
}
