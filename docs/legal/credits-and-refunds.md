# Response credits and refunds

**Pre-launch draft for owner/legal review — not effective. Stripe evidence is currently sandbox/test mode.**

## What you pay for

Opening an eligible verified workspace is free and requires no card. It receives one nonrenewing grant of **1,000 accepted responses**. Thereafter, an accepted response costs **US$0.01 from prepaid credits**. The minimum purchase is **US$5 for 500 response credits**. This is usable balance, not a setup fee. There is no subscription or monthly minimum purchase.

An accepted response is a submission the server successfully validates and durably records with its acceptance receipt. Invalid or rejected submissions and identical retries of an already accepted submission consume no additional credit. One response can contain multiple answers; the unit is the accepted submission, not each question. A new retry key can represent a separate submission, so preserve the original key and payload after an uncertain network result.

Promotional credit is used before paid credit. Grants belong to the workspace, have no cash value and cannot be withdrawn, transferred or recreated by deleting/reopening an account. Multiple signups must not be used to obtain repeated grants.

## Purchases and balance

A workspace owner explicitly opens hosted checkout. A purchase adds paid credits only after payment is confirmed. Repeated payment notifications do not add the same purchase twice. Automatic top-up is not included in the current launch offer; no automatic charge should be inferred from holding an account.

When usable balance reaches zero, new responses pause. Authorized access to existing results, exports and eligible prior receipts continues subject to retention, expiry and revocation. Configured limits or a payment-adjustment debt can also pause acceptance; the usage endpoint reports the reason. [VERIFY: finalize and test the planned 80/90/100% balance notifications before promising delivery.]

[OWNER: state tax-inclusive/exclusive pricing, invoice/merchant identity, supported purchase countries/currencies, paid-credit expiry or no-expiry, and notice/treatment of future price changes. No expiry window has been invented.]

## Requesting a refund

Contact [OWNER: billing contact] from the verified owner account with the workspace ID, purchase reference, amount and reason. Never send card numbers, security codes, passwords or access tokens. We may verify account authority before handling the request.

[OWNER: choose and publish refund eligibility, request window, handling target, treatment of partially used purchases and unused credits when a workspace closes. Preserve all nonwaivable statutory rights applicable to eligible customers. Do not publish this section until those decisions are complete.]

Approved refunds are initiated through the payment provider against the original purchase. Stripe normally returns refunds to the original payment method; bank processing and failed/pending states can affect receipt, so a fixed arrival date is not promised. [Stripe refund documentation](https://docs.stripe.com/refunds)

Refunding a purchase removes the corresponding paid credits. Promotional credits cannot be exchanged for cash. A refund or dispute involving credits already consumed can create a paid-credit debt and pause further acceptance, including promotional acceptance, until reconciled. This ledger state does not itself authorize another charge to your payment method. Previously accepted response records and gross usage remain in history.

Payment disputes and reversals are reconciled against provider state to avoid duplicate credits or deductions. Contact support if the displayed balance appears wrong. Deleting raw responses does not reverse valid usage or create a refund entitlement.

## Launch review note

A hosted test payment of US$5 credited 500 responses exactly once. A successful full test refund returned paid credits to zero while leaving 1,000 promotional credits unchanged. This verifies one sandbox flow; it does not establish live merchant availability, tax configuration or an approved commercial refund policy.
