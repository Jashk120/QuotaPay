"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Link2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { daoSlug } from "@/lib/dao/slug";
import { useDaoState } from "@/lib/dao/use-dao";

/**
 * Invite codes are not an on-chain object. Membership is `DaoCore.addMembers`,
 * so claiming an invite is an admin-authorized transaction, not a local write.
 * Until that flow is wired, this page must not invent a member.
 */
export default function JoinDaoPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const { state, ready } = useDaoState();
  const chatHref = `/dao/${daoSlug(state.config.name)}/chat`;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Invite</Badge>
          <Badge variant="secondary" className="font-mono">
            {code || "—"}
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {ready ? `Join ${state.config.name}` : "Join a DAO"}
        </h1>
      </div>

      <Alert variant="warning" title="Invite claiming is not on-chain yet">
        Membership lives in <span className="font-mono">DaoCore</span> as a
        commitment added by an <span className="font-mono">addMembers</span>{" "}
        transaction. This page does not submit that transaction, so it creates no
        local member and no fake event.
      </Alert>

      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
              <Link2 className="h-4 w-4 text-yellow-800" />
            </div>
            <p className="text-sm text-muted-foreground">
              Ask the DAO admin to add your commitment on-chain, then open the
              console to see your membership.
            </p>
          </div>
          <Button asChild>
            <Link href={chatHref}>
              Open console <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
