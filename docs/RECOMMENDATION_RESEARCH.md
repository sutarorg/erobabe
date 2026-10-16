# Recommendation research: evidence and design implications

**Research checked:** 16 October 2026 (UTC). This report distinguishes public documentation from independent evidence and from Erobabe-specific engineering hypotheses. The public descriptions of YouTube and Meta systems are first-party accounts, not independent audits, and reveal neither their full models nor their private evaluation data.

## Executive summary

The defensible pattern for Erobabe is a bounded, multi-source candidate pool, a small interpretable ranker, and a post-ranking diversity/fatigue pass. Feed surfaces need different objectives: Latest stays chronological; Up Next uses the current eligible video as context; Featured preserves admin editorial placement; Recommended can personalize only where the visitor has expressly consented. Erobabe currently has likes and page-view counts, not star ratings or reliable completion data. The first version must not pretend otherwise.

Recommendation quality should not be reduced to click-through or time watched. Use explicit preference feedback, qualified playback evidence where actually observable, negative feedback suppression, exposure/coverage/diversity metrics, and user control. Personal viewing data is unusually sensitive here: use a first-party pseudonymous identifier with opt-in, short retention, server-side hashing and reset/delete controls, with anonymous browsing still fully supported.

## 1. Public platform engineering evidence

### YouTube

YouTube's help pages make two useful product distinctions. The homepage is primarily a personalized mix, while Up Next is explicitly contextual to the video currently playing. Its published signal list includes watch history, search history, subscriptions, likes, dislikes and “not interested” feedback; it also says recommendations vary by surface and mentions satisfaction surveys beyond simple watching. YouTube separately states goals of finding content a viewer wants and supporting longer-term satisfaction. This is a public description, not a transferable numerical formula, and does not establish that watch duration is equivalent to satisfaction.

