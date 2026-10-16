# Erobabe recommendation algorithm

**Current version:** `erobabe-rec-v1` · **Scope:** production public catalog · **Weights:** initial engineering hypotheses, not fitted or research-optimal. See `RECOMMENDATION_RESEARCH.md` and `RECOMMENDATION_AUDIT.md`.

## Pipeline

1. **Eligibility filtering (hard gate):** every candidate query requires `published`, `public`, `rights_status=cleared`, `moderation_status=approved`, and `requires_reupload=false`; it also requires a direct URL, embed URL, or a Bunny provider ID plus library ID. The current watch route repeats publication/playback checks when resolving a slug. Recommendation RPCs repeat eligibility before accepting feedback/events. Ranking cannot bypass this filter.
2. **Bounded candidate generation:** deduplicated SQL retrieval sources include newest eligible videos (up to 60), highest recorded views (60), highest binary likes (60), least-viewed recent candidates (24), current video category (60), matching existing tags (up to 80 IDs), and chosen/liked categories (up to 60). Queries are server-side and the merged pool is bounded; the entire library is never loaded. The metadata/title scorer uses tokens already stored in the catalog. There is no embedding service or per-request LLM.
3. **Feature scoring:** typed pure module `lib/recommendations/ranking.ts`, explicit `erobabe-rec-v1`, normalized features, and deterministic ordering/tie breaks. A missing signal contributes zero (or a documented conservative technical-metadata prior); no feature is extrapolated as learned viewer preference without signals.
4. **Negative feedback and fatigue:** rejected video IDs and explicitly suppressed categories are hard exclusions. “Show less like this” applies a fixed bounded soft penalty to that item's category. Recently played items receive a bounded fatigue penalty. Previously exposed items receive lower novelty. No popularity score can override explicit exclusions.
5. **Diversity reranking:** greedy MMR-like reranking applies a category repetition demotion (0.075 per already-selected item, capped at 0.26), a lexical/tag near-duplicate demotion (up to 0.12), and a modest repeat-impression penalty (0.16). It is deterministic for identical inputs. Exploration comes from fresh and low-exposure candidate sources; it is bounded by retrieval and score, not random.
6. **Surface-specific ordering:** Latest uses strict `(published_at DESC, id DESC)` keyset ordering; Most Liked uses `(like_count DESC, id ASC)`; Featured, Up Next and Recommended use score descending then stable publication/id tie breaks and a score/id keyset cursor. API responses are `private, no-store`.
7. **Measurement:** versioned, validated impressions, card selection, likes, real native/Bunny playback start, actual progress milestones, end-of-media completion, and playback errors are accepted only for an active consented profile. Events are idempotent by viewer hash + client UUID key, and bounded by request validation/rate limits. They are not trusted as fraud-proof ground truth.

## Surface contracts

### Featured

“Featured Videos” is a server-ranked discovery shelf, not a rewrite of the admin hero. The hero remains editorial/admin-selected and has its own placement workflow. The shelf combines high-quality metadata, freshness, low-exposure discovery, some popularity-confidence signal, and a small explicit-preference contribution for opted-in visitors. Homepage logic removes videos already present in Latest and in the editorial hero before display.

### Latest

Chronological, non-personalized, with an explicit “newest first” label. The listing page initially server-renders 24 then keyset-loads more. For equal timestamps, descending UUID is the stable tie-break. Personalized ranking never changes this order.

### Most Liked (not “Top Rated”)

The only existing public feedback aggregate is `like_count`, backed by unique toggled binary likes. There are no stars or negative ratings. Watch-page copy therefore says **Most Liked** and the existing `/popular` page remains **Most Viewed**. Most Liked is sorted by the actual like count and stable UUID tie-break. The UI does not fabricate stars, percentages, review totals, or viewer satisfaction. The ranker uses a logarithmic transform when it needs a bounded popularity-confidence input; it is not presented as a statistical estimate of rating quality. A true Wilson/Bayesian rating estimate is not defensible without both positive and negative trials or a valid impression denominator.

### Up Next

Requires an eligible current video, excludes it, and strongly weights same-category relevance plus token/tag similarity. The current video is context for this shelf only, not a permanent viewer profile. A viewer may use category suppression and later reset it.

### Recommended / cold start

