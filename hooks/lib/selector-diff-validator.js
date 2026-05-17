'use strict';

/**
 * selector-diff-validator.js
 *
 * validate({ before, after, expectedAttr, filePath })
 *
 * Returns:
 *   { ok: true, attrName, attrValue }        — additive attribute edit detected
 *   { ok: false, reason, detail }             — anything else
 */

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ─── helpers ──────────────────────────────────────────────────────────────────

function err(reason, detail) {
  return { ok: false, reason, detail };
}

// ─── JSX / TSX / JS / TS (Babel) ─────────────────────────────────────────────

function parseJSX(src) {
  const { parse } = require('@babel/parser');
  return parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
}

/**
 * Flatten all JSXOpeningElement nodes from a Babel AST into an ordered array.
 * Each entry: { tag: string, attrs: Array<{ name: string, value: string|null }> }
 * Only JSXAttribute nodes are included; JSXSpreadAttribute are represented as
 * a sentinel so positional comparison is preserved.
 */
function flattenJSX(ast) {
  const result = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement') {
      const tag = node.name.type === 'JSXIdentifier'
        ? node.name.name
        : node.name.type === 'JSXMemberExpression'
          ? node.name.object.name + '.' + node.name.property.name
          : '?';
      const attrs = node.attributes.map(attr => {
        if (attr.type !== 'JSXAttribute') {
          return { spread: true };
        }
        // attr.name is JSXIdentifier or JSXNamespacedName (for data-*)
        const name = attr.name.type === 'JSXNamespacedName'
          ? attr.name.namespace.name + ':' + attr.name.name.name
          : attr.name.name;
        let value = null;
        if (attr.value) {
          if (attr.value.type === 'StringLiteral') {
            value = attr.value.value;
          } else if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression) {
            // Distinguish expressions by their identifier/member name when available,
            // and fall back to source offsets. Two same-named attributes with different
            // expression bodies will produce different fingerprints, causing
            // compareElements to flag the change as modifies-existing-attribute.
            const expr = attr.value.expression;
            let exprFingerprint;
            if (expr.type === 'Identifier') {
              // onClick={handler} — use the identifier name
              exprFingerprint = `id:${expr.name}`;
            } else if (expr.type === 'MemberExpression') {
              // onClick={obj.method} — use member expression source
              const obj = expr.object && expr.object.name ? expr.object.name : '?';
              const prop = expr.property && expr.property.name ? expr.property.name : '?';
              exprFingerprint = `mem:${obj}.${prop}`;
            } else {
              // For complex expressions use start/end offsets as a best-effort fingerprint
              exprFingerprint = `range:${expr.start}-${expr.end}`;
            }
            value = `__expr__#${exprFingerprint}`;
          } else {
            value = '__expr__';
          }
        }
        return { name, value };
      });
      result.push({ tag, attrs });
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end' || key === 'tokens' || key === 'comments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }
  walk(ast);
  return result;
}

// ─── Vue (SFC) ────────────────────────────────────────────────────────────────

function parseVue(src) {
  const { parse } = require('@vue/compiler-sfc');
  const { descriptor, errors } = parse(src);
  if (errors && errors.length) throw new Error(errors[0].message);
  if (!descriptor.template) throw new Error('No <template> in Vue SFC');
  return descriptor.template.ast;
}

/**
 * Flatten Vue compiler-sfc template AST.
 * type 1 = ELEMENT, type 6 = plain ATTRIBUTE, type 7 = DIRECTIVE.
 *
 * Directives (@click, v-if, v-bind, etc.) are included as sentinel entries
 * so that adding/removing/changing a directive is detected as structural change.
 * We don't compare directive bodies — only count them. Any change in the
 * non-test-attribute structure is a structural change.
 */
