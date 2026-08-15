# `@orkestrel/reason` — the result types publish no guards

Raised by the `@orkestrel/brief` hardening campaign, commits `1abfc6d`..`8d2739b`.
Evidence is from that campaign's three adversarial audit rounds.

## The gap

`reason` publishes a guard for every INPUT type and none for any RESULT type.

Present in `src/core/validators.ts`: `isReasoning`, `isChainingStrategy`, `isMathOperation`,
`isAggregation`, `isComparison`, `isLogicalOperator`, `isFieldPath`, `isSubject`,
`isNumberRecord`, `isCheck`, `isTransform`, `isBounds`, `isFactorRange`, `isSource`,
`isFactor`, `isFactorGroup`, `isExpression`, `isRule`, `isSymbolicExpression`, `isEquation`,
and the definition guards.

Absent: `isLogicalResult`, `isRuleResult`, `isReasonResult`, `isQuantitativeResult`.

## Why it costs a consumer

`ReasonInterface.reason` returns `ReasonResult` — a UNION. Any consumer that accepts a
caller-supplied engine must narrow that union before dereferencing it, and `reason` gives them
nothing to narrow with. So every such consumer writes the guard themselves.

`brief` wrote one. It got it wrong twice before getting it right, and both mistakes were
subtle enough to survive an audit round each:

1. **Exact-record first.** Built on an exact-record combinator, so it refused a conforming
   `LogicalResult` carrying any extra member. `LogicalResult` is a TypeScript interface — a
   richer object satisfies it — so the guard failed the gate CLOSED on a valid engine. It
   traded a loud crash for a wrong refusal, which is worse. Found in round 2 by two
   independent lenses.
2. **Plain-record second.** Rebuilt on a plain-record check, which refuses any object carrying
   its own prototype — a class instance among them. A conforming engine returning a class
   instance was refused. Found in round 3.

The working form is in `brief` at `src/core/validators.ts` as `isLogicalVerdict` and
`isRuleVerdict`: check every published member, accept unknown keys, accept a prototype, reject
arrays, and follow the published member types exactly — `count` is `number`, so checking it as
an integer is itself a narrowing past the contract.

## Proposal

Publish `isLogicalResult` and `isRuleResult` from `reason`, and extend to `isReasonResult` /
`isQuantitativeResult` if the same argument holds for the other arm.

Take the shape from `brief`'s working version, keeping the three properties that cost two
rounds to learn:

- **Open on unknown keys.** An exact guard over an interface refuses what the interface allows.
- **Accepts a prototype.** An interface is satisfied by a class instance as readily as a
  literal; a plain-record check is a narrowing.
- **Follows the published member types.** Do not check `count` as an integer when the type
  says `number`.

Exactness belongs on records a package OWNS, where an extra key means the caller misunderstood
the contract. It is wrong on a foreign interface.

## Consequence for `brief`

`brief` currently owns `isLogicalVerdict` and `isRuleVerdict` legitimately — `reason` publishes
no equivalent, so this is not a reimplementation. Once `reason` publishes them,
`.claude/rules/patterns.md` requires `brief` to import them and delete its own; the names would
be `reason`'s.

`reason` is a runtime dependency of `brief`, so this is a runtime bump: `reason` publishes,
`brief` re-pins, re-runs its gates, and republishes. Neither is blocked today — `brief` is
unpublished.

## Status

Raised, not implemented. Implementing it is a change to `reason`, which was outside the
campaign's scope.
