import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Declaration body of the first CSS rule whose selector matches exactly. */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[1] : '';
}

test('detail image button is out of flow so the 16:9 frame owns the height', () => {
  const body = ruleBody('.detail-img-btn');
  assert.match(body, /position:\s*absolute/, '.detail-img-btn needs position: absolute');
  assert.match(body, /inset:\s*0/, '.detail-img-btn needs inset: 0');
});

test('detail placeholder does not add layout height', () => {
  assert.match(ruleBody('.detail-img-placeholder'), /position:\s*absolute/);
});

test('detail image is letterboxed, never cropped', () => {
  const img = ruleBody('.detail-img-wrap img');
  assert.match(img, /object-fit:\s*contain/);
  // The <img> is a child of an absolutely positioned button; without absolute
  // positioning its `height: 100%` cycles back to the intrinsic ratio and the
  // image is clipped again by the wrapper's overflow: hidden.
  assert.match(img, /position:\s*absolute/, '.detail-img-wrap img needs position: absolute');
  assert.match(img, /inset:\s*0/, '.detail-img-wrap img needs inset: 0');
});

test('card thumbnail fills its square box', () => {
  const body = ruleBody('.card-img img');
  assert.match(body, /position:\s*absolute/);
  assert.match(body, /object-fit:\s*cover/);
});

test('card icon stays centred when the image is absent', () => {
  assert.match(ruleBody('.card-img .no-img'), /position:\s*absolute/);
});