function flattenVue(node) {
  const result = [];
  function walk(n) {
    if (!n) return;
    if (n.type === 1) {
      // ELEMENT
      const attrs = (n.props || []).map((p, idx) => {
        if (p.type === 6) {
          // Plain attribute
          return { name: p.name, value: p.value ? p.value.content : null };
        }
        // Directive (type 7: @click, v-if, v-bind, etc.) — represent as
        // a sentinel that includes the directive's expression content and source
        // offsets, so that changing a handler body (oldHandler → newHandler)
        // is detected as modifies-existing-attribute.
        const expContent = p.exp ? p.exp.content : '';
        const startOffset = p.loc && p.loc.start ? p.loc.start.offset : idx;
        const endOffset   = p.loc && p.loc.end   ? p.loc.end.offset   : idx;
        return {
          name: `__directive_${idx}__`,
          value: `__directive__:${p.name}@${startOffset}-${endOffset}:${expContent}`,
        };
      });
      result.push({ tag: n.tag, attrs });
      (n.children || []).forEach(walk);
    } else if (n.children) {
      n.children.forEach(walk);
    }
  }
  // The root is a ROOT node (type 0) with children
  (node.children || []).forEach(walk);
  return result;
}

// ─── Svelte ───────────────────────────────────────────────────────────────────

function parseSvelte(src) {
  const { parse } = require('svelte/compiler');
  // Svelte 4's parser doesn't handle TypeScript in script blocks.
  // Strip all <script> blocks before parsing so only the template remains.
  // Limitation: this strips `<script>...</script>` non-greedily before handing
  // the remaining template to svelte/compiler v4 (which can't parse `<script lang="ts">`).
  // A `.svelte` file whose script body contains a literal `</script>` inside a
  // template-string will be cut short here and produce `parser-error` downstream
  // (fails closed — never a false-positive ALLOW). Tracked as a v2 follow-up:
  // upgrade to svelte 5's typescript-aware parser, or write a tag-aware splitter.
  const stripped = src.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  return parse(stripped).html;
}

/**
 * Flatten Svelte AST.
 * type === 'Element' has name, attributes, children.
 * Plain Attribute nodes are extracted normally; all other attribute-like nodes
 * (EventHandler: on:click, Binding, Transition, Action, Animation) are
 * represented as sentinels so that count changes are detected as structural.
 * We don't compare their bodies — only count them. The principle: any change
 * in the non-test-attribute structure is a structural change.
 */
function flattenSvelte(node) {
  const result = [];
  function walk(n) {
    if (!n) return;
    if (n.type === 'Element') {
      const attrs = (n.attributes || []).map((a, idx) => {
        if (a.type === 'Attribute') {
          return {
            name: a.name,
            value: Array.isArray(a.value) && a.value.length > 0 ? a.value[0].data : null,
          };
        }
        // EventHandler, Binding, Transition, Action, Animation — represent as
        // a sentinel that includes the node's source offsets and expression name
        // so that changing a handler body (oldHandler → newHandler) is detected
        // as modifies-existing-attribute.
        const expName = a.expression && a.expression.name ? a.expression.name : '';
        const startOff = a.start !== undefined ? a.start : idx;
        const endOff   = a.end   !== undefined ? a.end   : idx;
        return {
          name: `__directive_${idx}__`,
          value: `__directive__:${a.type}@${startOff}-${endOff}:${expName}`,
        };
      });
      result.push({ tag: n.name, attrs });
      (n.children || []).forEach(walk);
    } else if (n.type === 'Fragment') {
      (n.children || []).forEach(walk);
    } else if (n.children) {
      (n.children || []).forEach(walk);
    }
  }
  walk(node);
  return result;
}

// ─── HTML (parse5) ────────────────────────────────────────────────────────────

function parseHTML(src) {
  const parse5 = require('parse5');
  return parse5.parse(src);
}

/**
 * Flatten parse5 AST.
 * Element nodes have nodeName (tag name), attrs ([{name, value}]), childNodes.
 * Skip #document, #documentType, #text, #comment.
 */
function flattenParse5(node) {
  const result = [];
  function walk(n) {
    if (!n) return;
    if (n.nodeName && !n.nodeName.startsWith('#')) {
      const attrs = (n.attrs || []).map(a => ({ name: a.name, value: a.value }));
      result.push({ tag: n.nodeName, attrs });
    }
    if (n.childNodes) n.childNodes.forEach(walk);
  }
  walk(node);
  return result;
}

// ─── Core comparison ──────────────────────────────────────────────────────────

