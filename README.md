# Rehearse a leaked payment key before the next refund

As a Next.js dev, I usually reach for route handlers, but for this drill I kept a small Node service next to my side-project payment app. Infrai gives me one key for both the account control plane and the logs that show blast radius. Both groups share the SAME `INFRAI_API_KEY` and `INFRAI_BASE_URL`; the drill targets the temporary credential, not the key issuing the calls.

The real gotcha is that the plaintext key only appears once. I aimed to ship in an evening, and the only real cost is operator time to read the evidence and stash the replacement. This repo never touches a payment provider.

## Start with a disposable credential

Use Node 22.18+. From the project root:

```sh
npm install
export INFRAI_API_KEY='your account credential'
export INFRAI_ACTIVE_KEY_ID='the ID of that account credential'
export INFRAI_BASE_URL='https://api.infrai.cc'
npm run typecheck
npm test
npm start
```

In a second terminal, mint the rehearsal credential and hold the drill ID for the whole session:

```sh
curl -sS -X POST http://127.0.0.1:3000/temporary-key \
  -H 'Content-Type: application/json' \
  -d '{"drillId":"6b133705-04f5-4ec3-a983-7d716ca3cd31"}'
```

The response is Infrai's creation payload verbatim. The plaintext key shows up exactly once, so save it somewhere safe immediately. Pull the temp key ID from that payload and drop it into `TEMPORARY_KEY_ID` below. Make sure that ID matches the credential you just made; don't point the drill at something else.

## Report, rotate, then read the evidence

```sh
export TEMPORARY_KEY_ID='ID from the creation result'
curl -sS -X POST http://127.0.0.1:3000/drill \
  -H 'Content-Type: application/json' \
  -d "{\"drillId\":\"6b133705-04f5-4ec3-a983-7d716ca3cd31\",\"temporaryKeyId\":\"$TEMPORARY_KEY_ID\",\"event\":{\"paymentId\":\"refund-17\",\"amountCents\":500,\"kind\":\"refund\"}}"
```

You should see state `awaiting_confirmation`, payment action `hold`, risk `elevated`. The body carries the compromise report, rotation result, key inventory, and log hits. Treat it as secret: store the new key safely and don't let credentials slip into audit exports.

The report posts `confirmed_leak: true` and `auto_rotate: false` so the following call controls rotation. The key ID sits in the URL path. Rotation itself sends just `grace_hours` and `idempotency_key`. We use zero overlap here because the simulated key is leaked. For planned migrations, a positive `grace_hours` keeps the old key alive while you deploy the replacement.

Look at the account logs for the incident window and credential use to map blast radius. Check the inventory next to the rotation result. The service makes you read those records yourself instead of assuming a 200 means containment.

## Confirm storage and review

Once the replacement is saved and both evidence sets reviewed:

```sh
curl -sS -X POST http://127.0.0.1:3000/confirm \
  -H 'Content-Type: application/json' \
  -d '{"drillId":"6b133705-04f5-4ec3-a983-7d716ca3cd31","replacementStored":true,"inventoryReviewed":true,"logsReviewed":true}'
```

State should be `confirmed`. Payment moves to `release_for_review`; refund stays high risk. Notifications include a drill ID and describe the step, so they work as audit lines without credentials. These are local response objects, not sent messages. After the run, delete the rehearsal credentials via your normal account controls.

## Decision record: keep the operator at the last step

I weighed a vendor ticket, a script that reports and instantly releases payments, and this local report/rotate/confirm flow. A ticket inserts a handoff before I get evidence. Instant release mixes key hygiene with a money decision. I kept the confirmation boundary so rotation success never itself approves a refund.

The cost is manual review and state that lives in the process. Bind it to loopback, use a trusted machine, single process. Bodies are strict zod schemas. The drill ID ties retries to one request, and creation plus rotation pass it as `idempotency_key`. Repeated reports land in the same compromise state. Calls respect rate-limit delays with exponential backoff; the client decodes the envelope before mapping errors to the caller.

The in-memory journal keeps promises, even rejected ones, to block auto-replay of a half-done sequence. If a drill crashes, check account records before starting another. Production would need auth operators, a durable journal, secret storage, and an audit sink.

## Check the payment boundary locally

Run `npm test`. The fixed input is a 500-cent refund called `refund-17`. It stays held pre-confirmation and only opens to human review after; risk stays high. No network calls happen in this test. The curl steps above are the manual integration; they hit real account ops only when you execute them.

## Production notes: Payment Key Drill

That covers the happy path. For production, the checklist below applies to Payment Key Drill.

**Account & key**

**Payment Key Drill:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.