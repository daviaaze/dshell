# Evidence-grounded video review workflow design

## Goal

Reduce manual steering during UI video reviews. Given a video and a review goal, the assistant should inspect the evidence already produced by the shared `analyze_video` tool, perform complete visual and temporal decomposition, and return a concise set of evidence-backed findings with proposed corrections. The user should not need to ask for additional reviews of generated images or point out missed issues before the assistant proposes improvements.

This is a review-and-propose workflow. It does not edit application code or claim that a visual capture proves unobserved behavior.

## Current boundary

The shared video-analysis extension at `~/.omp/agent/extensions/video-analysis/` extracts temporal and spatial evidence; it does not make aesthetic judgments or run vision-model inference. It probes presentation timestamps, identifies strong changes from grayscale 64×64 region samples, includes first/last frames and at most six strong transitions, accepts optional event-centered sample times and up to four named component regions, and emits native-resolution PNGs, contact sheets, and a manifest. The `decomposed-visual-ux-audit` skill defines visual review dimensions and evidence wording, but does not require an explicit inventory of every generated artifact or a completed review record for every pass.

The existing dshell VM workflow is a source of constraints, not a new runtime dependency: raw screenshots and timestamped interaction evidence are primary artifacts; selected frames are review aids, not proof that every transient was captured. Preserve known timestamp uncertainty, and separate observations, measurements, and hypotheses.

## Approaches considered

1. **Recommended — evidence-first multi-pass review using current artifacts.** Change the review orchestration and report contract. Inventory generated images, review full-screen and component evidence in separate passes, perform a temporal pass, and verify every finding against the cited frame/region. No new model or inference service. This directly addresses repeated requests for image review and missed decomposition; it cannot recover a state absent from the recording or selected evidence.
2. **Automate event and region discovery first.** Add semantic event-window and component-region proposals to the extractor. This could reduce manual timestamp/crop selection, but it adds model/heuristic complexity before establishing whether the primary pain is evidence selection or review coverage. Any proposals would still need human-verifiable timestamps and regions.
3. **Add a video vision/ASR prepass.** Use a separate VLM/ASR system to summarize the recording and nominate events. It may help with speech and broad context, but brings model/runtime costs and unsupported or hallucinated interpretations; it does not replace pixel-grounded UX review.

## Proposed workflow

### 1. Establish review intent

Use the user's review goal when provided. If none is given, perform a general visual/interaction-feedback audit without inventing a product task, persona, or behavioral success criterion. Record the video identity, duration, dimensions, supplied regions, supplied sample times, and available UI/interaction context before reviewing.

### 2. Inventory and cover the evidence

Read the analyzer manifest and enumerate every generated full-screen and component contact sheet and every selected native-resolution frame. Use the contact sheets for overview and temporal ordering; inspect individual native-resolution frames wherever small text, iconography, alignment, or a finding's evidence needs confirmation. Do not stop after the first image or only inspect the images initially highlighted by the user. Maintain an internal coverage ledger mapping each artifact to the passes completed and any capture limitation.

If no explicit action times were supplied, use the selected transition frames as candidate events and inspect neighboring selected frames in source order. Do not claim a continuous or complete transition when only sparse stills are available. When the recording or manifest cannot support a claim, mark it as not demonstrated rather than asking the user to steer to another image before completing the available review.

### 3. Run separate review passes

1. **Whole-screen composition:** hierarchy, density, balance, alignment, clipping, and consistency across states.
2. **Component decomposition:** inspect each named ROI and relevant full-resolution frames for grouping, contrast, typography, copy, icon meaning, control affordance, and target clarity.
3. **Temporal interaction:** compare the available before/during/after states for visible feedback, state changes, confirmation/cancellation, loading, overlays, and regressions. Distinguish a visible transition from inferred causality.
4. **Coverage challenge:** check the inventory for skipped artifacts and reconsider regions/states likely to have been missed. This is a bounded coverage check, not an ungrounded request for the same model to repeat its opinion.

For native/browser surfaces, use available accessibility tree or DOM geometry as corroborating evidence; screenshots remain the source for visual appearance. Do not infer exact CSS or hidden interaction behavior from pixels alone.

### 4. Verify and consolidate findings

