import type { partner as ru } from "../ru/partner";

export const partner: Record<keyof typeof ru, string> = {
  "partner.yours": "This is your service, you can't buy it.",
  "partner.closed": "Sales are closed right now.",
  "partner.soldOut": "Sold out.",
  "partner.needLevel": "Level {minLevel} required.",
  "partner.noTon": "Not enough TON: need {price}, balance {myBalance}.",
  "partner.purchase": "Purchase",
  "partner.bought": "bought",
  "partner.available": "available",
  "partner.unavailable": "unavailable",
  "partner.paid": "Paid from your balance. The partner has been paid, details are in your wallet history.",
  "partner.note": "The amount is taken from your in-app balance and goes straight to the partner.",
  "partner.paying": "Paying…",
  "partner.buyFor": "Buy for {price} TON",
  "partner.buyerPays": "Buyer pays",
  "partner.partnerGets": "Partner gets",
  "partner.fee": "Fee",
  "partner.fromBalance": "from in-app balance",
  "partner.feePct": "{commissionBp}% to the platform",
};
