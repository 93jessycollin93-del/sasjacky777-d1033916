import test from 'node:test';
import assert from 'node:assert/strict';
import { segment, byteOffsets, byteLength } from '../packages/local/segment.ts';

test('byte offsets match TextEncoder for mixed scripts', () => {
  const s = 'a✓b𝄞c naïve';
  const table = byteOffsets(s);
  const enc = new TextEncoder();
  for (let i = 0; i <= s.length; i++) {
    // Slicing mid-surrogate is not meaningful; skip those indices.
    const code = s.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    assert.equal(table[i], enc.encode(s.slice(0, i)).length, `index ${i}`);
  }
});

test('segment spans address the exact sentence bytes', () => {
  const text = 'Ünïcödé leads. The middle sentence sits here! Does the tail work? Yes.';
  const bytes = new TextEncoder().encode(text);
  const segs = segment(text);
  assert.equal(segs.length, 4);
  for (const seg of segs) {
    const sliced = new TextDecoder().decode(bytes.subarray(seg.span[0], seg.span[1]));
    assert.equal(sliced, seg.text, `segment ${seg.index}`);
  }
});

test('spans never exceed the source length', () => {
  const text = 'Short. Another one here. ✓ Trailing fragment with no terminator';
  const total = byteLength(text);
  for (const seg of segment(text)) {
    assert.ok(seg.span[1] <= total, 'span end within bounds');
    assert.ok(seg.span[0] < seg.span[1], 'span non-empty');
  }
});

test('paragraph breaks split even without terminal punctuation', () => {
  const segs = segment('First block of text\n\nSecond block of text');
  assert.equal(segs.length, 2);
  assert.equal(segs[1].text, 'Second block of text');
});
