export const meta = {
  name: 'multi-source-synthesis',
  description: 'Analyze many content sources (video/web/pdf/image/audio/text + user-provided knowledge), then plan and build a goal-shaped deliverable via multi-perspective (draft -> discuss/build -> reconcile) synthesis.',
  phases: [
    { title: 'Analyze', detail: 'one agent per source, in parallel' },
    { title: 'Plan', detail: 'design deliverable + synthesizer roles + classify guardrails' },
    { title: 'Draft', detail: '3 role-based synthesizers each propose an answer' },
    { title: 'Discuss', detail: 'synthesizers critique and build on each other' },
    { title: 'Reconcile', detail: 'moderator assembles the deliverable + checks guardrails' },
  ],
}

// ---------- inputs ----------
// args may arrive as a parsed object or as a JSON string (depending on how it was passed); handle both.
let __args = args
if (typeof __args === 'string') {
  try { __args = JSON.parse(__args) } catch (e) { __args = {} }
}
__args = __args || {}
const goal = __args.goal || ''
const directives = __args.directives || ''
const sources = __args.sources || []
const cachedBriefs = __args.cachedBriefs || []
const scratchDir = __args.scratchDir || '.'

// Applied to every text-producing agent so all human-readable prose is run through the humanizer skill.
const HUMANIZE_INSTRUCTION =
  'HUMANIZE EVERY PROSE FIELD YOU PRODUCE. Before you return, invoke the humanizer skill (use the Skill tool with name "humanizer:humanizer") and apply it to all human-readable prose you are about to output (writeups, proposals, recommendations, summaries, the deliverable, etc.), then return the humanized text. The humanizer strips AI-writing tells. If for any reason you cannot invoke the skill, still apply its principles yourself: avoid inflated symbolism, promotional language, superficial -ing openers, vague attributions, em dash overuse, the rule of three, AI buzzwords, needless passive voice, negative parallelisms ("not just X, but Y"), and filler phrases. Write plainly, specifically, and the way a real person would.'

// ---------- schemas ----------
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source_id: { type: 'string' },
    source_ref: { type: 'string' },
    source_type: { type: 'string' },
    title: { type: 'string' },
    accessible: { type: 'boolean' },
    what_it_is: { type: 'string', description: 'one line: what this source is' },
    goal_relevance: { type: 'string', description: 'how this source serves the goal' },
    substance: { type: 'string', description: 'the actual information conveyed, in detail, including step-by-step reasoning / choices + rationale where present' },
    key_takeaways: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          point: { type: 'string' },
          reasoning: { type: 'string' },
          locator: { type: 'string', description: 'timestamp / paragraph / page' },
        },
        required: ['point'],
      },
    },
    notable_specifics: { type: 'array', items: { type: 'string' } },
    writeup: { type: 'string', description: 'self-contained human-readable markdown: what it is, what it says, what matters for the goal' },
    confidence: { type: 'string' },
  },
  required: ['source_id', 'source_ref', 'source_type', 'accessible', 'goal_relevance', 'substance', 'key_takeaways', 'writeup'],
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deliverable_description: { type: 'string' },
    deliverable_format: { type: 'string', description: 'literal format, e.g. "5-page markdown paper", "ranked tech-stack table with rationale", "list of 10 gifts"' },
    synthesizer_roles: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          lens: { type: 'string' },
          focus: { type: 'string' },
        },
        required: ['name', 'lens'],
      },
    },
    soft_preferences: { type: 'array', items: { type: 'string' } },
    hard_guardrails: { type: 'array', items: { type: 'string' } },
    process_notes: { type: 'string', description: 'adaptation: fact-heavy -> corroboration/accuracy; analysis-heavy -> reasoning/weighing' },
    provided_knowledge_handling: { type: 'string' },
  },
  required: ['deliverable_description', 'deliverable_format', 'synthesizer_roles', 'soft_preferences', 'hard_guardrails'],
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string' },
    proposal: { type: 'string', description: 'your constructed answer toward the deliverable, grounded in sources (cite by id)' },
    reasoning: { type: 'string' },
    key_picks: { type: 'array', items: { type: 'string' } },
  },
  required: ['role', 'proposal'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string' },
    concessions: { type: 'string' },
    pushbacks: { type: 'string' },
    combined_recommendation: { type: 'string', description: 'the stronger answer built by combining the best across all three' },
  },
  required: ['role', 'combined_recommendation'],
}

