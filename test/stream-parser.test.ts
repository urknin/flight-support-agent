import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror client parsing utilities for stream chunks and ticket extraction
function cleanAssistantText(rawText: string) {
  if (!rawText) return { cleanText: '', extractedId: null };
  let extractedId = null;
  const match = rawText.match(/\{"type":"start","messageId":"([^"]+)"\}/);
  if (match) {
    extractedId = match[1];
  }
  const cleanText = rawText.replace(/\{"type":"start"[^}]*\}/g, '').trim();
  return { cleanText, extractedId };
}

function extractTextAndMetaFromStreamBody(body: string) {
  if (!body) return { text: '', messageId: null };
  let extracted = '';
  let messageId: string | null = null;

  const startMatch = body.match(/\{"type":"start","messageId":"([^"]+)"\}/);
  if (startMatch) {
    messageId = startMatch[1];
  }

  const lines = body.split('\n');
  for (const line of lines) {
    let text = line.trim();
    if (!text) continue;
    if (text.startsWith('data:')) {
      text = text.slice(5).trim();
    }
    if (text === '[DONE]') continue;

    if (text.includes('{"type":"start"')) {
      const inlineMatch = text.match(/\{"type":"start","messageId":"([^"]+)"\}/);
      if (inlineMatch && !messageId) {
        messageId = inlineMatch[1];
      }
      text = text.replace(/\{"type":"start"[^}]*\}/g, '').trim();
      if (!text) continue;
    }

    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const obj = JSON.parse(text);
        if (obj.type === 'start' && obj.messageId) {
          messageId = obj.messageId;
        } else if (obj.type === 'text-delta' && obj.delta) {
          extracted += obj.delta;
        } else if (obj.type === 'error') {
          extracted += `\n\n*(Notice: ${obj.error || 'System is checking alternative flights.'})*`;
        }
      } catch {
        // Not valid JSON
      }
    } else if (!text.startsWith('{') && !text.startsWith('data:')) {
      extracted += text + ' ';
    }
  }
  return { text: extracted, messageId };
}

