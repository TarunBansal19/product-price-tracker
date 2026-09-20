# AI Mistakes & Lessons Learned Log

> Maintained per Rule R8. Every time an AI-generated first attempt is wrong, it is logged with real evidence and the exact fix. Never invent entries.

---

### Entry 1: Unhandled Dynamic Cookie Overlay Caused Click Timeout in Recon
- **Date/Time**: 2026-09-20T11:59:34Z
- **Trigger**: Running `node src/cli/recon.js --id 200 --headless`.
- **Failing Output**:
  ```
  [recon] Reveal price button found. Disabled: false
  [recon] Clicking Reveal price button...
  [recon] Fatal error: elementHandle.click: Timeout 30000ms exceeded.
  Call log:
    - attempting click action
    - <div class="cookie-overlay">…</div> intercepts pointer events
  ```
- **Root Cause**: The first attempt assumed clicking the "Reveal price" button could proceed immediately once enabled. However, the store injects a `<div class="cookie-overlay">` overlay that intercepts clicks. Looking at the client bundle, the cookie modal uses an intentional chaotic counter `Jr()` where the modal only closes after 1, 2, or 3 clicks on the Accept/Decline button!
- **Fix**: Added a resilient `dismissCookieBanner()` function that polls for `.cookie-overlay` and clicks `button[aria-label="Accept cookies"]` in a loop until the overlay is completely removed from the DOM before attempting any interaction.
- **Verification**: Ran `node src/cli/recon.js --id 200 --headless`; successfully dismissed the overlay in 2 clicks and extracted the price cleanly.

---

### Entry 2: Premature Wait Condition in Capture Fixtures Caused Empty Quotes
- **Date/Time**: 2026-09-20T12:04:50Z
- **Trigger**: Running `capture-fixtures.js` round 1 on product 200 and 14.
- **Failing Output**:
  ```
  [capture] Saved fixture to fixture-200-1789885957943.json (price: undefined, stock: undefined)
  ```
- **Root Cause**: The capture script relied on `page.waitForResponse` for `/price`, but did not check if the reveal button click was intercepted or if the price block was scrolled into view before mouse hover events were dispatched.
- **Fix**: Ensured `block.scrollIntoViewIfNeeded()` was called, repeated mouse move jitter to guarantee `minMoves: 8` and `minDwellMs: 600`, and added explicit `page.waitForFunction` waiting for hydrated state with retries.
- **Verification**: Captured valid fixtures across varied products with 100% price and stock extraction in subsequent runs.
