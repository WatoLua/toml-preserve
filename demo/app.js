/**
 * Behaviour of the demo page.
 *
 * The library is imported from the compiled `dist/` output, exactly as an
 * `npm install` delivers it: what this page exercises is the published code.
 */
import { TomlError, format, parse, repair } from './lib/index.js';
import { AFTER_TOML, BEFORE_TOML } from './lib/testing/toml-fixtures.js';

const STORE_KEY = 'watolua-toml.demo.v1';

const el = (id) => document.getElementById(id);
const broken = el('broken');
const template = el('template');
const result = el('result');
const status = el('status');
const statusText = el('status-text');
const metrics = el('metrics');
const brokenHint = el('broken-hint');
const templateHint = el('template-hint');
const copyButton = el('copy');

/** Lines of `after` that did not exist in `before`, trailing spaces aside. */
function changedLines(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  let changed = 0;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = (left[i] ?? '').replace(/[ \t]+$/, '');
    const b = (right[i] ?? '').replace(/[ \t]+$/, '');
    if (a !== b) changed++;
  }
  return changed;
}

function countComments(text) {
  return text.split('\n').filter((line) => /^\s*#/.test(line) || /\s#/.test(line)).length;
}

function setStatus(state, message, parts = []) {
  status.dataset.state = state;
  statusText.textContent = message;
  metrics.replaceChildren();
  for (const [value, label] of parts) {
    const span = document.createElement('span');
    const strong = document.createElement('b');
    strong.textContent = String(value);
    span.append(strong, ' ' + label);
    metrics.append(span);
  }
}

function describe(hint, text) {
  if (!text.trim()) {
    hint.textContent = ' ';
    return;
  }
  const lines = text.replace(/\n+$/, '').split('\n').length;
  hint.textContent = `${lines} lines · ${countComments(text)} comments`;
}

function run() {
  const source = broken.value;
  const model = template.value;

  describe(brokenHint, source);
  describe(templateHint, model);
  save();

  if (!source.trim()) {
    result.value = '';
    setStatus('idle', 'Paste a TOML file to repair, or load the example.');
    return;
  }

  let output;
  try {
    output = model.trim() ? repair(source, model) : format(source);
  } catch (error) {
    result.value = '';
    const message = error instanceof TomlError || error instanceof Error ? error.message : 'Invalid TOML.';
    setStatus('error', message.charAt(0).toUpperCase() + message.slice(1));
    return;
  }

  result.value = output;

  const changed = changedLines(source, output);
  const restored = countComments(output) - countComments(source);
  const parts = [
    [changed, 'lines reshaped'],
    [output.replace(/\n+$/, '').split('\n').length, 'lines total'],
  ];
  if (restored > 0) parts.unshift([restored, 'comments restored']);

  if (!model.trim()) {
    setStatus('warn', 'Reformatted without a template: the structure is fixed, but comments missing from the source cannot be restored.', parts);
  } else if (changed === 0) {
    setStatus('ok', 'The file already matched the template: nothing to change.', parts);
  } else {
    setStatus('ok', 'Repaired from the template. Values come from the source, layout from the template.', parts);
  }
}

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 200);
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ broken: broken.value, template: template.value }));
  } catch {
    // Storage unavailable (private window, preview): of no consequence.
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && typeof saved.broken === 'string') {
      broken.value = saved.broken;
      template.value = typeof saved.template === 'string' ? saved.template : '';
      return true;
    }
  } catch {
    // Nothing to restore.
  }
  return false;
}

function loadExample() {
  broken.value = AFTER_TOML;
  template.value = BEFORE_TOML;
  run();
}

broken.addEventListener('input', schedule);
template.addEventListener('input', schedule);
el('load-example').addEventListener('click', loadExample);

el('clear').addEventListener('click', () => {
  broken.value = '';
  template.value = '';
  run();
  broken.focus();
});

el('swap').addEventListener('click', () => {
  if (!result.value) return;
  broken.value = result.value;
  run();
});

copyButton.addEventListener('click', async () => {
  if (!result.value) return;
  const label = copyButton.textContent;
  const done = () => {
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = label; }, 1400);
  };
  try {
    await navigator.clipboard.writeText(result.value);
    done();
  } catch {
    result.removeAttribute('readonly');
    result.select();
    result.setAttribute('readonly', '');
  }
});

if (!restore()) loadExample();
run();
