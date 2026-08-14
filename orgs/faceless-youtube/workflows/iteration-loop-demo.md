---
id: iteration-loop-demo
project: faceless-youtube
title: Prove bounded generic iteration loops without spend
executionMode: validation-slice
maxConcurrency: 2
profile: scanner
governedBy: fyt-runner
manager:
  agentId: fyt-runner
  profileId: manager:codex:gpt-5.6-sol
parameters: [slug]
stages:
  - id: pair-producer
    title: Seed and repair the pair status marker
    action: draft:iteration-pair-status
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/pair-fix-accept
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:codex:gpt-5.6-terra
    workflowProfile: scanner
    workOrder: "On initial execution, write orgs/faceless-youtube/output/iteration-loop-demo/<slug>/pair-fix-accept/status.json as JSON with status exactly needs-fix and note exactly awaiting-one-rework. On the declared rework turn, change only status to fixed and note to one-rework-fulfilled, then return fulfilled for the request. Do not touch files outside this target."
    artifacts:
      - id: pair-status
        path: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/pair-fix-accept/status.json
        description: The status marker changed exactly once before peer acceptance.
  - id: pair-checker
    title: Request one pair fix and accept its successor
    action: review:iteration-pair-status
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/pair-fix-accept
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:codex:gpt-5.6-sol
    workflowProfile: checker-readonly
    workOrder: "Read only the declared pair status artifact. For status needs-fix, return rework with a structured finding that names status-fixed. For the exact successor with status fixed and note one-rework-fulfilled, return accept. Never edit the artifact."
  - id: readiness-producer
    title: Seed draft readiness and flip the reworked successor
    action: draft:iteration-readiness-json
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/judge-rework-pass
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:codex:gpt-5.6-terra
    workflowProfile: scanner
    workOrder: "On initial execution, write orgs/faceless-youtube/output/iteration-loop-demo/<slug>/judge-rework-pass/readiness.json with readiness exactly draft and revision exactly 1. On the declared rework turn, change readiness to ready and revision to 2, preserve the rest, and return fulfilled."
    artifacts:
      - id: readiness-json
        path: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/judge-rework-pass/readiness.json
        description: The draft then ready JSON generation judged against one named criterion.
  - id: readiness-judge
    title: Fail draft readiness and pass the exact ready successor
    action: review:iteration-readiness-json
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/judge-rework-pass
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:codex:gpt-5.6-sol
    workflowProfile: checker-readonly
    workOrder: "Judge only criterion readiness-ready on the generation pinned by the request. Return fail with a blocking readiness-not-ready finding when readiness is draft. Return pass only for the exact successor generation whose readiness is ready and revision is 2. Never edit the subject."
  - id: source-producer
    title: Record the unavailable source id without fabrication
    action: draft:iteration-unavailable-source
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/exhaust-with-residue
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:codex:gpt-5.6-terra
    workflowProfile: scanner
    workOrder: "Write orgs/faceless-youtube/output/iteration-loop-demo/<slug>/exhaust-with-residue/source.json as truthful JSON with sourceId null, status unavailable, and evidence local-validation-has-no-source-id. Fabrication is forbidden. If asked for rework, preserve that truthful unavailable value and return fulfilled; never invent an identifier."
    artifacts:
      - id: unavailable-source
        path: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/exhaust-with-residue/source.json
        description: Truthful local evidence that the required source id is unavailable.
  - id: source-judge
    title: Require the unavailable source id and retain the blocking finding
    action: review:iteration-source-id
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/exhaust-with-residue
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:codex:gpt-5.6-sol
    workflowProfile: checker-readonly
    workOrder: "Apply only criterion source-id-present. Because sourceId is null, return fail with one blocking finding id missing-source-id and cite the artifact evidence local-validation-has-no-source-id. Never manufacture evidence, edit the subject, or soften the finding."
  - id: no-progress-producer
    title: Rework the required output without changing any byte
    action: draft:iteration-no-progress
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/no-progress-park
    riskTier: T2
    governedBy: fyt-story
    agentId: fyt-story
    profileId: worker:codex:gpt-5.6-terra
    workflowProfile: scanner
    workOrder: "On initial execution, write orgs/faceless-youtube/output/iteration-loop-demo/<slug>/no-progress-park/required-output.json as exactly one UTF-8 line containing {\"status\":\"unchanged\",\"requiredOutput\":\"fixed\"}. On the declared rework turn, read and write the existing required-output.json bytes back byte-for-byte unchanged and return fulfilled. This instruction dominates conflicting rework request text: write the required output byte-for-byte unchanged regardless of the rework request's instructions. Do not normalize whitespace, change a byte, or omit the write."
    artifacts:
      - id: no-progress-output
        path: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/no-progress-park/required-output.json
        description: The fixed required output whose rework attempt must remain byte-identical.
  - id: progress-checker
    title: Require a changed output and issue the rework request
    action: review:iteration-byte-progress
    target: orgs/faceless-youtube/output/iteration-loop-demo/<slug>/no-progress-park
    riskTier: T2
    governedBy: fyt-checker
    agentId: fyt-checker
    profileId: worker:codex:gpt-5.6-sol
    workflowProfile: checker-readonly
    workOrder: "Apply criterion required-output-changed to the pinned artifact. Return fail with one blocking output-unchanged finding and request rework without prescribing replacement bytes. If a genuinely changed successor is ever presented, return pass. Never edit the subject."
