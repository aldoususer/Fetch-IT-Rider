const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

// Keys identify siblings, not the booking shared by otherwise different widgets.
// Conditional branches in a single child position are mutually exclusive.
function collisions(source, filename = 'fixture.tsx') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), problems = [];
  function roots(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return [node];
    if (ts.isJsxExpression(node)) return node.expression ? roots(node.expression) : [];
    if (ts.isParenthesizedExpression(node)) return roots(node.expression);
    if (ts.isBinaryExpression(node)) return [...roots(node.left), ...roots(node.right)];
    if (ts.isConditionalExpression(node)) return [...roots(node.whenTrue), ...roots(node.whenFalse)];
    return [];
  }
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const groups = new Map();
      for (const child of node.children) for (const element of roots(child)) {
        const opening = ts.isJsxElement(element) ? element.openingElement : element;
        const key = opening.attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.getText(tree) === 'key');
        if (!key) continue;
        const identity = key.initializer?.getText(tree), previous = groups.get(identity);
        if (previous && previous !== child) problems.push(`${filename}:${tree.getLineAndCharacterOfPosition(element.pos).line + 1}: duplicate sibling key ${identity}`);
        groups.set(identity, child);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); return problems;
}
test('the key guard catches conditional pickup/map collisions but permits exclusive branches and separate lists', () => {
  assert.equal(collisions('<div>{ready && <Pickup key={job.id}/>}<Map key={job.id}/></div>').length, 1);
  assert.equal(collisions('<div>{ready ? <Pickup key={job.id}/> : <Timeline key={job.id}/>}</div>').length, 0);
  assert.equal(collisions('<><section><Pickup key={job.id}/></section><section><Map key={job.id}/></section></>').length, 0);
});
test('application components do not reuse a booking key for different sibling widgets', () => {
  const problems = [];
  function scan(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) scan(file); else if (entry.name.endsWith('.tsx')) problems.push(...collisions(fs.readFileSync(file, 'utf8'), path.relative(process.cwd(), file))); } }
  scan(path.join(process.cwd(), 'src/components'));
  assert.deepEqual(problems, []);
});
