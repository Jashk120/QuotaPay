"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { BlindTokenIssuer } from "@/components/blind-token-issuer";

export default function BlindPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Privacy · blind token issuer</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Session-bound blind tokens
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The paymaster never learns the beneficiary. The company blind-signs a
          token; the user unblinds it and redeems it once, bound to the rotating
          session key and a persistent nullifier.
        </p>
      </div>

      <Alert variant="warning" title="Demo trust boundary">
        This page runs the issuer and the holder in one browser to demonstrate
        the protocol. In production the company backend holds the RSA private
        key and only ever sees the blinded value; the user&apos;s browser blinds
        and unblinds.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Issue a token</CardTitle>
          <CardDescription>
            The same flow is embedded on the pay page; you should not need this
            page in normal use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BlindTokenIssuer />
        </CardContent>
      </Card>
    </div>
  );
}