// The deliverable itself is produced as free-form text (see writerPrompt), NOT crammed into a
// JSON field — large long-form content in a schema string field causes agents to stub out.
// This schema is only for the short wrap-up (discussion summary + guardrail check).
const WRAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    discussion_summary: { type: 'string', description: 'how the three built/debated to the answer: agreements, key disagreements, what won and why' },
    guardrail_check: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          guardrail: { type: 'string' },
          status: { type: 'string', description: 'met / not met / unverifiable' },
          note: { type: 'string' },
        },
        required: ['guardrail', 'status'],
      },
    },
  },
  required: ['discussion_summary'],
}

// ---------- helpers ----------
function detectType(s) {
  const lower = String(s).toLowerCase()
  const isUrl = lower.startsWith('http://') || lower.startsWith('https://')
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'video'
  const noQuery = lower.split('?')[0].split('#')[0]
  const m = noQuery.match(/\.([a-z0-9]+)$/)
  const ext = m ? m[1] : ''
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].indexOf(ext) !== -1) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].indexOf(ext) !== -1) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].indexOf(ext) !== -1) return 'image'
  if (isUrl) return 'website'
  return 'text'
}

function toolGuidance(src) {
  switch (src.type) {
    case 'video':
      return 'This is a video. Load the video-vision tools via ToolSearch (query: "select:mcp__plugin_claude-video-vision_claude-video-vision__video_analyze,mcp__plugin_claude-video-vision_claude-video-vision__video_watch") and use them to watch/analyze the video. Capture spoken content, on-screen text, and the structure of what is presented.'
    case 'audio':
      return 'This is an audio file. Load the video-vision tools via ToolSearch (query: "select:mcp__plugin_claude-video-vision_claude-video-vision__video_analyze,mcp__plugin_claude-video-vision_claude-video-vision__video_watch") — they transcribe audio via whisper — and analyze the audio. Capture everything said.'
    case 'website':
      return 'This is a web page. Load WebFetch via ToolSearch (query: "select:WebFetch"), fetch the URL, and extract its substantive content. If the page returns little usable content (JS-heavy app, paywall, login wall), set accessible=false and explain.'
    case 'pdf':
      return 'This is a PDF. If the ref is a LOCAL path, use Read with the pages parameter to read it. If it is a URL, first download it with the Bash tool: curl -L -o "' + scratchDir + '/dl_' + src.id + '.pdf" "' + src.ref + '" — then Read that downloaded file with the pages parameter. Extract the substantive content.'
    case 'image':
      return 'This is an image. Use Read on the ref to view it (you can see images, including any text in the image). Extract all text and meaningful visual content.'
    case 'user-provided':
      return 'The user provided this knowledge directly. Treat the following as the source content; do NOT fetch anything external:\n"""\n' + (src.content || '') + '\n"""'
    default:
      return 'This is a local text/document file. Use Read on the ref to read it fully and extract its substantive content.'
  }
}

function analysisPrompt(src) {
  return (
    'YOUR GOAL: ' + goal + '\n\n' +
    'Analyze the following source FOR THE PURPOSE OF ACHIEVING THIS GOAL. Prioritize what is relevant to the goal, but capture the underlying information AND the reasoning behind any conclusions — enough detail that a downstream agent never needs the original source. Where the source presents a sequence or decision process (e.g. steps, options weighed, a choice made with justification), capture each step/choice AND its rationale.\n\n' +
    'Source id: ' + src.id + '\n' +
    'Source type: ' + src.type + '\n' +
    'Source ref: ' + src.ref + '\n\n' +
    toolGuidance(src) + '\n\n' +
    'Then return a structured brief. The "writeup" field MUST be a self-contained, human-readable markdown section covering: what this source is about, what it says/claims, and what matters for the goal. Set source_id="' + src.id + '" and source_ref=' + JSON.stringify(src.ref) + ' and source_type="' + src.type + '". If the source is inaccessible or yields almost no usable content, set accessible=false and explain in the writeup — do not fabricate content.' +
    '\n\n' + HUMANIZE_INSTRUCTION
  )
}

