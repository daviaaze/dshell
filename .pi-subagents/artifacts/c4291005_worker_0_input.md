# Task for worker

[Read from: /home/daviaaze/Projects/pessoal/dshell/context.md, /home/daviaaze/Projects/pessoal/dshell/plan.md]

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
Write spec docs for these widgets: applauncher, dock, windowswitcher, wallpaper. Follow docs/specs/_template.md EXACTLY and use docs/specs/bar.md as the quality bar/example. Read every source file under each src/widget/<name>/ directory first. Rules: (1) Every functional row must be grounded in actual code — settings keys from src/lib/settings/schema.ts, behavior from the .tsx sources; do NOT invent features. (2) Visual section must map elements to the real --shade-* tokens defined in src/style/theme.ts CSS_VARS or Adw style classes actually used in the code. (3) Note in the Test plan any current compliance-linter violations for that widget (run `node tools/check-compliance.mjs src/widget/<name>` to get them). (4) Write one file per widget: docs/specs/<name>.md. When done, reply with a one-line-per-widget summary of what you documented.

---
Update progress at: /home/daviaaze/Projects/pessoal/dshell/.pi-subagents/artifacts/progress/c4291005/progress.md

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```