Before reporting a finding, perform a distinct evidence check against its cited raw frame or ROI. Reject or qualify claims whose alleged defect is not visible, whose timestamp/region is wrong, or whose impact depends on behavior not demonstrated. Merge duplicates across views and prioritize by user impact and confidence. A second prompted critique by itself is not treated as reliable verification.

Each finding includes:

- severity and confidence;
- video timestamp plus artifact/frame and approximate region;
- the directly observed fact;
- the relevant UX criterion and likely user impact, with hypotheses labeled;
- a concrete proposed correction or the smallest next check needed;
- counter-evidence or limitations when material.

### 5. Deliver one review report

Return a single prioritized report after all required passes, including the evidence coverage summary, findings, what was not demonstrated, and any capture/sampling limitations. Do not wait for the user to request another image review or a separate decomposition pass. Ask a follow-up only when a missing user-owned requirement or context materially changes the evaluation; do not make code changes without a separate user instruction.

## Measurements, constraints, and Jev evidence

Collect machine-readable measurements when they are available; never infer exact padding or CSS values from pixels alone. For a live browser surface, record DOM bounds and computed styles. For the native GTK/libadwaita UI, use the accessible/widget tree and actual widget properties or source-defined styles where exposed. The existing [`STYLEGUIDE.md`](../../STYLEGUIDE.md) documents native colors, classes, typography, and layout properties such as margins, alignment, expansion, and `GtkBox.spacing`; it does not define a universal numeric spacing scale. If a measurement source is unavailable in a video-only review, record a pixel estimate as `ESTIMATED` or mark it `UNAVAILABLE`, not as a measured value.

### Metric record

Each metric observation carries its name, value and unit, component/state, viewport, source and provenance, associated artifact/timestamp/bounds, applicable constraint, and status (`MEASURED`, `DECLARED`, `ESTIMATED`, or `UNAVAILABLE`). `MEASURED` means read from live runtime data; `DECLARED` means extracted from source/configuration; `ESTIMATED` means inferred from pixels. Keep the raw value distinct from any pass/fail judgment.

Collect these categories where supported:

- **Geometry and spacing:** component bounds, margins, gaps, allocation, overlap, clipping, and scroll extent. Record internal padding only when computed from live style/runtime data or source; do not call a screenshot estimate an exact padding measurement.
- **Accessibility and interaction:** accessible role/name/state, focus visibility/order, actionable target size and separation, and visible control-state transitions. Apply WCAG target-size rules with their stated exceptions; mark applicability instead of treating each nominal size threshold as universal.
- **Color and typography:** effective foreground/background colors and computed contrast against the applicable WCAG threshold; font size/weight and text clipping where runtime/source data permits. If image/gradient backgrounds or native rendering prevent a reliable calculation, return `UNAVAILABLE` or require manual review.
- **Project-pattern consistency:** use documented GTK/libadwaita classes, palette variables, typography, and existing component patterns as references. Compare analogous components and flag unexplained deviations; do not invent a global padding token or reject a deliberate variant merely because values differ.
- **Temporal response:** for visible action sequences, retain before/after state, action window, and observed result separately from service/runtime assertions. Report response timing with source uncertainty; do not derive sub-frame latency from sparse capture.

### Constraint sources

Tag every constraint with its authority and strictness:

1. **Normative standard** — e.g. applicable WCAG success criterion, with its threshold, exceptions, and conformance scope.
2. **Project contract** — explicitly documented tokens, component patterns, widget properties, or source-level invariants.
3. **Review heuristic** — guidance such as hierarchy, grouping, affordance, or density; report as a contextual finding, never as a deterministic standards failure.

Only the first two sources can produce a rule-based pass/fail. A missing project rule is not a violation: suggest a candidate contract from established components and request approval before making it normative. Report unknown applicability as `UNKNOWN`, not `FAIL`.

### Jev packet and decision boundary

Send Jev concise candidate-finding packets rather than an unstructured video dump: review goal, observation, metric value and unit, threshold and constraint source, provenance/status, cited frame/time/region, user impact, and proposed correction. Use typed judgments to classify applicability/severity or route a candidate; use evidence verification to check whether the cited pixels or runtime evidence support the claim. Deterministic measurement remains the source of numeric values—Jev must not invent padding, contrast, or geometry. A Jev confidence or `ACT` recommendation is guidance, not authorization to change code; the current contract remains review-and-propose.