function briefsForSynth(list) {
  return list.map(function (b) {
    return {
      id: b.source_id,
      type: b.source_type,
      title: b.title,
      accessible: b.accessible,
      what_it_is: b.what_it_is,
      goal_relevance: b.goal_relevance,
      substance: b.substance,
      key_takeaways: b.key_takeaways,
      notable_specifics: b.notable_specifics,
      confidence: b.confidence,
    }
  })
}

function plannerPrompt(list) {
  return (
    'You are the strategy planner for a multi-source synthesis.\n\n' +
    'USER GOAL: ' + goal + '\n\n' +
    'USER DIRECTIVES (raw — may contain the user\'s own knowledge, soft preferences, and hard rules): ' + (directives || '(none)') + '\n\n' +
    'You have analyzed briefs from ' + list.length + ' sources:\n' +
    JSON.stringify(briefsForSynth(list), null, 2) + '\n\n' +
    'Design the synthesis strategy to BEST ACHIEVE THE GOAL. Decide:\n' +
    '1. deliverable_description + deliverable_format: what the final output should literally be, shaped to the goal (e.g. a 5-page paper, a ranked tech stack with rationale, a list of 10 gifts, a debate verdict).\n' +
    '2. synthesizer_roles: EXACTLY 3 roles tailored to producing THIS deliverable (e.g. for a paper: thesis-architect / evidence-integrator / skeptic-editor; for a stack: requirements-mapper / tool-evaluator / integration-architect; for a debate: steelman-A / steelman-B / adjudicator). Give each a name, lens, and focus.\n' +
    '3. Classify the user directives into soft_preferences (biases/weightings) and hard_guardrails (must-satisfy constraints: counts, budgets, must-include sources, availability, source weightings stated as requirements). If the user explicitly called something a hard guardrail, it IS hard.\n' +
    '4. process_notes: adapt to whether the sources are fact-heavy (emphasize corroboration/accuracy) or analysis-heavy (emphasize reasoning/weighing of arguments).\n' +
    '5. provided_knowledge_handling: note any user-provided knowledge and how heavily to weight it.\n\n' +
    'Return the structured plan.'
  )
}

function draftPrompt(plan, role, list) {
  return (
    'You are a synthesizer with role "' + role.name + '". Your lens: ' + role.lens + '. Focus: ' + (role.focus || '(general)') + '.\n\n' +
    'USER GOAL: ' + goal + '\n' +
    'The deliverable we are jointly producing: ' + plan.deliverable_description + ' (format: ' + plan.deliverable_format + ').\n' +
    'Soft preferences: ' + (plan.soft_preferences.join('; ') || 'none') + '\n' +
    'HARD guardrails (must satisfy): ' + (plan.hard_guardrails.join('; ') || 'none') + '\n\n' +
    'Source briefs:\n' + JSON.stringify(briefsForSynth(list), null, 2) + '\n\n' +
    'From YOUR perspective, draft your best proposal toward the deliverable — actually construct your version of it, grounded in the sources (cite sources by id). Respect all hard guardrails. Return proposal + reasoning + key_picks.' +
    '\n\n' + HUMANIZE_INSTRUCTION
  )
}

function critiquePrompt(plan, role, mine, others, list) {
  return (
    'You are synthesizer "' + role.name + '" (lens: ' + role.lens + ').\n\n' +
    'YOUR draft:\n' + JSON.stringify(mine, null, 2) + '\n\n' +
    'The OTHER synthesizers proposed:\n' + JSON.stringify(others, null, 2) + '\n\n' +
    'USER GOAL: ' + goal + '. Deliverable: ' + plan.deliverable_description + '.\n' +
    'HARD guardrails: ' + (plan.hard_guardrails.join('; ') || 'none') + '\n\n' +
    'Engage with their proposals. Where do you concede they are better? Where do you push back? Then — importantly — BUILD: combine the best elements across all three into a stronger recommendation toward the deliverable. Keep the goal and hard guardrails central. Return concessions, pushbacks, and your combined_recommendation.' +
    '\n\n' + HUMANIZE_INSTRUCTION
  )
}

