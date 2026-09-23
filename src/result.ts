/**
 * Pure result ADT — exceptions are not control flow.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export function matchResult<T, E, R>(
  result: Result<T, E>,
  arms: { ok: (value: T) => R; err: (error: E) => R },
): R {
  return result.ok ? arms.ok(result.value) : arms.err(result.error);
}