Uses persistent profile data only after a separate explicit opt-in. A profile with explicit interests, recent qualified player events, or feedback can personalize; a just-enabled empty profile is still labelled as discovery rather than falsely advertised as personal. Without consent/history, recent, broadly viewed/liked and underexposed candidates are diversified without asserting a personal taste. New explicit feedback is stored immediately and triggers a server-component refresh.

## Versioned feature configuration

Weights sum to 1 for each ranked surface; changing coefficients requires a new version or documented configuration change and new offline/online evaluation.

| Feature | Recommended | Up Next | Featured | Meaning and normalization |
|---|---:|---:|---:|---|
| Personal category preference | 0.28 | 0.14 | 0.10 | 1 if category was explicitly liked/chosen, else 0; not inferred intimate traits |
| Current-video relevance | 0.18 | 0.40 | 0.12 | 1 for same category; otherwise bounded title/description token Jaccard or normalized tag overlap |
| Playback completion context | 0.17 | 0.12 | 0.08 | 1 when this consented visitor actually reached `ended` for an item in this category within retained event history; completion is not treated as a satisfaction survey |
| Explicit positive video | 0.12 | 0.08 | 0.08 | 1 when the visitor explicitly marked this item “Interested” |
| Freshness | 0.08 | 0.08 | 0.20 | `exp(-age_days / 21)`; unknown publish date = 0 |
| Metadata/confidence | 0.07 | 0.06 | 0.26 | bounded technical quality metadata (HD/4K) plus a small log-normalized exposure-confidence input; not a subjective content-quality judgment |
| Novelty | 0.10 | 0.12 | 0.16 | bounded blend of freshness and low recorded exposure; exact prior impression lowers the input |

Base score is `Σ(weight × feature)` in `[0,1]`; explicit suppression and fatigue are separately applied bounded penalties/exclusions, followed by diversity reranking. View-count normalization is `log1p(view_count)/log1p(10,000)` capped at 1; like-count normalization is `log1p(like_count)/log1p(250)` capped at 1. These scale constants are operational starting hypotheses, not calibrated thresholds.

## Signals deliberately absent or limited

- **No co-watch/collaborative filtering:** no trustworthy aggregate co-watch graph exists. View pages are not qualified watch pairs and must not be converted into one.
- **No trend velocity:** only current view/like aggregates and publication timestamps are available; historical time series do not exist. A sudden trend cannot be asserted. Recency is used instead.
- **No reliable early-skip signal:** time on page is not playback. Native/Bunny player errors are distinct; page exits do not become negative feedback.
- **No numeric ratings:** toggled likes are binary community actions. They are only an aggregate for Most Liked unless the visitor separately opts into recommendation personalization and gives recommendation feedback.
- **No individual/ad targeting:** no adult viewing profile is sent to advertisers, comments, payments, or ad selection.
- **No raw watch-time bonus:** completion is an observed event, capped at category-level signal and never unbounded by seconds watched.

## Pagination and stability

Latest pages by a published timestamp + UUID keyset, not offset. Most Liked pages by like count + UUID. Ranked surfaces use score + UUID keysets over the bounded deterministic pool. If user feedback or retained events change between ranked requests, reranking can change; cards are deduplicated client-side and ranked shelves currently render a bounded first batch, not infinite scrolling. Before enabling ranked infinite scroll, either freeze the candidate order for a feed session with a signed short-lived cursor snapshot or validate snapshot-based pagination against production data. The chronological Latest path is not affected by this limitation.

## Evaluation plan and claims

Unit fixtures cover explicit positive/negative profiles, cold start, missing fields, duplicates, variety, fatigue and stable ties. Migration tests cover eligibility, consent, event idempotency and RLS. Existing production impression history does not exist, so no retrospective lift or offline replay is claimed. Establish production baselines before an experiment. Compare relevant card selections, qualified playback starts/completions, explicit positive/negative feedback, unique-item/category coverage, suppression effectiveness, error rates, and p95 latency. CTR and session duration are diagnostics only. Proposed initial service targets are p95 <250 ms for the bounded feed API and p95 <150 ms for event submission (excluding network/provider playback); **neither has yet been measured against staging or a production catalog**. Do not launch an A/B test until assignment, sample size, metrics, guardrails and duration are pre-registered.