function writerPrompt(plan, critiques, list) {
  return (
    'You are the lead writer. Produce the FINAL deliverable the user asked for, reconciling the three synthesizers after their discussion.\n\n' +
    'USER GOAL: ' + goal + '\n' +
    'Deliverable to produce: ' + plan.deliverable_description + '\n' +
    'Format: ' + plan.deliverable_format + '\n' +
    'Soft preferences: ' + (plan.soft_preferences.join('; ') || 'none') + '\n' +
    'HARD guardrails (MUST be satisfied; if any genuinely cannot be, say so in-line): ' + (plan.hard_guardrails.join('; ') || 'none') + '\n\n' +
    'Source briefs (for grounding/citation by id):\n' + JSON.stringify(briefsForSynth(list), null, 2) + '\n\n' +
    'The synthesizers\' combined recommendations after their discussion (this is your richest input — build the deliverable from it):\n' + JSON.stringify(critiques, null, 2) + '\n\n' +
    'Write the deliverable now: fully, in the specified format, grounded in the sources (cite by id where relevant), respecting every hard guardrail. For constraints needing live data (price, availability, etc.), verify via web where possible (load WebFetch via ToolSearch) and mark anything you cannot confirm as unverified rather than asserting it.\n\n' +
    'OUTPUT FORMAT: return ONLY the finished deliverable as clean markdown. No preamble, no JSON, no meta-commentary, no notes about your process. The text you return IS the final product the user reads.\n\n' +
    HUMANIZE_INSTRUCTION
  )
}

function wrapPrompt(plan, critiques, deliverable) {
  return (
    'You are wrapping up a multi-perspective synthesis. Produce two short outputs only.\n\n' +
    'USER GOAL: ' + goal + '\n' +
    'HARD guardrails: ' + (plan.hard_guardrails.join('; ') || 'none') + '\n\n' +
    'The three synthesizers\' combined recommendations:\n' + JSON.stringify(critiques, null, 2) + '\n\n' +
    'The final deliverable that was produced:\n"""\n' + deliverable + '\n"""\n\n' +
    '1. discussion_summary: a concise account of how the three perspectives built and debated their way to the answer — where they agreed, the key disagreements, and what won and why. A few short paragraphs.\n' +
    '2. guardrail_check: for EACH hard guardrail, give status (met / not met / unverifiable) plus a brief note on how the deliverable satisfies or fails it.\n\n' +
    HUMANIZE_INSTRUCTION
  )
}