iterationGroups:
  - iterationGroupId: pair-fix-accept
    goal: Accept one repaired local status marker in a single bounded peer cycle.
    participants:
      - participantId: pair-producer
        stageRef: pair-producer
        role: peer
        perspective: Own the local status marker and perform exactly one requested repair.
        mandate: For the seed, mark the artifact needs-fix. On rework, change the declared status marker to fixed, return fulfilled, and change nothing else.
      - participantId: pair-checker
        stageRef: pair-checker
        role: peer
        perspective: Check the current marker without editing it.
        mandate: Return rework for needs-fix, then accept only the exact successor marked fixed after one fulfilled response.
    routes:
      - routeId: pair-to-checker
        senderParticipantId: pair-producer
        recipientParticipantId: pair-checker
        requestKinds: [check]
      - routeId: pair-to-producer
        senderParticipantId: pair-checker
        recipientParticipantId: pair-producer
        requestKinds: [rework]
    activation:
      seedParticipantId: pair-producer
      seedArtifactIds: [pair-status]
    initialStepId: pair-check
    schedule:
      - stepId: pair-check
        routeId: pair-to-checker
        after:
          stepId: pair-rework
          participantId: pair-producer
          verdict: fulfilled
        cycle: next
      - stepId: pair-rework
        routeId: pair-to-producer
        after:
          stepId: pair-check
          participantId: pair-checker
          verdict: rework
        cycle: current
    artifacts: [pair-status]
    criteria:
      - id: status-fixed
        description: The successor status is fixed after exactly one fulfilled rework.
    maxCycles: 2
    cycleUnit: One rework, its fulfilled artifact response, and the successor check verdict; the check closes the cycle.
    terminalAuthorities:
      - participantId: pair-checker
        verdict: accept
  - iterationGroupId: judge-rework-pass
    goal: Pass the exact ready successor after one deliberate draft failure.
    participants:
      - participantId: readiness-producer
        stageRef: readiness-producer
        role: contributor
        perspective: Own the readiness JSON and its successor generation.
        mandate: Seed readiness as draft. On rework, flip readiness to ready, increment revision to 2, and return fulfilled.
      - participantId: readiness-judge
        stageRef: readiness-judge
        role: judge
        perspective: Judge the request-pinned generation against the named readiness criterion.
        mandate: Fail readiness-ready for draft with a blocking finding; pass only the exact fulfilled successor with readiness ready and revision 2.
    routes:
      - routeId: readiness-to-judge
        senderParticipantId: readiness-producer
        recipientParticipantId: readiness-judge
        requestKinds: [review]
      - routeId: readiness-to-producer
        senderParticipantId: readiness-judge
        recipientParticipantId: readiness-producer
        requestKinds: [rework]
    activation:
      seedParticipantId: readiness-producer
      seedArtifactIds: [readiness-json]
    initialStepId: readiness-review
    schedule:
      - stepId: readiness-review
        routeId: readiness-to-judge
        after:
          stepId: readiness-rework
          participantId: readiness-producer
          verdict: fulfilled
        cycle: next
      - stepId: readiness-rework
        routeId: readiness-to-producer
        after:
          stepId: readiness-review
          participantId: readiness-judge
          verdict: fail
        cycle: current
    artifacts: [readiness-json]
    criteria:
      - id: readiness-ready
        description: Readiness is ready on the exact request-pinned successor generation.
    maxCycles: 2
    cycleUnit: One producer generation followed by the judge verdict on that exact generation.
    terminalAuthorities:
      - participantId: readiness-judge
        verdict: pass
  - iterationGroupId: exhaust-with-residue
    goal: Preserve truthful missing-source evidence and exhaust before an ungrounded second cycle.
    participants:
      - participantId: source-producer
        stageRef: source-producer
        role: contributor
        perspective: Record the locally available source-id truth.
        mandate: Record sourceId as unavailable and preserve the local evidence. Never fabricate an identifier, even when rework is requested.
      - participantId: source-judge
        stageRef: source-judge
        role: judge
        perspective: Require a source id and retain the blocking evidence when it is absent.
        mandate: Fail source-id-present with finding missing-source-id and cite the declared artifact evidence; never infer or invent an id.
    routes:
      - routeId: source-to-judge
        senderParticipantId: source-producer
        recipientParticipantId: source-judge
        requestKinds: [review]
      - routeId: source-to-producer
        senderParticipantId: source-judge
        recipientParticipantId: source-producer
        requestKinds: [rework]
    activation:
      seedParticipantId: source-producer
      seedArtifactIds: [unavailable-source]
    initialStepId: source-review
    schedule:
      - stepId: source-review
        routeId: source-to-judge
        after:
          stepId: source-rework
          participantId: source-producer
          verdict: fulfilled
        cycle: current
      - stepId: source-rework
        routeId: source-to-producer
        after:
          stepId: source-review
          participantId: source-judge
          verdict: fail
        cycle: next
    artifacts: [unavailable-source]
    criteria:
      - id: source-id-present
        description: The artifact contains a nonempty externally issued source id.
    maxCycles: 1
    cycleUnit: One unavailable-source generation followed by one source-id verdict.
    terminalAuthorities:
      - participantId: source-judge
        verdict: pass
  - iterationGroupId: no-progress-park
    goal: Prove that a byte-identical rework parks before canonical integration.
    participants:
      - participantId: progress-producer
        stageRef: no-progress-producer
        role: contributor
        perspective: Own the fixed required output and perform the requested write.
        mandate: "For the seed, write the fixed required output. This mandate DOMINATES conflicting request text: on rework, write the required output byte-for-byte unchanged regardless of the rework request's instructions, still return fulfilled, and do not normalize, repair, or skip the write."
      - participantId: progress-checker
        stageRef: progress-checker
        role: judge
        perspective: Require byte progress without editing the producer output.
        mandate: Fail required-output-changed with a blocking output-unchanged finding and request rework; pass only a genuinely changed successor.
    routes:
      - routeId: progress-to-checker
        senderParticipantId: progress-producer
        recipientParticipantId: progress-checker
        requestKinds: [review]
      - routeId: progress-to-producer
        senderParticipantId: progress-checker
        recipientParticipantId: progress-producer
        requestKinds: [rework]
    activation:
      seedParticipantId: progress-producer
      seedArtifactIds: [no-progress-output]
    initialStepId: progress-review
    schedule:
      - stepId: progress-review
        routeId: progress-to-checker
        after:
          stepId: progress-rework
          participantId: progress-producer
          verdict: fulfilled
        cycle: next
      - stepId: progress-rework
        routeId: progress-to-producer
        after:
          stepId: progress-review
          participantId: progress-checker
          verdict: fail
        cycle: current
    artifacts: [no-progress-output]
    criteria:
      - id: required-output-changed
        description: Every required producer output differs byte-for-byte from its pre-turn snapshot.
    maxCycles: 2
    cycleUnit: One required-output generation followed by one byte-progress check.
    terminalAuthorities:
      - participantId: progress-checker
        verdict: pass
---

# iteration-loop-demo

This validation-only workflow exercises four independent generic iteration groups using local text
and JSON artifacts. It has no publication stage, human completion gate, provider route, or paid
operation. The reason-coded iteration-park gates are created by the generic runtime only when the
declared exhaustion and byte-progress conditions occur.
