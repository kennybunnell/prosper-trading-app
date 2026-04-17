/**
 * useAccountNicknames
 *
 * Returns a helper function `getAccountLabel(accountNumber)` that resolves
 * a raw Tastytrade account number (e.g. "5WZ77313") to its friendly nickname
 * (e.g. "Main Cash Account"). Falls back to the raw account number when no
 * nickname is stored.
 *
 * Usage:
 *   const getAccountLabel = useAccountNicknames();
 *   <Badge>{getAccountLabel("5WZ77313")}</Badge>  // → "Main Cash Account"
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export function useAccountNicknames(): (accountNumber: string) => string {
  const { data: accounts } = trpc.accounts.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // nicknames rarely change — cache for 5 min
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    if (accounts) {
      for (const acct of accounts as Array<{ accountNumber: string; nickname?: string | null }>) {
        if (acct.accountNumber) {
          map.set(acct.accountNumber, acct.nickname || acct.accountNumber);
        }
      }
    }
    return (accountNumber: string) => map.get(accountNumber) ?? accountNumber;
  }, [accounts]);
}
