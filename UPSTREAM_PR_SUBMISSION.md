# Upstream Pull Request: cloudflare/ai

- **Target Repository:** [`cloudflare/ai`](https://github.com/cloudflare/ai)
- **Target Package:** `packages/workers-ai-provider`
- **Target Branch:** `main`
- **Patch File:** [`patches/0001-fix-workers-ai-provider-streaming-token-duplication.patch`](./patches/0001-fix-workers-ai-provider-streaming-token-duplication.patch)

---

## Pull Request Details

### Title
`fix(workers-ai-provider): prevent duplicate token and tool_calls emission on dual-format SSE chunks`

### Description

#### Problem
When streaming responses from Cloudflare Workers AI with certain models (e.g. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`), individual Server-Sent Events (SSE) data chunks often arrive with **both** the native Workers AI representation and the OpenAI-compatible representation populated simultaneously:

```json
{
  "response": "AA1822 is delayed",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "AA1822 is delayed"
      }
    }
  ]
}
```

In `packages/workers-ai-provider/src/streaming.ts`, the transform stream checks `chunk.response` and enqueues a `text-delta`. Immediately afterwards, it checks `choices[0].delta` and enqueues a second `text-delta` containing the identical text.

This causes text to be emitted twice for every chunk (e.g., `"AA1822 is delayedAA1822 is delayed"`, or doubled words `"word word"` over WebSocket sessions). The same issue also occurs when `chunk.tool_calls` and `choices[0].delta.tool_calls` are simultaneously present.

#### Solution
Introduce `const hasChoicesDelta = choices?.[0]?.delta != null;` guard on the native top-level branches:
1. `if (!hasChoicesDelta && nativeResponse != null && nativeResponse !== "")`
2. `if (!hasChoicesDelta && Array.isArray(chunk.tool_calls))`

If `choices[0].delta` is present, the transform stream defers exclusively to `choices[0].delta`. If `choices` is not provided (legacy native format), it safely falls back to `chunk.response` and `chunk.tool_calls`.

---

## Proposed Diff

```diff
diff --git a/packages/workers-ai-provider/src/streaming.ts b/packages/workers-ai-provider/src/streaming.ts
index c12a84b..e34f9a1 100644
--- a/packages/workers-ai-provider/src/streaming.ts
+++ b/packages/workers-ai-provider/src/streaming.ts
@@ -166,8 +166,9 @@ export function createWorkersAIStreamTransform(
 				}
 
 				// --- Native format: top-level `response` field ---
+				const hasChoicesDelta = choices?.[0]?.delta != null;
 				const nativeResponse = chunk.response;
-				if (nativeResponse != null && nativeResponse !== "") {
+				if (!hasChoicesDelta && nativeResponse != null && nativeResponse !== "") {
 					const responseText = String(nativeResponse);
 					if (responseText.length > 0) {
 						if (bufferContentForSalvage) {
@@ -193,7 +194,7 @@ export function createWorkersAIStreamTransform(
 				}
 
 				// --- Native format: top-level `tool_calls` ---
-				if (Array.isArray(chunk.tool_calls)) {
+				if (!hasChoicesDelta && Array.isArray(chunk.tool_calls)) {
 					// Close active reasoning block before tool calls start
 					if (reasoningId) {
 						controller.enqueue({ type: "reasoning-end", id: reasoningId });
```

---

## Unit Test Addition

Add to `packages/workers-ai-provider/test/streaming.test.ts`:

```typescript
it('handles dual-format SSE chunks without duplicate text emission', async () => {
  const dualFormatChunk = JSON.stringify({
    response: 'Hello world',
    choices: [{ delta: { content: 'Hello world' } }],
  });

  const transform = createWorkersAIStreamTransform();
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue(`data: ${dualFormatChunk}\n\n`);
      controller.enqueue('data: [DONE]\n\n');
      controller.close();
    },
  });

  const reader = inputStream.pipeThrough(new TextEncoderStream()).pipeThrough(transform).getReader();
  const textDeltas: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === 'text-delta') {
      textDeltas.push(value.delta);
    }
  }

  // Ensure 'Hello world' was emitted exactly once, not twice
  expect(textDeltas.join('')).toBe('Hello world');
});
```

---

## How to Submit this PR to Cloudflare

```bash
# 1. Fork and clone cloudflare/ai
git clone https://github.com/<your-username>/ai.git cloudflare-ai
cd cloudflare-ai

# 2. Create feature branch
git checkout -b fix/workers-ai-provider-streaming-dedup

# 3. Apply the patch
git apply /path/to/flight-support-agent/patches/0001-fix-workers-ai-provider-streaming-token-duplication.patch

# 4. Commit and push
git commit -am "fix(workers-ai-provider): prevent duplicate token and tool_calls emission on dual-format SSE chunks"
git push -u origin fix/workers-ai-provider-streaming-dedup

# 5. Open PR
gh pr create --repo cloudflare/ai --title "fix(workers-ai-provider): prevent duplicate token and tool_calls emission on dual-format SSE chunks"
```
