# Likerts SDK behavior contract v1

This contract applies to Web, React Native, iOS, Android and Flutter. The executable policy and scenario identifiers live in [`../contracts/sdk-behavior.json`](../contracts/sdk-behavior.json). Platform tests consume that shared fixture.

## Validation and callbacks

Renderers provide immediate feedback for a missing required answer and for `minSelections` / `maxSelections` violations. They do not invoke their submit callback while local validation fails. This feedback improves the interaction; the service remains authoritative for every answer and returns structured HTTP errors through the client.

The Web renderer owns its network submission. `onComplete` runs once, only after decoding an accepted one-cent receipt. Cleanup cancels the active request and suppresses later completion. Native renderers emit a locally valid answer snapshot once per submit action; that callback does not mean the service accepted or charged the response. The host owns the async client call, displays server errors, supplies disabled/submitting state, and cancels its task when the containing screen is disposed.

Changing a collection identity starts a new renderer lifecycle. Renderers clear transient answers and validation feedback, or the host remounts them with the collection ID as the component key where the UI framework requires identity to be explicit.

## Transport

Clients require HTTPS. Plain HTTP is accepted only for the exact loopback hosts `localhost`, `127.0.0.1` and `::1` so a developer can run the local service. Base URLs containing credentials, queries or fragments are invalid. Clients reject redirects, use a 15-second default timeout, and expose platform-native cancellation. Closing a client cancels its owned transport resources.

There are no automatic SDK retries. A timeout, cancellation or connection loss is ambiguous because the service may have committed the response. The host retries only when appropriate and must reuse the same immutable `Submission`, including the idempotency key and payload. HTTP rejections are terminal for that attempt and are never reported as acceptance.

## Compatibility

The current 0.0.3 SDK fleet supports schema versions 1–5, as recorded in `contracts/sdk-compatibility.json`: baseline/expanded questions, conditional visibility, pages/branching, and advanced ranking/matrix/constant-sum questions. A version outside an installed SDK's declared support is rejected during collection decoding before rendering. Older artifacts retain their original capability records. Unknown JSON fields remain forward-compatible and are ignored. New behavior that changes stored answer meaning requires a new schema version and coordinated SDK capability work.

Each SDK exports its customer-declarable capability record: target, package version and supported schema versions. Management callers combine the records for every installed deployment group when publishing and creating a collection. The service rejects the operation when any declared group lacks the required schema version. These records are customer assertions used to prevent accidental rollout; they are not proof of the software actually installed on a respondent device.

Collection clients cache a successfully decoded configuration for five minutes per client instance. Call the platform's `refresh` option before presentation when the host requires a fresh revocation/configuration check, and clear the cache when ending the integration lifecycle. A refresh never falls back to stale data; failure evicts the entry. The SDK rejects a refreshed response if its collection ID, survey ID, published version or schema version differs from the original binding. Changing a survey creates and binds a new collection identity. Cached presentation cannot bypass server-side closure or revocation: every submission is checked by the service.

The behavior fixture names nine transport and interaction scenarios. `contracts/sdk-compatibility.json` records the common cache policy plus current and mixed old/new fleet declarations. Each platform suite consumes the fixtures and exercises its native mechanism rather than inferring runtime behavior from compilation alone.
