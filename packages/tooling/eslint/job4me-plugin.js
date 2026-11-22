// Local ESLint rules for Job4me.
// no-jsx-literals: user-visible text must come from the translation files (CLAUDE.md).

const LETTER = /\p{L}/u;
const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

function hasLetters(value) {
  return typeof value === 'string' && LETTER.test(value);
}

/** @type {import('eslint').Rule.RuleModule} */
const noJsxLiterals = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hard-coded user-visible text in JSX; use the translation files.',
    },
    schema: [],
    messages: {
      literal:
        'User-visible text must come from the translation files (packages/i18n), not from the code.',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        if (hasLetters(node.value)) context.report({ node, messageId: 'literal' });
      },
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : '';
        if (!TEXT_ATTRIBUTES.has(name) || !node.value) return;
        if (node.value.type === 'Literal' && hasLetters(node.value.value)) {
          context.report({ node, messageId: 'literal' });
        }
      },
      'JSXElement > JSXExpressionContainer, JSXFragment > JSXExpressionContainer'(node) {
        const expression = node.expression;
        if (expression.type === 'Literal' && hasLetters(expression.value)) {
          context.report({ node, messageId: 'literal' });
        }
        if (
          expression.type === 'TemplateLiteral' &&
          expression.quasis.some((quasi) => hasLetters(quasi.value.cooked))
        ) {
          context.report({ node, messageId: 'literal' });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'job4me', version: '0.0.0' },
  rules: { 'no-jsx-literals': noJsxLiterals },
};

export default plugin;