- [How YouTube recommendations work](https://support.google.com/youtube/answer/16089387) (Help Center; consulted 16 Oct 2026; current page, no stable publication date shown).
- [The recommendation system and viewer satisfaction](https://support.google.com/youtube/answer/16533387) (Help Center; consulted 16 Oct 2026; current page, no stable publication date shown).

**Implication:** Use distinct homepage/recommendation and Up Next objectives; treat explicit negative feedback as meaningful; qualify measurable playback outcomes but avoid raw watch-time optimization.

The 2016 RecSys paper by Covington, Adams, and Sargin explicitly describes a two-stage candidate-generation and ranking system at YouTube scale and notes noisy implicit feedback. Its scale and deep-learning model are not appropriate as a blueprint for a much smaller catalog; the separation of retrieval from ranking is a portable architecture principle.

- Covington et al., [Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/), RecSys 2016.

### Meta / Instagram

Meta's newsroom article [“Your Algorithm, Your Words”](https://about.fb.com/news/2026/10/introducing-your-algorithm-facebook/) is dated **13 October 2026**, verified directly in the official result metadata on 16 October 2026. It describes direct topic/preferences controls and real-time feedback for Facebook Feed and Reels, including LLM-assisted interpretation. It supplies no measured effect size or evidence that natural-language interpretation is needed for a smaller product. It is a product announcement, not an independent study. The requested source is therefore current as of the research date.

Instagram's [recommendations reset announcement](https://about.fb.com/news/2024/11/introducing-recommendations-reset-instagram/) is dated **19 November 2024** (updated 14 July 2025 on the page). It describes a reset and existing ways to mark content “not interested” and shape recommendation inputs. This shows a real product control approach; it does not prove a quantified psychological or satisfaction outcome.

Meta Engineering's 2025 [Instagram notification ranking framework](https://engineering.fb.com/2025/09/02/ml-applications/a-new-ranking-framework-for-better-notification-quality-on-instagram/) describes a diversity layer over ranking, including configurable penalties for items similar in content, author, and product type. This concerns notifications, not video-feed recommendations, so it is a relevant engineering analogy, not direct evidence for a particular video diversity weight.

**Implication:** Make the person's feedback and reset/pause controls real and readily available. A simple explicit list of category preferences is sufficient; Erobabe does not need an LLM to interpret prose. Apply transparent, bounded diversity penalties after relevance scoring.

### Retrieval, ranking, and diversity literature

- Covington et al. (2016), above, supports separating candidate retrieval and final scoring at large scale. Erobabe can use indexed SQL retrieval from several sources and deterministic application ranking, not a neural system.
- Duricic, Kowald, Lacic & Lex, [Beyond-Accuracy: A Review on Diversity, Serendipity and Fairness in Recommender Systems Based on Graph Neural Networks](https://arxiv.org/abs/2310.02294), submitted 3 October 2023 (later published in *Frontiers in Big Data*, 2023). This is a literature review scoped to graph-based recommender systems. It surveys beyond-accuracy dimensions and trade-offs, but is not an intervention showing that any one diversity method improves Erobabe outcomes. Treat diversity, novelty and fairness as dimensions that need explicit measurement, not as guaranteed benefits.
- Meta Engineering, above, gives a practical example of a post-ranking similarity penalty. Erobabe can implement a simpler category and recent-exposure penalty, with deterministic tie-breaking.

**Implication:** Build a tractable pipeline: shared eligibility filtering → bounded retrieval from category/context, explicit preferences, latest, and aggregate positive feedback → feature score → negative suppression and category/item fatigue reranking → surface-specific output. Start with categories/titles/tags if schema supports them; do not add embeddings without demonstrated retrieval failure.

### Popularity confidence and implicit feedback limits

A count of views is an exposure/traffic measure, not a rating or an indication of satisfaction. Likes are positive binary feedback and can be toggled, not stars. The project can therefore label a section **Most Liked** and use a conservative confidence adjustment instead of claiming a numeric rating. A Bayesian-smoothed rate (with a documented prior) or Wilson lower confidence bound is a standard statistical response to unstable small denominators, but neither fixes abuse, non-random exposure, or selection bias. Use unique, idempotent feedback records and show sample count only if the product actually counts that feedback.

- Evan Miller, [How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html) (2009), explains the Wilson lower bound for ranking binary feedback while accounting for small samples. It is a technical derivation, not proof of user satisfaction.

**Implication:** Never render fake stars, percentages, reviews, or playback completion. Existing likes and aggregate counts can power “Most Liked”; add qualified playback only if a player emits a reliable event.

## 2. Psychology, attention, and autonomy

### Cognitive load and choice

Cognitive-load research distinguishes working-memory constraints and warns that excessive concurrent information can impede processing. This supports clear, bounded shelves, useful labels, and category navigation rather than an unstructured feed with many undifferentiated choices. The study does not prescribe an ideal number of video cards for this audience or prove that fewer recommendations increase satisfaction.

- Sweller, [Cognitive Load During Problem Solving: Effects on Learning](https://doi.org/10.1207/s15516709cog1202_4), *Cognitive Science* 12(2), 1988.

Choice-overload results are context-sensitive; the popular claim that more choice universally harms decision-making is not supported. A meta-analysis found substantial moderators and no universal choice-overload effect.

- Scheibehenne, Greifeneder & Todd, [Can There Ever Be Too Many Options? A Meta-Analytic Review of Choice Overload](https://doi.org/10.1037/a0018890), *Journal of Consumer Research* 37(3), 2010.

**Implication:** Keep controls and surface purpose legible, allow category browsing, and do not claim there is a scientifically optimal shelf size. Evaluate decision usefulness and user feedback.

### Self-determination and agency

Self-Determination Theory identifies autonomy, competence, and relatedness as basic psychological needs. The theory has broad empirical and meta-analytic support; it is not a tested recommender-system recipe. The recommended interface translation—visible choices, reversible preferences, explanations and reset—is a design hypothesis aligned with autonomy, not proof of a clinical benefit.

- Ryan, Deci et al., [Basic Psychological Needs research and resources](https://selfdeterminationtheory.org/research/basic-psychological-needs/).
- Ryan et al., [We know this much is (meta-analytically) true: A meta-review of meta-analytic findings evaluating self-determination theory](https://doi.org/10.1037/bul0000365), *Psychological Bulletin* 148(11–12), 2022.
- Varshney, [Respect for Human Autonomy in Recommender Systems](https://arxiv.org/abs/2009.02603), posted 5 September 2020. This is a position paper calling for operationalizing autonomy in recommender design, not an empirical trial of Erobabe-like controls.

**Implication:** Interest selection, “not interested,” category suppression, pause, reset, and a clear exit are product requirements. Do not use inferred intimate traits, guilt, urgency, or emotional vulnerability to extend sessions.

### Reward learning and habit claims

Reward-learning mechanisms are real areas of neuroscience and psychology, but popular statements that a particular feed “hacks dopamine” or can precisely predict an individual’s behavior are not supported by the sources used here. Recommender event data is observational and confounded: people choose what to open, exposure is selective, and short sessions or exits can reflect interruptions, device failures, or preference rather than dissatisfaction.

**Implication:** Do not infer motivation or emotional state from clicks, page dwell, early exit, or repeated viewing alone. Use event labels that identify observed facts, not psychological interpretations.

### Persuasion boundaries and dark patterns

The FTC staff report *Bringing Dark Patterns to Light* is dated **September 2022**. It documents design practices that can obscure choices, deceive users, or hinder cancellation and consent. It is a consumer-protection report, not a recommendation-system trial.

- Federal Trade Commission, [Bringing Dark Patterns to Light](https://www.ftc.gov/reports/bringing-dark-patterns-light), September 2022.

**Implication:** Avoid disguised consent, preselected profiling, hidden opt-out, autoplay by default, deceptive urgency, or friction-heavy reset/deletion. These are prohibited product directions, independent of engagement impact.

## 3. Evidence quality and unsupported claims

| Claim | Evidence status | Use in this design |
|---|---|---|
| Separate retrieval from ranking is a common practical architecture | Well-established engineering pattern; published industrial paper | Adopt with small SQL-backed retrieval and a typed scorer |
| Different surfaces can use different signals/objectives | First-party platform documentation | Use a context-led Up Next and chronological Latest |
| Diverse results can mitigate over-specialization and improve coverage | Active research area, with trade-offs and context dependence | Use modest measurable category/item penalties; evaluate |
| User control supports autonomy | Theory and position literature, not a direct causal result for this UI | Provide controls as an ethical product requirement |
| More watch time means more satisfaction | Unsupported as a general equivalence | Do not optimize or declare success by duration alone |
| A click, page visit, or autoplay start means the viewer liked a video | False inference | Record these as distinct events only |
| Dopamine-based “addiction” claims predict individual outcomes from recommendation signals | Popular claim unsupported by this research | Do not use it to justify product decisions |
| A particular ranking weight is scientifically optimal for Erobabe | No evidence available | Treat weights as versioned hypotheses; evaluate before tuning |

## 4. Erobabe design decisions arising from research

1. **Eligibility is a hard gate** using the public catalog's published/public/rights-cleared/moderation-approved/no-reupload conditions and playable identity requirements. Scoring cannot restore a rejected row.
2. **Candidate generation is bounded and multi-source.** SQL retrieval is suitable at current size; no per-request external model or invented user-to-user similarity.
3. **Personalization is opt-in and first-party only.** Explicit category preference and like signals are primary. Playback contributes only when a real player event is observed. Without consent/history, produce a diversified recent/popular cold-start set and state that it is not personalized.
4. **Up Next is contextual. Latest is strictly chronological.** “Featured” preserves admin carousel control and distinguishes editorial placement from algorithmic shelves.
5. **Feedback is actionable.** Interest, not-interest, category suppression, pause/reset, and “why” explanations must affect server-side output, without making controls hard to reverse.
6. **No star ratings where none exist.** Existing `video_likes` is binary/toggleable. Public labels must say “Most Liked” unless a real rating feature is separately designed.
7. **Diversity and fatigue are post-ranking stages.** Use bounded deterministic category spreading, recent repeat exposure and duplicate suppression. Measure catalog coverage and intra-list category variety.
8. **Quality is not raw page time.** Click-through and session duration are diagnostics; explicit feedback, qualified playback starts/completions (where measurable), negative feedback, diversity, coverage, failures, and latency are complementary metrics.
9. **Privacy overrides behavioral prediction.** No ad targeting based on adult viewing, fingerprinting, inferred identity/sexual orientation/health/religion, or account linking. Retain pseudonymous signals only with consent and an explicit deletion path.
10. **No reported uplift absent valid data.** Existing historical impression context is absent, so any offline comparison is a deterministic fixture, not a retrospective production lift. A/B testing begins only after instrumentation, baseline collection, and a defined sample-size plan.

## References (direct URLs)

- YouTube Help, [How YouTube recommendations work](https://support.google.com/youtube/answer/16089387).
- YouTube Help, [The recommendation system and viewer satisfaction](https://support.google.com/youtube/answer/16533387).
- Meta, [Your Algorithm, Your Words](https://about.fb.com/news/2026/10/introducing-your-algorithm-facebook/), 13 Oct 2026.
- Meta, [Reshape Your Instagram With a Recommendations Reset](https://about.fb.com/news/2024/11/introducing-recommendations-reset-instagram/), 19 Nov 2024; updated 14 Jul 2025.
- Meta Engineering, [A New Ranking Framework for Better Notification Quality on Instagram](https://engineering.fb.com/2025/09/02/ml-applications/a-new-ranking-framework-for-better-notification-quality-on-instagram/), 2 Sep 2025.
- FTC, [Bringing Dark Patterns to Light](https://www.ftc.gov/reports/bringing-dark-patterns-light), Sep 2022.
- Duricic et al., [Beyond-Accuracy](https://arxiv.org/abs/2310.02294), 2023.
- Varshney, [Respect for Human Autonomy in Recommender Systems](https://arxiv.org/abs/2009.02603), 2020.
- Self-Determination Theory, [Basic Psychological Needs research](https://selfdeterminationtheory.org/research/basic-psychological-needs/).
- Covington et al., [Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/), 2016.
- Sweller, [Cognitive Load During Problem Solving](https://doi.org/10.1207/s15516709cog1202_4), 1988.
- Scheibehenne et al., [Can There Ever Be Too Many Options?](https://doi.org/10.1037/a0018890), 2010.
- Ryan et al., [SDT meta-review](https://doi.org/10.1037/bul0000365), 2022.
- Miller, [How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html), 2009.

## Research limitations

This report is a focused desk review, not a systematic review. Platform documentation is self-published and proprietary system details remain unavailable. Research syntheses cover broad recommender domains and may not generalize to a premium adult-video catalog. No user research, lawful external production access, historical impression dataset, or production event sample was available in the checkout at research time. Algorithm coefficients therefore remain explicit hypotheses requiring staged evaluation.
