import { createWalletClient, createPublicClient, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export interface SettlementItem {
  id: string;
  amount: number;
  type: "usage" | "card";
}

export interface SettlementPayload {
  version: 1;
  timestamp: number;
  total: number;
  userId: string;
  items: SettlementItem[];
}

const SETTLEMENT_PRIVATE_KEY = process.env.METER_SETTLEMENT_PRIVATE_KEY;
const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export async function batchSettle(
  userId: string,
  items: SettlementItem[],
  total: number
): Promise<string> {
  if (!SETTLEMENT_PRIVATE_KEY) {
    console.warn("METER_SETTLEMENT_PRIVATE_KEY not set, generating mock tx hash");
    const mockHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
    return mockHash;
  }

  const account = privateKeyToAccount(SETTLEMENT_PRIVATE_KEY as `0x${string}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  const payload: SettlementPayload = {
    version: 1,
    timestamp: Date.now(),
    total,
    userId,
    items,
  };

  const calldata = toHex(JSON.stringify(payload));

  const hash = await walletClient.sendTransaction({
    to: account.address,
    value: BigInt(0),
    data: calldata,
  });

  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  return hash;
}
