# Proposal Framework

A repeatable framework for turning an opportunity into a defensible solution proposal:

```text
Discovery → Scope → Solution design → Work breakdown → Effort estimate → Price → Proposal
```

The framework is designed for custom software, AI, web, mobile, integration, and automation projects. It is intentionally vendor-neutral and keeps assumptions visible so that pricing is explainable rather than guessed.

## How to use it

1. Complete the discovery brief with the client.
2. Write the in-scope and out-of-scope boundaries.
3. Create the solution outline and identify integrations, risks, and non-functional requirements.
4. Break delivery into work packages.
5. Estimate each work package using low / likely / high effort.
6. Apply your rate card, contingency, and commercial terms.
7. Generate a client-facing proposal from the approved information.

The outputs are decision records. AI can help draft and challenge them, but should never silently invent requirements, effort, or prices.

## Standard deliverables

- `01-discovery-brief.md` — facts, objectives, stakeholders, constraints, and open questions.
- `02-solution-design.md` — recommended approach, architecture, integrations, and alternatives.
- `03-work-breakdown.md` — scoped work packages and acceptance criteria.
- `04-estimation-and-pricing.md` — effort ranges, assumptions, rate calculations, contingency, and price options.
- `05-proposal-outline.md` — client-ready narrative and commercial structure.
- `templates/project-input.json` — structured input for a future estimator application.

## Estimation principles

- Estimate outcomes and work packages, not vague feature labels.
- Use a three-point estimate: optimistic, likely, pessimistic.
- Include delivery work: discovery, UX, development, QA, deployment, project management, documentation, and support.
- Record assumptions separately from requirements.
- Price uncertainty explicitly through contingency or a paid discovery phase.
- Separate fixed-price scope from time-and-materials/change requests.

## Pricing formula

```text
Likely delivery cost = total likely hours × blended hourly cost
Quoted base price    = likely delivery cost × (1 + target margin)
Contingency          = quoted base price × risk contingency %
Quoted project price = quoted base price + contingency + third-party costs
```

Use the high estimate to check whether a fixed-price proposal exposes unacceptable risk. Use an hourly/day rate model for work with unresolved scope.
