---
name: no-tests
description: No tests or mocks — implementation only. Always active for this project.
when_to_use: Always active. Referenced by all other skills in this repo.
---

# No Tests or Mocks

This project is in active implementation phase. Tests and mocks are explicitly excluded to save tokens and keep focus on shipping features.

## Rules

- **Never** create `*.spec.ts`, `*.test.ts`, or `*.test.tsx` files.
- **Never** create `__mocks__/` directories or `*.mock.ts` files.
- **Never** add Jest, Vitest, or any test runner configuration.
- **Never** write `describe`, `it`, `test`, `expect`, `jest.fn()`, or `vi.fn()` blocks.
- **Never** suggest "you should add a test for this".

## When asked to test something

Skip tests. Implement the real feature. If validation is needed, use runtime logging or guards inside the implementation itself.
