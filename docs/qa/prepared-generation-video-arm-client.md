# Private video arm client checkpoint

This is a native-client handoff, not the final API-54 or protected-sink delivery.
The API/schema/store/producer remain separate work in progress. IPC/preload public
execution arguments are unchanged. Callers must keep missing cache/local/claim
capabilities closed before any prerequisite provider request.

The private facts client now provides:

`armVideo(projectId, executionId, targetKey, slotIndex, takeId, rawBodySha256, account, current)`

It posts only to the fixed loopback execution's `video-arm` route and requires the
exact `{arm_id}` response, returning that private ID. An ambiguous response is
WRITE_UNCONFIRMED. An arm pins one body, not permission to issue a provider POST.
The API's actual transport gate claims the arm independently; callers must not
invent a native/public claim API or treat an arm as a successful video.

`createStoryFilmClient.create` retains its old parameters and gains a fifth,
main-only optional adapter: `{arm(rawBody): Promise<{armId, current}>}`. The original
still validation and serialization run first, preserving actual regenerate behavior.
The adapter receives those exact raw bytes. After it resolves, the client checks
current account/owner, signs a v2 attestation binding arm, raw body, bearer, account,
request key and expiry, checks current again synchronously, then fetches. No await
is inserted after the final check. Old callers retain v1 signatures and synchronous
input validation. The arm and account facts never enter the renderer DTO, project,
history, archive, or provider request body.

Native validation: original story client, account policy client, private facts client
and new prepared-wire client run together (4 files / 48 tests). They cover exact
Chinese/empty wire HMAC, regenerate, exact arm ACK, asynchronous arm retirement with
zero final fetch, and the unchanged original request behavior. Formal desktop types,
target lint and format are checked at this checkpoint. No new external provider,
member call, full package or Windows execution is claimed here.