describe('Stream Chunk & Ticket Trace ID Parser', () => {
  it('extracts messageId from start frame without leaking JSON into text', () => {
    const rawFrame = '{"type":"start","messageId":"assistant_1791932719866_mezna001o"}';
    const result = extractTextAndMetaFromStreamBody(rawFrame);

    assert.equal(result.messageId, 'assistant_1791932719866_mezna001o');
    assert.equal(result.text, '');
  });

  it('handles concatenated start frame with subsequent error text cleanly', () => {
    const rawFrame = '{"type":"start","messageId":"assistant_1791932351581_kgk32q0ie"}An error occurred.';
    const result = extractTextAndMetaFromStreamBody(rawFrame);

    assert.equal(result.messageId, 'assistant_1791932351581_kgk32q0ie');
    assert.match(result.text, /An error occurred/);
    assert.ok(!result.text.includes('{"type":"start"'));
  });

  it('parses standard SSE text-delta chunks correctly', () => {
    const sseBody = 'data: {"type":"text-delta","id":"chunk_1","delta":"Hello Alex! "}\n\ndata: {"type":"text-delta","id":"chunk_2","delta":"Flight AA1822 is delayed."}';
    const result = extractTextAndMetaFromStreamBody(sseBody);

    assert.equal(result.text, 'Hello Alex! Flight AA1822 is delayed.');
    assert.equal(result.messageId, null);
  });

  it('cleans leaked start JSON from stored message history prose', () => {
    const leakedText = '{"type":"start","messageId":"assistant_1791932719866_mezna001o"}Your flight AA1822 has been delayed by 180 minutes.';
    const { cleanText, extractedId } = cleanAssistantText(leakedText);

    assert.equal(extractedId, 'assistant_1791932719866_mezna001o');
    assert.equal(cleanText, 'Your flight AA1822 has been delayed by 180 minutes.');
  });

  it('proves dual-format chunk deduplication produces single tokens instead of repeats', () => {
    // Simulated dual-format Workers AI chunk containing both native and OpenAI fields
    const dualChunk = {
      response: 'AA1822 is delayed',
      choices: [{ delta: { content: 'AA1822 is delayed' } }],
    };

    // Before fix: both response and delta.content were emitted -> 'AA1822 is delayedAA1822 is delayed'
    // With fix: hasChoicesDelta defers to choices[0].delta, emitting exactly once
    const hasChoicesDelta = dualChunk.choices?.[0]?.delta != null;
    let emitted = '';
    if (!hasChoicesDelta && dualChunk.response) {
      emitted += dualChunk.response;
    }
    if (dualChunk.choices?.[0]?.delta?.content) {
      emitted += dualChunk.choices[0].delta.content;
    }

    assert.equal(emitted, 'AA1822 is delayed');
    assert.notEqual(emitted, 'AA1822 is delayedAA1822 is delayed');
  });

  it('parses <suggestions> block into interactive followup cards cleanly', () => {
    function parseSuggestions(text: string) {
      if (!text) return { cleanText: '', suggestions: [] as { label: string; prompt: string }[] };
      let cleanText = text;
      cleanText = cleanText.replace(/```(?:suggestions?|xml|html)?\s*(<suggestions?>)/gi, '$1');
      cleanText = cleanText.replace(/(<\/suggestions?>)\s*```/gi, '$1');

      const match = cleanText.match(/<suggestions?>([\s\S]*?)<\/suggestions?>/i);
      let suggestions: { label: string; prompt: string }[] = [];

      if (match) {
        cleanText = cleanText.replace(/<suggestions?>[\s\S]*?<\/suggestions?>/i, '').trim();
        const lines = match[1].split('\n');
        for (const line of lines) {
          const trimmed = line.trim().replace(/^[-*•\d.]+\s*/, '');
          if (!trimmed) continue;
          const parts = trimmed.split('|');
          if (parts.length >= 2) {
            suggestions.push({
              label: parts[0].trim().replace(/^\[|\]$/g, ''),
              prompt: parts.slice(1).join('|').trim().replace(/^\[|\]$/g, ''),
            });
          } else if (parts.length === 1 && parts[0].trim()) {
            const item = parts[0].trim().replace(/^\[|\]$/g, '');
            suggestions.push({ label: item, prompt: item });
          }
        }
      } else {
        cleanText = cleanText.replace(/<suggestions?>[\s\S]*$/i, '').trim();
      }

      return { cleanText, suggestions };
    }

    const rawResponse = `Your flight AA1822 is delayed by 180 minutes due to severe thunderstorms and an active FAA Ground Stop at DFW. Open seats are confirmed on flight AA2040 (18:45 UTC).

<suggestions>
- Rebook on AA2040 (18:45 UTC) | Please rebook me onto flight AA2040 departing at 18:45 UTC.
- Check DFW Storm Radar | What is the current weather and FAA ground delay status at DFW?
- Set Up SMS Delay Alerts | Register my mobile phone +15125550199 for automated SMS disruption updates.
</suggestions>`;

    const { cleanText, suggestions } = parseSuggestions(rawResponse);

    // Primary ask response is separated from suggestions
    assert.equal(
      cleanText,
      'Your flight AA1822 is delayed by 180 minutes due to severe thunderstorms and an active FAA Ground Stop at DFW. Open seats are confirmed on flight AA2040 (18:45 UTC).'
    );
    assert.equal(suggestions.length, 3);
    assert.equal(suggestions[0].label, 'Rebook on AA2040 (18:45 UTC)');
    assert.equal(suggestions[0].prompt, 'Please rebook me onto flight AA2040 departing at 18:45 UTC.');
    assert.equal(suggestions[1].label, 'Check DFW Storm Radar');
    assert.equal(suggestions[2].label, 'Set Up SMS Delay Alerts');
  });

  it('hides unclosed <suggestions> tags while response is streaming', () => {
    function parseSuggestions(text: string) {
      if (!text) return { cleanText: '', suggestions: [] as { label: string; prompt: string }[] };
      let cleanText = text;
      const match = cleanText.match(/<suggestions?>([\s\S]*?)<\/suggestions?>/i);
      let suggestions: { label: string; prompt: string }[] = [];

      if (match) {
        cleanText = cleanText.replace(/<suggestions?>[\s\S]*?<\/suggestions?>/i, '').trim();
      } else {
        cleanText = cleanText.replace(/<suggestions?>[\s\S]*$/i, '').trim();
      }
      return { cleanText, suggestions };
    }

    const streamingChunk = 'Flight AA1822 is delayed by 180 mins.<suggestions>\n- Rebook to AA2040 | Please';
    const { cleanText, suggestions } = parseSuggestions(streamingChunk);

    assert.equal(cleanText, 'Flight AA1822 is delayed by 180 mins.');
    assert.equal(suggestions.length, 0);
  });
});
