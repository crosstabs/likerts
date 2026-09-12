# A working embedded feedback example

From the repository root:

```sh
bash scripts/run-feedback-demo.sh
```

Requires Rust stable and Node.js 22+ with npm. The script builds the API, CLI and current Web SDK, starts an isolated local API, creates and publishes a survey through the CLI, and serves the example at **http://127.0.0.1:4310**. The first build can take several minutes. Use `LIKERTS_DEMO_PORT=4312 bash scripts/run-feedback-demo.sh` if port 4310 is occupied.

1. Answer the question inside the fictional storefront.
2. Submit it. The SDK receives a real API receipt.
3. Select **Read it from the backend**. The operator view retrieves the stored answer and metadata through the API; compare the response ID with the receipt.
4. Press Ctrl+C in the terminal to stop both servers and clear the temporary responses.

This uses the actual Web SDK renderer and client, real CLI operations, real HTTP validation and the API's development memory store. There is no simulated transport. Data survives browser reloads while the process runs, but **does not survive shutdown**. PostgreSQL, production authentication, deployment, emails and payment are not part of this example.

The sample Node server keeps its freshly generated management credential server-side. Only the collection credential reaches the browser. Collection requests pass through a narrowly scoped same-origin proxy; the operator route only lists responses for this example's collection. Both servers bind to loopback. The proxy rejects other origins, and the API intentionally ignores existing database and Likerts runtime environment configuration. Do not expose this unauthenticated local operator example publicly or use its development authentication in production.

The sample order is fictional. No purchase is made. The default survey is in [`survey.json`](survey.json), the integration in [`app.js`](app.js), and local provisioning/proxy in [`server.mjs`](server.mjs).
