import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/shared/http/success-response.ts',
      'src/shared/middleware/error-handler.ts',
      'src/app.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.name='res']",
          message:
            'Use successResponse() or throw AppError for the global error handler — do not call res.json directly.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='CallExpression'][callee.object.callee.property.name='status']",
          message:
            'Use successResponse() or throw AppError for the global error handler — do not call res.status().json directly.',
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);
