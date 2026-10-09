# realtime-channels: lessons

- `listProposalFeedback` registered only `reviewAssignments`; a phase advance publishes `decisionInstance`, so the panel went stale (PR #1815)
- Over-registered mutation channels on a collection delete (PR #1229)
- A manual `invalidate` in `onSuccess` duplicated channel invalidation (PR #1848). `AssignReviewsDialog.tsx` still invalidates `listDecisionReviewAssignments` by hand because neither it nor `assignReviews` registers a channel; the fix is a channel
- Pins reuse the `decisionProposals` channel from `listProposals` (PR #1553)
- `transitionMonitor` relies on synchronous invalidation (PR #1392)
- A fast export broadcast `completed` before the client subscribed; going realtime-only removed polling's self-healing (PR #1750)
- A workflow wrote `processing` without broadcasting, so the client's silence bound became a duration bound (PR #1750)
- Unbounded mutation-id `Set` replaced by a 500-entry FIFO map; registry ref-counting added to avoid hitting the Supabase channel cap (PR #1336)
