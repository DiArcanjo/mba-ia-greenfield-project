/**
 * Maps every method of T to a bare `jest.Mock`. Unlike `jest.Mocked<T>`, the
 * mocked members are not declared as class methods, so asserting on them does
 * not trigger `@typescript-eslint/unbound-method`.
 */
export type MockedService<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K];
};