Pass only minimum relevant, non-sensitive data to the external Jev service. Do not send full recordings, secrets, or personal content when compact measurements and a sanitized crop suffice. If external verification requires image content that is sensitive or unnecessary, keep the check local or report it as not verified.

The purpose of these metrics is to improve traceability and prioritization, not to convert every design principle into a numeric score or to make the assistant autonomously edit the interface.

## Evidence and research basis

- **UICrit (Duan et al., UIST 2024):** 3,059 expert-designer critiques over 983 mobile screens include marked target regions. The study reports better expert-rated feedback from task/visual examples and coordinate cues than zero-shot prompting, while only 13.1% of initial zero-shot Gemini comments were validated. The single-screen dataset does not evaluate temporal UI behavior. [Paper](https://arxiv.org/abs/2407.08850) · [DOI](https://doi.org/10.1145/3654777.3676381)
- **Adaptive Keyframe Sampling (Tang et al., CVPR 2025):** formulates fixed-budget frame selection using both prompt relevance and video coverage. This motivates retaining broad temporal coverage alongside change-ranked candidates. Its reported results are for long-video QA, not UI defect recall. [Paper](https://openaccess.thecvf.com/content/CVPR2025/html/Tang_Adaptive_Keyframe_Sampling_for_Long_Video_Understanding_CVPR_2025_paper.html)
- **Self-correction survey (Kamoi et al., TACL 2024):** cautions that prompted LLM self-feedback alone does not reliably correct general-task errors; reliable external feedback is a stronger condition. In this workflow, raw screenshots, timestamps, interaction records, and DOM/accessibility measurements are the verification evidence. [Paper](https://aclanthology.org/2024.tacl-1.78/)
- **WiserUI-Bench (Jeon et al., ACL 2026):** evaluates MLLMs against 300 industry A/B-tested UI pairs with empirically observed action outcomes and finds limited understanding of behavioral impact. This supports separating visual observations from claims about user behavior or causal UX impact. [Paper](https://aclanthology.org/2026.acl-long.2049/)
- **Owl Eyes (Liu et al., ASE 2020):** a non-LLM computer-vision detector reported 85% precision, 84% recall, and 90% localization accuracy for a bounded set of GUI display faults such as overlap, occlusion, missing images, null values, and blur. This supports evaluating a specialized detector for concrete rendering failures, not treating its Android benchmark result as expected accuracy on Shade or as a general UX score. [Paper](https://arxiv.org/abs/2009.01417) · [DOI](https://doi.org/10.1145/3324884.3416547)
- **Normative checks:** [WCAG 2.2 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) define measurable criteria and exceptions. [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) explicitly notes automated scans cover only some issues and recommends combining them with manual and inclusive user testing.


These studies inform the workflow; their performance numbers are not expected gains for our tool. Validate changes on our own UI recordings.

## Evaluation and acceptance

Evaluate against a small, retained set of UI recordings with known human-reviewed issues and coverage annotations. Compare the current review process with the proposed process for:

- additional user prompts needed to request image-by-image or component decomposition;
- fraction of generated artifacts with a recorded review pass;
- confirmed-finding recall and false-positive/unsupported-claim rate against the reviewed set;
- correctness of cited timestamps and regions;
- usefulness of proposed corrections as rated by the user/reviewer;
- metric completeness, provenance, applicability handling, and false-pass/false-fail rate for objective constraints;
- agreement between Jev's evidence judgments and reviewer adjudication, without treating Jev confidence as ground truth.

The workflow is acceptable when it completes the required passes without user prompts for more reviews of supplied evidence, accounts for every generated artifact or explicitly marks why it was not inspected, grounds each reported finding in a cited image/time/region, and separates observations from hypotheses. Do not claim improved defect recall until measured on the labeled set. Preserve limitations for unrecorded states, sparse sampling, tiny visual changes, and behavioral effects not observed in the video.

Every objective metric must retain its source, unit, state, and applicability; unavailable measurements must never be reported as passing. Numeric padding/spacing constraints require an approved project contract, and Jev may classify or verify evidence but may not invent metric values or authorize code changes.
