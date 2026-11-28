# Humanizer timing configuration

OmegA-FCA does not impose a separate fixed reply delay when a caller supplies humanizer options. GoatBot reads `config.json` → `humanizer` and maps:

- `humanizer.delayMs` → FCA `reactDelayMs`
- `humanizer.cooldownMs` → FCA `cooldownMs`

The two settings have separate responsibilities:

- **delayMs** controls the configured reaction delay before command middleware continues.
- **cooldownMs** enforces the minimum spacing between accepted command events on the same thread. The effective wait is the greater of the configured reaction delay and the remaining cooldown.

For example, `delayMs: 1200` and `cooldownMs: 0` produce an approximately 1.2-second reaction wait. With `delayMs: 1200` and `cooldownMs: 5000`, the cooldown can extend the wait to 5 seconds when the previous command was recent.

FCA defaults (3,000 ms reaction delay and 5,500 ms cooldown) are fallbacks only when the caller omits those options; they do not override values passed by GoatBot. Calling `setOptions` again replaces the supplied timing values at runtime.

Regression coverage: `test/humanizer.test.cjs` checks that both settings independently affect timing and that updated options replace previous values.


The timing regression also waits for the middleware queue's asynchronous scheduling turn before asserting the first command's release, avoiding a synchronous-test assumption.
