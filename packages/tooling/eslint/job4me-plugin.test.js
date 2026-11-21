import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import plugin from './job4me-plugin.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-jsx-literals', plugin.rules['no-jsx-literals'], {
  valid: [
    'const a = <p>{t("home.title")}</p>;',
    'const a = <span aria-label={t("nav.home")} />;',
    'const a = <span> · </span>;',
    'const a = <span>{42}</span>;',
    'const a = <input type="email" autoComplete="username webauthn" />;',
    'const a = <img alt="" src="/logo.svg" />;',
  ],
  invalid: [
    { code: 'const a = <p>Bonjour</p>;', errors: [{ messageId: 'literal' }] },
    { code: 'const a = <button title="Fermer" />;', errors: [{ messageId: 'literal' }] },
    { code: 'const a = <p>{"Texte"}</p>;', errors: [{ messageId: 'literal' }] },
    { code: 'const a = <p>{`Salut ${name}`}</p>;', errors: [{ messageId: 'literal' }] },
    { code: 'const a = <>Hello</>;', errors: [{ messageId: 'literal' }] },
  ],
});
