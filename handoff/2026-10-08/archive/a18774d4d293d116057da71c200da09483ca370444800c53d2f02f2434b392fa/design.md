# QA02 one-send native source submission proposal

Scope: static preparation in `work`. The AIVORA sender has not been run. The only sent `BM_CLICK` in this preparation targeted a separate mock Win32 `Button` created by `mock-win32-bm-click-once.ps1`.

## Signed candidate and one-use gate

The runner requires the candidate HEAD, product snapshot SHA, QA overlay SHA, build receipt SHA, and sender script SHA as explicit arguments. It verifies all 27 signed product files, six QA files, the exact Git status path set, and every dist file's byte count and hash before launching Electron. The short input SHA is frozen. An exclusive ledger keyed by product snapshot is written before profile creation. A second run for that signed snapshot stops at the ledger; an unclear first run is never replayed.

The runner creates a fresh profile and project. The same renderer's existing preload bridge independently reads the project, source manifest, and full source text. The project ID, version ID, content hash, revision, document bytes, full text, and pre-submit review-null state must match. These values are passed to the native sender; the sender does not derive its expected identity from the native dialog.

## Native sender

It selects exactly one `AIVORA` UIA owner for the Electron main PID, one `#32770` descendant dialog named `送审来源版本`, and one descendant `CCPushButton` pane named `确认送审来源版本`. It reads the dialog text and checks each identity and `submit` action exactly once. It verifies the same button HWND has Win32 class `Button`, the same PID, and `IsChild(dialog, button)`. The final gate rechecks stable owner/dialog/button HWNDs and PIDs, button Win32 class, `IsWindow`, `IsWindowEnabled`, `IsWindowVisible`, UIA enabled and onscreen flags, and foreground HWND equal to the dialog. It does not activate the dialog or change focus; a failed gate stops before sending.

The sender writes an `ARMED_OUTCOME_UNKNOWN` receipt with target HWND, message, flags, timeout, identity, and attempt index **before** its sole `SendMessageTimeoutW` call. It uses `BM_CLICK` (`0x00F5`) with zero `wParam`/`lParam`, `SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT`, and a 5000 ms timeout. It records the API return, message result, and last error. A timeout, error, exception, or interruption is `UNKNOWN_AFTER_SEND`; no second message is sent. `BM_CLICK` has no business return value, so even a nonzero API return is only `SEND_RETURNED_BUSINESS_UNVERIFIED`.

## Authoritative outcome

The runner saves raw post-send bridge `getProject`, `getSourceManifest`, and `getSourceText` responses. It may poll these GETs up to 12 times, 500 ms apart; it never sends another native action. It reports `SOURCE_SUBMISSION_CONFIRMED` only if the sender returned without error and the service manifest shows the same latest and review version, a review submission ID, the same content hash, and the full source text still matches. Any other or missing receipt stays `STOP_OR_UNKNOWN`. It saves screenshots and normally closes Electron. This only covers source submission, not baseline signoff, decision, the 20,000-character case, or final M1 acceptance.

## Source basis and mock limit

- [BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click): simulated down/up and parent `BN_CLICKED`; an inactive dialog may fail; no message return value.
- [SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw): signature, timeout flags, nonzero API success, and ambiguous failure/timeout.
- [IsWindowEnabled](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowenabled), [IsWindowVisible](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowvisible), [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow): state and foreground gates. Visibility alone does not establish that no other window obscures the button; the UIA onscreen and foreground checks narrow that risk.

The isolated mock confirmed one `BM_CLICK` call to a real Win32 `Button` produced one parent `BN_CLICKED`. Its foreground HWND differed from the mock form, and the mock deliberately did not apply the AIVORA foreground gate. It proves the P/Invoke and button message mechanics on this Windows host, not that the AIVORA dialog will pass the final gate or submit successfully.
