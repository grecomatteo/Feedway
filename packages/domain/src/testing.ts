// For tests outside this package: the permission matrix of spec §10.2 as a table (Task 2).
export { MATRIX } from './authz/matrix.fixture.js'
export type { Cell, MatrixRole } from './authz/matrix.fixture.js'
// The cases of the checks before scheduling (plan 05): the tests and the table of Task 2.
export * from './rules/cases.js'
