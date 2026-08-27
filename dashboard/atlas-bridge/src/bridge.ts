import { BridgeError } from './errors.js';
import { DashboardClient } from './client.js';
import { redactValue } from './redact.js';
import { MUTATION_TOOLS, toolDefinitions, type ToolDefinition } from './tools.js';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTATIONS = new Set(MUTATION_TOOLS.map((tool) => tool.name));
const ORDINARY_REQUEST_KINDS = new Set(['question', 'clarification', 'info', 'choice']);
const FORBIDDEN_MUTATION_KEYS = /^(?:authorization|cookie|set-cookie|assertion|ceremonyid|env|secret.*|tokens?|credential.*|password|command|shell|args|deploy.*|budget|spend|payment|privilege.*|permission.*|role)$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;
const INDEX_SUMMARY_KEYS = new Set(['generatedAt', 'summary', 'counts', 'totals', 'status']);
type ListKind = 'agents' | 'workflows' | 'runs' | 'inbox' | 'schedules' | 'history' | 'search'
  | 'grades' | 'traces' | 'terminals';
const LIST_KEYS: Readonly<Record<ListKind, readonly string[]>> = {
  agents: ['items', 'agents'], workflows: ['items', 'workflows'], runs: ['items', 'runs'],
  inbox: ['items', 'inbox', 'requests'], schedules: ['items', 'schedules'], history: ['items', 'commits', 'history'],
  search: ['items', 'matches', 'results'], grades: ['items', 'rows', 'grades'],
  traces: ['items', 'sessions', 'traces', 'rows'], terminals: ['items', 'sessions', 'terminals'],
};
const MUTATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  kb_agent_create: ['definition', 'expected_collection_revision', 'idempotency_key'],
  kb_agent_update: ['agent_id', 'definition', 'expected_source_revision', 'idempotency_key'],
  kb_workflow_create: ['definition', 'expected_collection_revision', 'idempotency_key'],
  kb_workflow_update: ['workflow_id', 'definition', 'expected_source_revision', 'idempotency_key'],
  kb_workflow_launch: ['workflow_id', 'expected_source_revision', 'idempotency_key', 'parameters', 'composer_ref'],
  kb_agent_launch: ['agent_id', 'expected_source_revision', 'idempotency_key'],
  kb_human_respond: ['run_ref', 'request_ref', 'request_kind', 'expected_revision', 'decision', 'response', 'idempotency_key'],
  kb_review_dispatch: ['review_profile', 'target_ref', 'context', 'idempotency_key'],
  kb_schedule_create: ['owner', 'cadence', 'expected_collection_revision', 'idempotency_key'],
  kb_schedule_set_armed: ['schedule_id', 'armed', 'expected_version', 'idempotency_key'],
  kb_schedule_delete: ['schedule_id', 'expected_version', 'idempotency_key'],
  kb_run_control: ['run_ref', 'action', 'expected_run_version', 'expected_manager_generation', 'idempotency_key'],
};

