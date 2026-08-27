export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}),
});
const str = { type: 'string' };
const integer = { type: 'integer' };
const page = { limit: integer, offset: integer };
const idem = { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
const definition = obj({ name: str, description: str });
const emptyObject = obj();

export const READ_TOOLS: readonly ToolDefinition[] = [
  { name: 'kb_capabilities', description: 'READ negotiated kb dashboard route families and mode.', inputSchema: obj() },
  { name: 'kb_agents_list', description: 'READ projected, paginated agents through the negotiated route family.', inputSchema: obj(page) },
  { name: 'kb_agent_get', description: 'READ one agent declaration.', inputSchema: obj({ agent_id: str }, ['agent_id']) },
  { name: 'kb_workflows_list', description: 'READ projected, paginated workflows through the negotiated route family.', inputSchema: obj(page) },
  { name: 'kb_workflow_get', description: 'READ one workflow declaration.', inputSchema: obj({ workflow_id: str }, ['workflow_id']) },
  { name: 'kb_runs_list', description: 'READ projected, paginated run summaries.', inputSchema: obj({ ...page, include_archived: { type: 'boolean' } }) },
  { name: 'kb_run_get', description: 'READ one run and its feedback state.', inputSchema: obj({ run_ref: str }, ['run_ref']) },
  { name: 'kb_run_events', description: 'READ bounded replay events after a cursor.', inputSchema: obj({ run_ref: str, after: integer, limit: integer, stage_ref: str }, ['run_ref']) },
  { name: 'kb_run_watch', description: 'READ a bounded event delta from v1 replay or the legacy live stream.', inputSchema: obj({ run_ref: str, after: integer, limit: integer, wait_ms: integer, stage_ref: str }, ['run_ref']) },
  { name: 'kb_inbox_list', description: 'READ projected, paginated inbox subjects.', inputSchema: obj({ ...page, refresh: { type: 'boolean' } }) },
  { name: 'kb_schedules_list', description: 'READ projected, paginated schedules.', inputSchema: obj(page) },
  { name: 'kb_repo_tree', description: 'READ a repository tree below an allowed dashboard root.', inputSchema: obj({ path: str }) },
  { name: 'kb_repo_file', description: 'READ a repository file with a byte limit.', inputSchema: obj({ path: str, max_bytes: integer }, ['path']) },
  { name: 'kb_repo_history', description: 'READ projected, paginated repository history for one path.', inputSchema: obj({ path: str, ...page }, ['path']) },
  { name: 'kb_repo_search', description: 'READ projected, paginated kb brain search results.', inputSchema: obj({ query: str, ...page, scope: str }, ['query']) },
  { name: 'kb_analytics_snapshot', description: 'READ bounded index summary and optional home or health analytics sections.', inputSchema: obj({ sections: { type: 'array', items: { enum: ['index', 'home', 'health'] }, maxItems: 3 } }) },
  { name: 'kb_grades', description: 'READ projected, paginated grade ledger rows from the index.', inputSchema: obj(page) },
  { name: 'kb_trace_list', description: 'READ projected, paginated dashboard transcript summaries.', inputSchema: obj(page) },
  { name: 'kb_trace_get', description: 'READ one dashboard transcript.', inputSchema: obj({ session_id: str }, ['session_id']) },
  { name: 'kb_terminal_list', description: 'READ projected, paginated terminal session metadata without raw shell access.', inputSchema: obj(page) },
];

export const MUTATION_TOOLS: readonly ToolDefinition[] = [
  { name: 'kb_agent_create', description: 'MUTATION create an agent with collection CAS and idempotency.', inputSchema: obj({ definition, expected_collection_revision: str, idempotency_key: idem }, ['definition', 'expected_collection_revision', 'idempotency_key']) },
  { name: 'kb_agent_update', description: 'MUTATION update an agent with source CAS and idempotency.', inputSchema: obj({ agent_id: str, definition, expected_source_revision: str, idempotency_key: idem }, ['agent_id', 'definition', 'expected_source_revision', 'idempotency_key']) },
  { name: 'kb_workflow_create', description: 'MUTATION create a workflow with collection CAS and idempotency.', inputSchema: obj({ definition, expected_collection_revision: str, idempotency_key: idem }, ['definition', 'expected_collection_revision', 'idempotency_key']) },
  { name: 'kb_workflow_update', description: 'MUTATION update a workflow with source CAS and idempotency.', inputSchema: obj({ workflow_id: str, definition, expected_source_revision: str, idempotency_key: idem }, ['workflow_id', 'definition', 'expected_source_revision', 'idempotency_key']) },
  { name: 'kb_workflow_launch', description: 'MUTATION launch a workflow with source CAS and idempotency.', inputSchema: obj({ workflow_id: str, expected_source_revision: str, idempotency_key: idem, parameters: emptyObject, composer_ref: str }, ['workflow_id', 'expected_source_revision', 'idempotency_key']) },
  { name: 'kb_agent_launch', description: 'MUTATION launch an agent through the explicit legacy adapter.', inputSchema: obj({ agent_id: str, expected_source_revision: str, idempotency_key: idem }, ['agent_id', 'expected_source_revision', 'idempotency_key']) },
  { name: 'kb_human_respond', description: 'MUTATION answer a non-T3 human request; approval decisions are refused.', inputSchema: obj({ run_ref: str, request_ref: str, request_kind: str, expected_revision: integer, decision: { enum: ['responded', 'approved', 'rejected', 'changes-requested'] }, response: str, idempotency_key: idem }, ['request_ref', 'expected_revision', 'decision', 'idempotency_key']) },
  { name: 'kb_review_dispatch', description: 'MUTATION launch an allow-listed predeclared review workflow.', inputSchema: obj({ review_profile: str, target_ref: str, context: emptyObject, idempotency_key: idem }, ['review_profile', 'target_ref', 'idempotency_key']) },
  { name: 'kb_schedule_create', description: 'MUTATION create a schedule with collection CAS and idempotency.', inputSchema: obj({ owner: str, cadence: str, expected_collection_revision: str, idempotency_key: idem }, ['owner', 'cadence', 'expected_collection_revision', 'idempotency_key']) },
  { name: 'kb_schedule_set_armed', description: 'MUTATION arm or disarm a schedule with item CAS and idempotency.', inputSchema: obj({ schedule_id: str, armed: { type: 'boolean' }, expected_version: integer, idempotency_key: idem }, ['schedule_id', 'armed', 'expected_version', 'idempotency_key']) },
  { name: 'kb_schedule_delete', description: 'MUTATION delete a schedule with item CAS and idempotency.', inputSchema: obj({ schedule_id: str, expected_version: integer, idempotency_key: idem }, ['schedule_id', 'expected_version', 'idempotency_key']) },
  { name: 'kb_run_control', description: 'MUTATION cancel or retry a run with run CAS and idempotency.', inputSchema: obj({ run_ref: str, action: { enum: ['cancel', 'retry'] }, expected_run_version: integer, expected_manager_generation: integer, idempotency_key: idem }, ['run_ref', 'action', 'expected_run_version', 'expected_manager_generation', 'idempotency_key']) },
];

export function toolDefinitions(mutationsEnabled: boolean): readonly ToolDefinition[] {
  return mutationsEnabled ? [...READ_TOOLS, ...MUTATION_TOOLS] : READ_TOOLS;
}
