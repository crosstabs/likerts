# Demonstration recording

[`embedded-feedback-demo.webm`](../../control-plane/public/media/embedded-feedback-demo.webm) is a 40.4-second, 1440×1000 recording of Chromium running this example on September 12, 2026. It has no audio. A [poster](../../control-plane/public/media/embedded-feedback-poster.png) and [English captions](../../control-plane/public/media/embedded-feedback-demo.vtt) are included.

The recording shows an empty operator view, a rating and comment submitted through the current Web SDK, an accepted API receipt, and an API read that returns the same response ID with the submitted answers and metadata. The final refresh reads the same record. Browser interactions were driven with Playwright; this is not a recording of Codex or Claude controlling the platform.

The API runs locally with its development memory store. The response is real and retrievable while the process runs, but is not durably stored in PostgreSQL and does not survive shutdown. The storefront and order are fictional. No external account, hosted production API, payment or email is involved.

To reproduce the interaction, run `bash scripts/run-feedback-demo.sh`, open the printed loopback URL, inspect the empty operator view, return to the customer view, select **5 — Very easy**, add a comment, submit, and choose **Read it from the backend**. The response identifiers will differ on every run.