/**
 * Compare two flat element arrays (before / after).
 * Returns { ok, ... } per contract.
 */
function compareElements(beforeElems, afterElems) {
  if (beforeElems.length !== afterElems.length) {
    return err('structural-change', `Element count changed: ${beforeElems.length} → ${afterElems.length}`);
  }

  let added = null;   // { name, value } — the single allowed new attribute
  let addedCount = 0;

  for (let i = 0; i < beforeElems.length; i++) {
    const b = beforeElems[i];
    const a = afterElems[i];

    if (b.tag !== a.tag) {
      return err('structural-change', `Tag mismatch at index ${i}: ${b.tag} → ${a.tag}`);
    }

    // Compare existing attributes (b.attrs are the baseline)
    for (let j = 0; j < b.attrs.length; j++) {
      const ba = b.attrs[j];
      const aa = a.attrs[j];
      // aa might be undefined if after has fewer attrs than before (removal)
      if (!aa) {
        return err('modifies-existing-attribute', `Attribute removed: ${ba.name}`);
      }
      // Spread sentinels — compare as equal-if-both-spread
      if (ba.spread || aa.spread) {
        if ((ba.spread && !aa.spread) || (!ba.spread && aa.spread)) {
          return err('modifies-existing-attribute', `Spread changed at position ${j} in <${b.tag}>`);
        }
        continue;
      }
      if (ba.name !== aa.name || ba.value !== aa.value) {
        return err('modifies-existing-attribute', `Attribute changed: ${ba.name}="${ba.value}" → ${aa.name}="${aa.value}"`);
      }
    }

    // Check for after having MORE attrs than before (additional)
    if (a.attrs.length > b.attrs.length) {
      const extra = a.attrs.length - b.attrs.length;
      if (extra > 1) {
        return err('multiple-attributes-added', `${extra} attributes added in one element`);
      }
      addedCount += 1;
      if (addedCount > 1) {
        return err('multiple-attributes-added', 'Attributes added in more than one element');
      }
      const newAttr = a.attrs[b.attrs.length]; // the extra one at the end
      added = { name: newAttr.name, value: newAttr.value };
    }
  }

  if (!added) {
    // No new attribute was found — treat as structural if no changes at all?
    // The contract says we return ok:true only for additive edits.
    // If nothing was added, it's not a selector-adding edit.
    // However, this case should not arise in the test suite.
    return err('structural-change', 'No new attribute was added');
  }

  return { ok: true, attrName: added.name, attrValue: added.value };
}

// ─── Router ───────────────────────────────────────────────────────────────────

function getExtension(filePath) {
  const m = filePath.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function parseAndFlatten(src, ext) {
  switch (ext) {
    case 'tsx':
    case 'jsx':
    case 'ts':
    case 'js': {
      const ast = parseJSX(src);
      return flattenJSX(ast);
    }
    case 'vue': {
      const ast = parseVue(src);
      return flattenVue(ast);
    }
    case 'svelte': {
      const ast = parseSvelte(src);
      return flattenSvelte(ast);
    }
    case 'html':
    case 'htm': {
      const ast = parseHTML(src);
      return flattenParse5(ast);
    }
    default:
      return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function validate({ before, after, expectedAttr, filePath }) {
  const ext = getExtension(filePath);
  if (!['tsx', 'jsx', 'ts', 'js', 'vue', 'svelte', 'html', 'htm'].includes(ext)) {
    return err('unsupported-extension', `No parser for extension: .${ext}`);
  }

  let beforeElems, afterElems;
  try {
    beforeElems = parseAndFlatten(before, ext);
    afterElems = parseAndFlatten(after, ext);
  } catch (e) {
    return err('parser-error', e.message);
  }

  const result = compareElements(beforeElems, afterElems);
  if (!result.ok) return result;

  // Final checks
  if (result.attrName !== expectedAttr) {
    return err('wrong-attribute-name', `Expected ${expectedAttr} but got ${result.attrName}`);
  }
  if (!KEBAB_RE.test(result.attrValue)) {
    return err('value-not-kebab-case', `Value "${result.attrValue}" is not kebab-case`);
  }

  return result;
}

module.exports = { validate };
