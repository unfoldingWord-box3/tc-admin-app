# Show unsupported project types read-only

Status: accepted, 17 September 2026

Writable repositories whose metadata type tC Admin cannot manage, such as translationStudio (`ts`), translationCore (`tc`), and helps repositories, appear in the portfolio as read-only projects with the reason stated. They are never hidden and never treated as errors.

Managers at the pilot partner own dozens of these repositories alongside their Bible projects. Hiding them would make the portfolio misrepresent what the manager is responsible for, and flagging them as failures would train managers to ignore red. Showing them read-only keeps the portfolio honest and reserves the failure states for real problems.

A converter that brings these repositories into Scripture Burrito is deferred to a later milestone. When it arrives it will be a manager-confirmed action, following the same rule as the Resource Container conversion in ADR 0008.