function record(value: unknown, field = 'arguments'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeError('invalid_arguments', `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function textArg(args: Record<string, unknown>, key: string, safeRef = false): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384 || (safeRef && !SAFE_REF.test(value))) {
    throw new BridgeError('invalid_arguments', `${key} is invalid`);
  }
  return value;
}

function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  return textArg(args, key);
}

function intArg(args: Record<string, unknown>, key: string, fallback?: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new BridgeError('invalid_arguments', `${key} is invalid`);
  }
  return value;
}

function query(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function bounded(value: unknown, arrayLimit = 200, depth = 0, stringLimit?: number): unknown {
  if (depth > 10) return '[TRUNCATED]';
  if (typeof value === 'string' && stringLimit !== undefined && value.length > stringLimit) {
    return `${value.slice(0, stringLimit - 3)}...`;
  }
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => bounded(item, arrayLimit, depth + 1, stringLimit));
  if (value === null || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key] = bounded(item, arrayLimit, depth + 1, stringLimit);
  return output;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function first(item: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (item[key] !== undefined) return item[key];
  return undefined;
}

function text(value: unknown, limit?: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return limit !== undefined && value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function count(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compact(entries: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function firstThree(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value.slice(0, 3) : undefined;
}

function projectItem(kind: ListKind, value: unknown): Record<string, unknown> {
  const item = optionalRecord(value) ?? {};
  if (kind === 'agents') {
    const ledger = optionalRecord(item.ledger);
    const lastActive = first(item, 'lastActive', 'last_active') ?? first(ledger ?? {}, 'lastActive', 'last_active');
    return compact({
      id: first(item, 'id', 'ref', 'agentId', 'agent_id', 'slug'), displayName: first(item, 'displayName', 'display_name', 'name'),
      role: item.role, working: first(item, 'working', 'isWorking'), current: first(item, 'current', 'currentCard', 'currentTask'),
      ledger: lastActive === undefined ? undefined : { lastActive },
      cardCount: first(item, 'cardCount', 'card_count') ?? count(item.cards),
      project: item.project, projects: firstThree(item.projects), shortRef: first(item, 'shortRef', 'short_ref'),
    });
  }
  if (kind === 'workflows') return compact({
    id: first(item, 'id', 'ref', 'workflowId', 'workflow_id'), title: first(item, 'title', 'displayName', 'name'),
    project: item.project, profile: item.profile, riskTier: first(item, 'riskTier', 'risk_tier'),
    launchable: item.launchable, valid: item.valid,
    stageCount: first(item, 'stageCount', 'stage_count') ?? count(item.stages),
    compileError: text(first(item, 'compileError', 'compile_error'), 200),
  });
  if (kind === 'runs') return compact({
    id: first(item, 'id', 'ref', 'runRef', 'run_ref', 'runId', 'run_id'), workflow: first(item, 'workflow', 'workflowId', 'workflow_id'),
    status: item.status, startedAt: first(item, 'startedAt', 'started_at'), endedAt: first(item, 'endedAt', 'ended_at'),
  });
  if (kind === 'inbox') return compact({
    id: first(item, 'id', 'ref', 'requestRef', 'request_ref', 'subjectRef', 'subject_ref', 'intentRef', 'intent_ref'), kind: item.kind,
    title: text(first(item, 'title', 'subject', 'displayName', 'name'), 200),
    createdAt: first(item, 'createdAt', 'created_at'), agent: first(item, 'agent', 'agentId', 'agent_id', 'owner'),
  });
  if (kind === 'schedules') return compact({
    id: first(item, 'id', 'ref', 'scheduleId', 'schedule_id'), name: first(item, 'name', 'displayName'), cron: item.cron,
    interval: first(item, 'interval', 'cadence'), armed: first(item, 'armed', 'enabled'),
    next: first(item, 'next', 'nextRun', 'nextRunAt', 'next_run_at'),
  });
  if (kind === 'history') return compact({
    id: first(item, 'id', 'hash', 'sha', 'commit'), message: text(first(item, 'message', 'subject', 'title'), 200),
    author: first(item, 'author', 'authorName', 'author_name'), date: first(item, 'date', 'timestamp', 'committedAt'),
  });
  if (kind === 'search') return compact({
    path: first(item, 'path', 'file', 'filename'), line: first(item, 'line', 'lineNumber', 'line_number'),
    title: text(first(item, 'title', 'name'), 200), snippet: text(first(item, 'snippet', 'text', 'content'), 200), score: item.score,
  });
  if (kind === 'grades') return compact({
    id: first(item, 'id', 'cardId', 'card_id'), worker: first(item, 'worker', 'agent'), task: first(item, 'task', 'action'),
    grade: first(item, 'grade', 'score'), status: first(item, 'status', 'result'), timestamp: first(item, 'timestamp', 'createdAt', 'date'),
  });
  if (kind === 'traces') return compact({
    id: first(item, 'id', 'sessionId', 'session_id'), title: text(first(item, 'title', 'name'), 200),
    agent: first(item, 'agent', 'agentId'), startedAt: first(item, 'startedAt', 'createdAt'),
    updatedAt: first(item, 'updatedAt', 'lastActive'), turns: count(first(item, 'turns', 'messages', 'count')),
  });
  return compact({
    id: first(item, 'id', 'sessionId', 'session_id'), name: first(item, 'name', 'title'), status: item.status,
    cwd: first(item, 'cwd', 'workingDirectory'), agent: first(item, 'agent', 'owner'), startedAt: first(item, 'startedAt', 'createdAt'),
  });
}

function listValues(value: unknown, kind: ListKind): { values: readonly unknown[]; total?: number } {
  if (Array.isArray(value)) return { values: value };
  const root = optionalRecord(value) ?? {};
  const data = root.data;
  if (Array.isArray(data)) return { values: data, total: count(root.total) ?? count(optionalRecord(root.meta)?.total) };
  const container = optionalRecord(data) ?? root;
  for (const key of LIST_KEYS[kind]) {
    if (Array.isArray(container[key])) {
      return { values: container[key], total: count(container.total) ?? count(root.total) ?? count(optionalRecord(root.meta)?.total) };
    }
  }
  return { values: [], total: count(container.total) ?? count(root.total) };
}

function paginate(value: unknown, kind: ListKind, args: Record<string, unknown>): Record<string, unknown> {
  const limit = intArg(args, 'limit', 20, 1, 100);
  const offset = intArg(args, 'offset', 0);
  const source = listValues(value, kind);
  const total = source.total ?? source.values.length;
  const items = source.values.slice(offset, offset + limit).map((item) => projectItem(kind, item));
  return { items, total, offset, limit, next_offset: offset + items.length < total ? offset + items.length : null };
}

function definition(args: Record<string, unknown>): Record<string, unknown> {
  const value = record(args.definition, 'definition');
  exactKeys(value, ['name', 'description'], 'definition');
  if (value.name !== undefined) optionalText(value, 'name');
  if (value.description !== undefined) optionalText(value, 'description');
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field = 'arguments'): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new BridgeError('invalid_arguments', `${field} contains unknown field ${key}`);
  }
}

function rejectForbiddenMutationFields(value: unknown, depth = 0): void {
  if (depth > 20) throw new BridgeError('invalid_arguments', 'arguments are too deeply nested');
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenMutationFields(item, depth + 1);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_MUTATION_KEYS.test(key)) throw new BridgeError('invalid_arguments', 'forbidden mutation field');
    rejectForbiddenMutationFields(item, depth + 1);
  }
}

function validateMutationArguments(name: string, args: Record<string, unknown>): void {
  rejectForbiddenMutationFields(args);
  exactKeys(args, MUTATION_FIELDS[name] ?? [], 'arguments');
  const tool = MUTATION_TOOLS.find((candidate) => candidate.name === name);
  const required = tool?.inputSchema.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && !Object.hasOwn(args, key)) {
        throw new BridgeError('invalid_arguments', `${key} is required`);
      }
    }
  }
  if (args.parameters !== undefined) exactKeys(record(args.parameters, 'parameters'), [], 'parameters');
  if (args.context !== undefined) exactKeys(record(args.context, 'context'), [], 'context');
  if (args.definition !== undefined) definition(args);
  const idempotencyKey = textArg(args, 'idempotency_key');
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new BridgeError('invalid_arguments', 'idempotency_key is invalid');
  switch (name) {
    case 'kb_agent_create':
    case 'kb_workflow_create': textArg(args, 'expected_collection_revision'); break;
    case 'kb_agent_update': textArg(args, 'agent_id', true); textArg(args, 'expected_source_revision'); break;
    case 'kb_workflow_update': textArg(args, 'workflow_id', true); textArg(args, 'expected_source_revision'); break;
    case 'kb_workflow_launch':
      textArg(args, 'workflow_id', true); textArg(args, 'expected_source_revision');
      if (args.composer_ref !== undefined) textArg(args, 'composer_ref', true);
      break;
    case 'kb_agent_launch': textArg(args, 'agent_id', true); textArg(args, 'expected_source_revision'); break;
    case 'kb_human_respond':
      textArg(args, 'request_ref', true); intArg(args, 'expected_revision'); textArg(args, 'decision');
      if (args.run_ref !== undefined) textArg(args, 'run_ref', true);
      if (args.request_kind !== undefined) textArg(args, 'request_kind');
      if (args.response !== undefined) textArg(args, 'response');
      break;
    case 'kb_review_dispatch': textArg(args, 'review_profile', true); textArg(args, 'target_ref'); break;
    case 'kb_schedule_create': textArg(args, 'owner'); textArg(args, 'cadence'); textArg(args, 'expected_collection_revision'); break;
    case 'kb_schedule_set_armed':
      textArg(args, 'schedule_id', true); intArg(args, 'expected_version');
      if (typeof args.armed !== 'boolean') throw new BridgeError('invalid_arguments', 'armed is invalid');
      break;
    case 'kb_schedule_delete': textArg(args, 'schedule_id', true); intArg(args, 'expected_version'); break;
    case 'kb_run_control':
      textArg(args, 'run_ref', true); intArg(args, 'expected_run_version'); intArg(args, 'expected_manager_generation');
      if (!['cancel', 'retry'].includes(textArg(args, 'action'))) throw new BridgeError('invalid_arguments', 'action is invalid');
      break;
  }
}

function canonicalRepoPath(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > 16_384 || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new BridgeError('invalid_arguments', 'path is invalid');
  }
  if (value === '') {
    if (allowEmpty) return '';
    throw new BridgeError('invalid_arguments', 'path is invalid');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new BridgeError('invalid_arguments', 'path is invalid');
  }
  return segments.join('/');
}

function v1Result(envelope: { data: unknown; meta: unknown }): unknown {
  return redactValue({ data: bounded(envelope.data), meta: envelope.meta });
}

function budgetReadResult(value: unknown, maxBytes: number): unknown {
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized ?? '', 'utf8');
  if (bytes <= maxBytes) return value;
  const page = optionalRecord(value);
  if (page && Array.isArray(page.items) && typeof page.total === 'number' && typeof page.offset === 'number') {
    const items = [...page.items];
    const output: Record<string, unknown> = { ...page, items, truncated: true };
    while (items.length > 0 && Buffer.byteLength(JSON.stringify(output), 'utf8') > maxBytes) {
      items.pop();
      output.next_offset = page.offset + items.length < page.total ? page.offset + items.length : null;
    }
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') <= maxBytes) return output;
  }
  return { truncated: true, bytes };
}

export class AtlasKbBridge {
  constructor(readonly client: DashboardClient) {
    if (!client.config.enabled) throw new BridgeError('bridge_disabled', 'ATLAS_KB_BRIDGE_ENABLED=1 is required');
  }

  tools(): readonly ToolDefinition[] {
    return toolDefinitions(this.client.config.mutationsEnabled);
  }

  async callTool(name: string, rawArgs: unknown): Promise<unknown> {
    const args = record(rawArgs);
    if (!MUTATIONS.has(name)) rejectForbiddenMutationFields(args);
    if (!this.tools().some((tool) => tool.name === name)) {
      throw new BridgeError('capability_unavailable', 'tool is not registered');
    }
    if (MUTATIONS.has(name) && !this.client.config.mutationsEnabled) {
      throw new BridgeError('capability_unavailable', 'kb mutations are disabled');
    }
    if (MUTATIONS.has(name)) validateMutationArguments(name, args);
    const result = await this.executeTool(name, args);
    return MUTATIONS.has(name) ? result : budgetReadResult(result, this.client.config.maxResultBytes);
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'kb_capabilities': return this.client.capabilities();
      case 'kb_agents_list': return this.list('agents', '/api/v1/agents', 'agent-list', '/api/agents', {}, args, 'agents');
      case 'kb_agent_get': {
        const id = textArg(args, 'agent_id', true);
        return this.get('agents', `/api/v1/agents/${encodeURIComponent(id)}`, 'agent', `/api/agents/${encodeURIComponent(id)}`);
      }
      case 'kb_workflows_list': return this.list('workflows', '/api/v1/workflows', 'workflow-list', '/api/workflows', {}, args, 'workflows');
      case 'kb_workflow_get': {
        const id = textArg(args, 'workflow_id', true);
        return this.get('workflows', `/api/v1/workflows/${encodeURIComponent(id)}`, 'workflow', `/api/workflows/${encodeURIComponent(id)}`);
      }
      case 'kb_runs_list': return this.runsList(args);
      case 'kb_run_get': return this.runGet(args);
      case 'kb_run_events': return this.runEvents(args);
      case 'kb_run_watch': return this.runWatch(args);
      case 'kb_inbox_list': return this.inbox(args);
      case 'kb_schedules_list': return this.list('schedules', '/api/v1/schedules', 'schedule-list', '/api/schedules', {}, args, 'schedules');
      case 'kb_repo_tree': return this.repoTree(args);
      case 'kb_repo_file': return this.repoFile(args);
      case 'kb_repo_history': return this.repoHistory(args);
      case 'kb_repo_search': return this.repoSearch(args);
      case 'kb_analytics_snapshot': return this.analytics(args);
      case 'kb_grades': return this.grades(args);
      case 'kb_trace_list': return this.traceList(args);
      case 'kb_trace_get': return this.traceGet(args);
      case 'kb_terminal_list': return this.terminalList(args);
      case 'kb_agent_create': return this.entityCreate('agents', args);
      case 'kb_agent_update': return this.entityUpdate('agents', 'agent_id', args);
      case 'kb_workflow_create': return this.entityCreate('workflows', args);
      case 'kb_workflow_update': return this.entityUpdate('workflows', 'workflow_id', args);
      case 'kb_workflow_launch': return this.workflowLaunch(args);
      case 'kb_agent_launch': return this.agentLaunch(args);
      case 'kb_human_respond': return this.humanRespond(args);
      case 'kb_review_dispatch': return this.reviewDispatch(args);
      case 'kb_schedule_create': return this.scheduleCreate(args);
      case 'kb_schedule_set_armed': return this.scheduleSetArmed(args);
      case 'kb_schedule_delete': return this.scheduleDelete(args);
      case 'kb_run_control': return this.runControl(args);
      default: throw new BridgeError('capability_unavailable', 'tool is not registered');
    }
  }

  private async list(family: string, v1Path: string, kind: string, legacyPath: string,
    params: Record<string, string | number | boolean | undefined>, args?: Record<string, unknown>, listKind?: ListKind): Promise<unknown> {
    const adapter = await this.client.adapter(family);
    if (adapter === 'v1') {
      const result = await this.client.v1(query(v1Path, params), kind);
      return listKind && args ? paginate(result, listKind, args) : bounded(v1Result(result));
    }
    const result = await this.client.legacy(query(legacyPath, params));
    return listKind && args ? paginate(result, listKind, args) : bounded(result);
  }

  private async get(family: string, v1Path: string, kind: string, legacyPath: string): Promise<unknown> {
    const adapter = await this.client.adapter(family);
    const result = adapter === 'v1' ? v1Result(await this.client.v1(v1Path, kind)) : await this.client.legacy(legacyPath);
    return bounded(result, 200, 0, 2000);
  }

  private async runsList(args: Record<string, unknown>): Promise<unknown> {
    const params = { includeArchived: args.include_archived === true ? 1 : undefined };
    return this.list('runs', '/api/v1/runs', 'run-list', '/api/control/runs', params, args, 'runs');
  }

  private async runGet(args: Record<string, unknown>): Promise<unknown> {
    const runRef = textArg(args, 'run_ref', true);
    return this.get('runs', `/api/v1/runs/${encodeURIComponent(runRef)}`, 'run', `/api/control/runs/${encodeURIComponent(runRef)}`);
  }

  private async runEvents(args: Record<string, unknown>): Promise<unknown> {
    const runRef = textArg(args, 'run_ref', true);
    const params = { after: intArg(args, 'after', 0), limit: intArg(args, 'limit', 100, 1, 250), stageRef: optionalText(args, 'stage_ref') };
    return this.list('runs', `/api/v1/runs/${encodeURIComponent(runRef)}/events`, 'run-events',
      `/api/control/runs/${encodeURIComponent(runRef)}/events`, params);
  }

  private async runWatch(args: Record<string, unknown>): Promise<unknown> {
    const runRef = textArg(args, 'run_ref', true);
    const after = intArg(args, 'after', 0);
    const limit = intArg(args, 'limit', 100, 1, 250);
    const stageRef = optionalText(args, 'stage_ref');
    const adapter = await this.client.adapter('runs');
    if (adapter === 'v1') {
      const envelope = await this.client.v1(query(`/api/v1/runs/${encodeURIComponent(runRef)}/events`, { after, limit, stageRef }), 'run-events');
      return v1Result(envelope);
    }
    const waitMs = intArg(args, 'wait_ms', 1000, 100, 5000);
    return this.client.watchLegacy(query(`/api/control/runs/${encodeURIComponent(runRef)}/events/stream`, { after, limit, stageRef }), after, limit, waitMs);
  }

  private async inbox(args: Record<string, unknown>): Promise<unknown> {
    const refresh = args.refresh === true ? 1 : undefined;
    return this.list('inbox', '/api/v1/inbox', 'inbox', '/api/inbox', { refresh }, args, 'inbox');
  }

  private async repoTree(args: Record<string, unknown>): Promise<unknown> {
    const path = canonicalRepoPath(args.path ?? '', true);
    await this.client.adapter('repo');
    return bounded(await this.client.legacy(query('/api/kb/tree', { path })));
  }

  private async repoFile(args: Record<string, unknown>): Promise<unknown> {
    const path = canonicalRepoPath(args.path, false);
    await this.client.adapter('repo');
    const maxBytes = intArg(args, 'max_bytes', 65_536, 1, 262_144);
    let response: unknown;
    try {
      response = await this.client.legacy(query('/api/kb/file', { path }));
    } catch (error) {
      if (error instanceof BridgeError && error.status === 404) {
        throw new BridgeError('path_not_readable', 'that path is outside the readable roots or does not exist');
      }
      throw error;
    }
    const result = record(response, 'repo file response');
    if (typeof result.content !== 'string') throw new BridgeError('dashboard_error', 'dashboard file response was malformed');
    const bytes = Buffer.byteLength(result.content, 'utf8');
    if (bytes > maxBytes) {
      return { path: result.path, content: Buffer.from(result.content).subarray(0, maxBytes).toString('utf8'), truncated: true, bytes };
    }
    return { ...result, bytes, truncated: false };
  }

  private async repoHistory(args: Record<string, unknown>): Promise<unknown> {
    const path = canonicalRepoPath(args.path, false);
    await this.client.adapter('repo');
    const result = record(await this.client.legacy(query('/api/kb/history', { path })), 'history response');
    return paginate(result, 'history', args);
  }

  private async repoSearch(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('search');
    const term = textArg(args, 'query');
    if (term.length > 500) throw new BridgeError('invalid_arguments', 'query is too long');
    const scope = optionalText(args, 'scope');
    const q = scope ? `${term} scope:${scope}` : term;
    intArg(args, 'limit', 20, 1, 100);
    const result = await this.client.legacy(query('/api/brain/search', { q, k: 100 }));
    return paginate(result, 'search', args);
  }

  private async analytics(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('analytics');
    const requested = args.sections === undefined ? ['index'] : args.sections;
    if (!Array.isArray(requested) || requested.some((item) => !['index', 'home', 'health'].includes(String(item)))) {
      throw new BridgeError('invalid_arguments', 'sections is invalid');
    }
    const output: Record<string, unknown> = {};
    for (const section of new Set(requested as string[])) {
      if (section === 'index') {
        const projection = await this.client.legacyIndex(0, INDEX_SUMMARY_KEYS);
        output[section] = Object.keys(projection.summary).length > 0
          ? projection.summary
          : { keys: projection.keys.slice(0, 40) };
      } else {
        output[section] = bounded(await this.client.legacy(`/api/${section}`), 100);
      }
    }
    return output;
  }

  private async grades(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('grades');
    const limit = intArg(args, 'limit', 20, 1, 100);
    const offset = intArg(args, 'offset', 0);
    const projection = await this.client.legacyIndex(offset + limit, new Set());
    return paginate({ rows: projection.rows, total: projection.rowCount }, 'grades', args);
  }

  private async traceList(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('traces');
    const result = await this.client.legacy('/api/trace');
    return paginate(result, 'traces', args);
  }

  private async traceGet(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('traces');
    return bounded(await this.client.legacy(`/api/trace/${encodeURIComponent(textArg(args, 'session_id', true))}`), 500, 0, 2000);
  }

  private async terminalList(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('terminals');
    return paginate(await this.client.legacy('/api/pty/sessions'), 'terminals', args);
  }

  private async entityCreate(family: 'agents' | 'workflows', args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter(family, true);
    const key = textArg(args, 'idempotency_key');
    const body = { ...definition(args), expectedCollectionRevision: textArg(args, 'expected_collection_revision'), idempotencyKey: key };
    const path = adapter === 'v1' ? `/api/v1/${family}` : `/api/${family}`;
    if (adapter === 'v1') return v1Result(await this.client.v1(path, family === 'agents' ? 'agent' : 'workflow', { method: 'POST', body, idempotencyKey: key }));
    return this.client.legacy(path, { method: 'POST', body, idempotencyKey: key });
  }

  private async entityUpdate(family: 'agents' | 'workflows', idKey: string, args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter(family, true);
    const id = textArg(args, idKey, true);
    const key = textArg(args, 'idempotency_key');
    const body = { ...definition(args), expectedSourceRevision: textArg(args, 'expected_source_revision'), idempotencyKey: key };
    const path = `${adapter === 'v1' ? '/api/v1' : '/api'}/${family}/${encodeURIComponent(id)}`;
    if (adapter === 'v1') return v1Result(await this.client.v1(path, family === 'agents' ? 'agent' : 'workflow', { method: 'PUT', body, idempotencyKey: key }));
    return this.client.legacy(path, { method: 'PUT', body, idempotencyKey: key });
  }

  private async workflowLaunch(args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter('workflow_launch', true);
    const workflowId = textArg(args, 'workflow_id', true);
    const key = textArg(args, 'idempotency_key');
    const body: Record<string, unknown> = {
      workflowId, expectedSourceRevision: textArg(args, 'expected_source_revision'), idempotencyKey: key,
    };
    if (args.parameters !== undefined) body.parameters = record(args.parameters, 'parameters');
    if (args.composer_ref !== undefined) body.composerRef = textArg(args, 'composer_ref', true);
    if (adapter === 'v1') return v1Result(await this.client.v1('/api/v1/runs', 'run', { method: 'POST', body, idempotencyKey: key }));
    return this.client.legacy(`/api/workflows/${encodeURIComponent(workflowId)}/launch`, { method: 'POST', body, idempotencyKey: key });
  }

  private async agentLaunch(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('agent_launch', true);
    const agentId = textArg(args, 'agent_id', true);
    const key = textArg(args, 'idempotency_key');
    const body = { expectedSourceRevision: textArg(args, 'expected_source_revision'), idempotencyKey: key };
    return this.client.legacy(`/api/agents/${encodeURIComponent(agentId)}/launch`, { method: 'POST', body, idempotencyKey: key });
  }

  private async humanRespond(args: Record<string, unknown>): Promise<unknown> {
    const decision = textArg(args, 'decision');
    if (decision !== 'responded') {
      throw new BridgeError('t3_requires_dashboard', 'approval and review requests require the dashboard');
    }
    const adapter = await this.client.adapter('human_response', true);
    const requestRef = textArg(args, 'request_ref', true);
    const runRef = args.run_ref === undefined ? undefined : textArg(args, 'run_ref', true);
    const requestKind = await this.authoritativeRequestKind(adapter, requestRef, runRef);
    if (!ORDINARY_REQUEST_KINDS.has(requestKind)) {
      throw new BridgeError('t3_requires_dashboard', 'approval and review requests require the dashboard');
    }
    const key = textArg(args, 'idempotency_key');
    const body: Record<string, unknown> = {
      expectedRevision: intArg(args, 'expected_revision'), decision: 'responded', idempotencyKey: key,
    };
    if (args.response !== undefined) body.response = textArg(args, 'response');
    if (adapter === 'v1') {
      if (!runRef) throw new BridgeError('invalid_arguments', 'run_ref is invalid');
      return v1Result(await this.client.v1(`/api/v1/runs/${encodeURIComponent(runRef)}/human-requests/${encodeURIComponent(requestRef)}/respond`, 'human-response', { method: 'POST', body, idempotencyKey: key }));
    }
    return this.client.legacy(`/api/control/human-requests/${encodeURIComponent(requestRef)}/respond`, { method: 'POST', body, idempotencyKey: key });
  }

  private async authoritativeRequestKind(adapter: 'v1' | 'legacy', requestRef: string, runRef?: string): Promise<string> {
    let item: Record<string, unknown> | undefined;
    if (adapter === 'v1') {
      const envelope = await this.client.v1('/api/v1/inbox', 'inbox');
      const data = Array.isArray(envelope.data)
        ? envelope.data
        : Array.isArray(record(envelope.data, 'inbox response').items)
          ? record(envelope.data, 'inbox response').items as unknown[]
          : [];
      item = data.map((candidate) => record(candidate, 'inbox item')).find((candidate) => {
        const ref = candidate.requestRef ?? candidate.request_ref ?? candidate.id;
        const candidateRun = candidate.runRef ?? candidate.run_ref;
        return ref === requestRef && (runRef === undefined || candidateRun === undefined || candidateRun === runRef);
      });
    } else {
      item = record(await this.client.legacy(`/api/control/human-requests/${encodeURIComponent(requestRef)}`), 'human request');
    }
    const kind = item?.kind ?? item?.requestKind ?? item?.request_kind;
    return typeof kind === 'string' ? kind.toLowerCase() : '';
  }

  private async reviewDispatch(args: Record<string, unknown>): Promise<unknown> {
    const profile = textArg(args, 'review_profile', true);
    const workflowId = this.client.config.reviewProfiles[profile];
    if (!workflowId) throw new BridgeError('review_profile_refused', 'review profile is not allow-listed');
    const adapter = await this.client.adapter('workflow_launch', true);
    const key = textArg(args, 'idempotency_key');
    let revision: string | undefined;
    if (adapter === 'v1') {
      const detail = await this.client.v1(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, 'workflow');
      revision = typeof detail.meta.etag === 'string' && HEX64.test(detail.meta.etag) ? detail.meta.etag : undefined;
    } else {
      revision = this.findRevision(await this.client.legacy(`/api/workflows/${encodeURIComponent(workflowId)}`));
    }
    if (!revision) throw new BridgeError('capability_unavailable', 'review workflow source revision unavailable');
    const body = {
      workflowId, expectedSourceRevision: revision, idempotencyKey: key,
      parameters: { targetRef: textArg(args, 'target_ref'), context: args.context === undefined ? {} : record(args.context, 'context') },
    };
    if (adapter === 'v1') return v1Result(await this.client.v1('/api/v1/runs', 'run', { method: 'POST', body, idempotencyKey: key }));
    return this.client.legacy(`/api/workflows/${encodeURIComponent(workflowId)}/launch`, { method: 'POST', body, idempotencyKey: key });
  }

  private findRevision(value: unknown): string | undefined {
    const item = record(value, 'entity response');
    for (const key of ['sourceRevision', 'sourceHash', 'etag']) if (typeof item[key] === 'string') return item[key] as string;
    for (const key of ['agent', 'workflow', 'value', 'data']) {
      if (item[key] && typeof item[key] === 'object') {
        const nested = item[key] as Record<string, unknown>;
        for (const revisionKey of ['sourceRevision', 'sourceHash', 'etag']) if (typeof nested[revisionKey] === 'string') return nested[revisionKey] as string;
      }
    }
    return undefined;
  }

  private async scheduleCreate(args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter('schedules', true);
    const key = textArg(args, 'idempotency_key');
    const body = { owner: textArg(args, 'owner'), cadence: textArg(args, 'cadence'), expectedCollectionRevision: textArg(args, 'expected_collection_revision'), idempotencyKey: key };
    if (adapter === 'v1') return v1Result(await this.client.v1('/api/v1/schedules', 'schedule', { method: 'POST', body, idempotencyKey: key }));
    return this.client.legacy('/api/schedules', { method: 'POST', body, idempotencyKey: key });
  }

  private async scheduleSetArmed(args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter('schedules', true);
    const id = textArg(args, 'schedule_id', true);
    if (typeof args.armed !== 'boolean') throw new BridgeError('invalid_arguments', 'armed is invalid');
    const key = textArg(args, 'idempotency_key');
    const body = { expectedVersion: intArg(args, 'expected_version'), idempotencyKey: key, armed: args.armed };
    const path = `${adapter === 'v1' ? '/api/v1' : '/api'}/schedules/${encodeURIComponent(id)}/${args.armed ? 'arm' : 'disarm'}`;
    if (adapter === 'v1') return v1Result(await this.client.v1(path, 'schedule', { method: 'POST', body, idempotencyKey: key }));
    return this.client.legacy(path, { method: 'POST', body, idempotencyKey: key });
  }

  private async scheduleDelete(args: Record<string, unknown>): Promise<unknown> {
    const adapter = await this.client.adapter('schedules', true);
    const id = textArg(args, 'schedule_id', true);
    const key = textArg(args, 'idempotency_key');
    const body = { expectedVersion: intArg(args, 'expected_version'), idempotencyKey: key };
    const path = `${adapter === 'v1' ? '/api/v1' : '/api'}/schedules/${encodeURIComponent(id)}`;
    if (adapter === 'v1') return v1Result(await this.client.v1(path, 'schedule', { method: 'DELETE', body, idempotencyKey: key }));
    return this.client.legacy(path, { method: 'DELETE', body, idempotencyKey: key });
  }

  private async runControl(args: Record<string, unknown>): Promise<unknown> {
    await this.client.adapter('run_control', true);
    const runRef = textArg(args, 'run_ref', true);
    const action = textArg(args, 'action');
    if (action !== 'cancel' && action !== 'retry') throw new BridgeError('invalid_arguments', 'action must be cancel or retry');
    const key = textArg(args, 'idempotency_key');
    const body = {
      expectedRunVersion: intArg(args, 'expected_run_version'),
      expectedManagerGeneration: intArg(args, 'expected_manager_generation'),
      idempotencyKey: key,
    };
    const suffix = action === 'cancel' ? 'manager/stop' : 'activate';
    return this.client.legacy(`/api/control/runs/${encodeURIComponent(runRef)}/${suffix}`, { method: 'POST', body, idempotencyKey: key });
  }
}
