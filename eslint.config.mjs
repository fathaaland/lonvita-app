// eslint-config-next 16 ships flat configs of its own — going through FlatCompat crashes ESLint
// ("Converting circular structure to JSON") before it lints anything.
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler rules new in eslint-config-next 16 — never enforced before (the old config
      // crashed ESLint), with ~50 existing hits. Warnings until those are worked off, then errors.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    ignores: [
      '.next/',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
      'worker/dist/',
      // Agent tooling and audit outputs — not the app's code.
      '.claude/',
      '.agents/',
      'security-audit-skill/',
    ],
  },
]

export default eslintConfig