function assembleReport(plan, list, drafts, critiques, deliverable, wrap) {
  const lines = []
  lines.push('# ' + goal)
  lines.push('')
  lines.push('> **Deliverable:** ' + plan.deliverable_description)
  lines.push('> **Sources analyzed:** ' + list.length)
  if (plan.hard_guardrails && plan.hard_guardrails.length) lines.push('> **Hard guardrails:** ' + plan.hard_guardrails.join(' · '))
  if (plan.soft_preferences && plan.soft_preferences.length) lines.push('> **Soft preferences:** ' + plan.soft_preferences.join(' · '))
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 1. Source Briefs')
  lines.push('')
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    const title = b.title || b.source_ref
    const flag = b.accessible === false ? ' [!] (limited / inaccessible)' : ''
    lines.push('### ' + b.source_id + ' — ' + title + ' (' + b.source_type + ')' + flag)
    lines.push('')
    lines.push(b.writeup || '(no writeup)')
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('## 2. The Discussion')
  lines.push('')
  lines.push('Synthesized by three perspectives:')
  for (let i = 0; i < plan.synthesizer_roles.length; i++) {
    const r = plan.synthesizer_roles[i]
    lines.push('- **' + r.name + '** — ' + r.lens)
  }
  lines.push('')
  lines.push(wrap.discussion_summary || '')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 3. The Deliverable')
  lines.push('')
  lines.push(deliverable || '')
  lines.push('')
  if (wrap.guardrail_check && wrap.guardrail_check.length) {
    lines.push('### Guardrail check')
    lines.push('')
    lines.push('| Guardrail | Status | Note |')
    lines.push('| --- | --- | --- |')
    for (let i = 0; i < wrap.guardrail_check.length; i++) {
      const g = wrap.guardrail_check[i]
      lines.push('| ' + g.guardrail + ' | ' + g.status + ' | ' + (g.note || '') + ' |')
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ---------- run ----------
const cachedRefs = {}
for (let i = 0; i < cachedBriefs.length; i++) cachedRefs[cachedBriefs[i].source_ref] = true

const toAnalyze = []
for (let i = 0; i < sources.length; i++) {
  const s = sources[i]
  const ref = typeof s === 'string' ? s : s.ref
  if (cachedRefs[ref]) continue
  const type = (typeof s === 'object' && s.type) ? s.type : detectType(ref)
  toAnalyze.push({
    id: 'src_' + (cachedBriefs.length + toAnalyze.length + 1),
    ref: ref,
    type: type,
    content: (typeof s === 'object' && s.content) ? s.content : '',
  })
}

log('Sources: ' + sources.length + ' total · ' + cachedBriefs.length + ' cached/reused · ' + toAnalyze.length + ' to analyze')

phase('Analyze')
const freshBriefs = (await parallel(toAnalyze.map(function (src) {
  return function () {
    return agent(analysisPrompt(src), { label: 'analyze:' + src.type + ':' + src.id, phase: 'Analyze', schema: BRIEF_SCHEMA })
  }
}))).filter(Boolean)

const briefs = cachedBriefs.concat(freshBriefs)

if (briefs.length === 0) {
  return { reportMarkdown: '# ' + goal + '\n\nNo sources could be analyzed. Check the links/paths and try again.', briefs: [], plan: null }
}

const accessibleCount = briefs.filter(function (b) { return b.accessible !== false }).length
log('Analyzed: ' + briefs.length + ' briefs (' + accessibleCount + ' usable, ' + (briefs.length - accessibleCount) + ' limited/inaccessible)')

phase('Plan')
const plan = await agent(plannerPrompt(briefs), { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA })
log('Deliverable: ' + plan.deliverable_description)
log('Roles: ' + plan.synthesizer_roles.map(function (r) { return r.name }).join(', '))
if (plan.hard_guardrails.length) log('HARD guardrails: ' + plan.hard_guardrails.join(' · '))
if (plan.soft_preferences.length) log('SOFT preferences: ' + plan.soft_preferences.join(' · '))

phase('Draft')
const drafts = (await parallel(plan.synthesizer_roles.map(function (role) {
  return function () {
    return agent(draftPrompt(plan, role, briefs), { label: 'draft:' + role.name, phase: 'Draft', schema: DRAFT_SCHEMA })
  }
}))).filter(Boolean)

phase('Discuss')
const critiques = (await parallel(plan.synthesizer_roles.map(function (role, i) {
  return function () {
    const mine = drafts[i]
    const others = drafts.filter(function (_, j) { return j !== i })
    return agent(critiquePrompt(plan, role, mine, others, briefs), { label: 'discuss:' + role.name, phase: 'Discuss', schema: CRITIQUE_SCHEMA })
  }
}))).filter(Boolean)

phase('Reconcile')
// Write the deliverable as free-form text (no schema) so long-form content is not stubbed into a JSON field.
const deliverable = await agent(writerPrompt(plan, critiques, briefs), { label: 'write-deliverable', phase: 'Reconcile' })
// Small structured wrap-up: discussion summary + guardrail check.
const wrap = await agent(wrapPrompt(plan, critiques, deliverable), { label: 'wrap-up', phase: 'Reconcile', schema: WRAP_SCHEMA })

const reportMarkdown = assembleReport(plan, briefs, drafts, critiques, deliverable, wrap)
return { reportMarkdown: reportMarkdown, briefs: briefs, plan: plan, deliverable: deliverable }
