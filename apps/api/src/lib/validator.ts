import { zValidator as honoZValidator } from "@hono/zod-validator";
import { formatZodErrors } from "./response.js";

/**
 * zValidator's default two-argument form does not throw: the middleware
 * short-circuits with `c.json(result, 400)`, which is the raw
 * `{ success: false, error: { issues: [...], name: "ZodError" } }` payload.
 * Hono's `app.onError` is never entered for it, so every route using the
 * default form - 92 of them - returned an error body nothing else in the API
 * produces, and a route could emit two incompatible 400 shapes depending on
 * whether the schema or a later hand-written check rejected the request.
 *
 * Passing an error hook is the documented way to control that payload. Routing
 * every validator through this wrapper applies the contract documented by
 * `validationError` in `./response.js`
 * (`{ error: "Validation Error", details: [{ field, message }] }`) to all of
 * them at once, while a route that needs a bespoke body - OAuth's
 * `invalid_request`, for instance - keeps control by forwarding its own hook.
 */
const defaultValidationErrorHook: Parameters<typeof honoZValidator>[2] = (
  result,
  c,
) => {
  if (!result.success) {
    return c.json(
      {
        error: "Validation Error",
        details: formatZodErrors(result.error.issues),
      },
      400,
    );
  }
};

export const zValidator = ((
  ...args: Parameters<typeof honoZValidator>
): ReturnType<typeof honoZValidator> =>
  honoZValidator(
    args[0],
    args[1],
    args[2] ?? defaultValidationErrorHook,
    args[3],
  )) as typeof honoZValidator;
