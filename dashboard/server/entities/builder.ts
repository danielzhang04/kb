import type { ConnectorGrant, CreateEntityRequest, EntityBuilderRequest, RunnableSelector } from './contracts.ts';
import type { RunnableRef } from '../control/p2Contracts.ts';
import type { HostAdvertisement } from '../placement/contracts.ts';
import { sha256Hex } from '../shared/hashing.ts';

export interface EntityBuilderCatalog {
  models: readonly string[];
  profiles: readonly string[];
  tools: readonly string[];
  skills: readonly string[];
  connectors: readonly ConnectorGrant[];
  /** Symbolic root ids map to server-owned allowed paths. */
  filesystemRoots: Readonly<Record<string, string>>;
  projects: readonly string[];
}

export interface EntityBuilderMaterialization extends EntityBuilderRequest {
  project?: string;
}

export interface EntityBuilderPort {
  save(input: {
    ref: RunnableRef;
    sourcePath: RunnableRef['sourcePath'];
    expectedSourceRevision: string;
    idempotencyKey: string;
    sessionToken: string | undefined;
    request: EntityBuilderMaterialization;
  }): Promise<{ status: 'pending' | 'applied'; operationId: string; replayed: boolean }>;
}

const REQUEST_KEYS = new Set(['humanName', 'purpose', 'model', 'profile', 'tools', 'skills', 'connectors', 'filesystemRoots']);
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function connectorArray(value: unknown): value is ConnectorGrant[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const grant = entry as Record<string, unknown>;
    return Object.keys(grant).every((key) => key === 'server' || key === 'tools')
      && nonEmptyString(grant.server) && stringArray(grant.tools);
  });
}

function allowedConnectorGrants(catalog: readonly ConnectorGrant[], requested: readonly ConnectorGrant[]): boolean {
  return requested.every((grant) => {
    const declared = catalog.find((candidate) => candidate.server === grant.server);
    return declared !== undefined && grant.tools.every((tool) => declared.tools.includes(tool));
  });
}

function allowed(values: readonly string[], requested: string[]): boolean {
  const catalog = new Set(values);
  return requested.every((value) => catalog.has(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * "Unknown" against the LIVE union of fresh host advertisements [§3.7, design:383]. Distinct from the
 * static `catalog` check above: the catalog says what the builder KNOWS about; this says what some
 * host can CURRENTLY serve. The refusal names the offending id and nothing else.
 */
export function assertCapabilitiesAdvertised(
  request: Pick<EntityBuilderMaterialization, 'connectors' | 'filesystemRoots'>,
  freshAdvertisements: readonly HostAdvertisement[],
): void {
  const advertisedTools = new Map<string, Set<string>>();
  const advertisedRoots = new Set<string>();
  for (const advertisement of freshAdvertisements) {
    for (const connector of advertisement.connectors) {
      const tools = advertisedTools.get(connector.server) ?? new Set<string>();
      for (const tool of connector.tools) tools.add(tool);
      advertisedTools.set(connector.server, tools);
    }
    for (const root of advertisement.filesystemRoots) advertisedRoots.add(root);
  }
  for (const grant of request.connectors) {
    const tools = advertisedTools.get(grant.server);
    for (const tool of grant.tools) {
      if (!tools || !tools.has(tool)) throw new Error(`unknown-connector-tool:${grant.server}.${tool}`);
    }
  }
  for (const rootId of request.filesystemRoots) {
    if (!advertisedRoots.has(rootId)) throw new Error(`unknown-root-id:${rootId}`);
  }
}

export function builderRequestFingerprint(ref: RunnableRef, expectedSourceRevision: string, request: EntityBuilderMaterialization): string {
  return sha256Hex(JSON.stringify({ ref, expectedSourceRevision, request }));
}

function trustedSelector(value: RunnableSelector): RunnableSelector {
  const record = value as unknown as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.id !== 'string' || !record.id || (record.type !== 'agent' && record.type !== 'workflow')) {
    throw new Error('invalid-runnable-selector');
  }
  return { type: record.type, id: record.id };
}

/** Parse the closed display/policy request. Paths are derived only from server-owned declarations and catalogs. */
export function materializeEntityBuilderRequest(
  value: unknown,
  catalog: EntityBuilderCatalog,
  create?: Pick<CreateEntityRequest, 'selector' | 'project'>,
  /** Optional [§3.7]: when supplied, connector tools and root ids are ALSO checked against the live
   * union of fresh advertisements, beside (never instead of) the static catalog check above. */
  freshAdvertisements?: readonly HostAdvertisement[],
): EntityBuilderMaterialization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-builder-request');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !REQUEST_KEYS.has(key))) throw new Error('builder-field-forbidden');
  if (!nonEmptyString(record.humanName) || /[\r\n]/.test(record.humanName) || !nonEmptyString(record.purpose) || typeof record.model !== 'string' || typeof record.profile !== 'string' || !stringArray(record.tools) || !stringArray(record.skills) || !connectorArray(record.connectors) || !stringArray(record.filesystemRoots)) throw new Error('invalid-builder-request');
  if (!catalog.models.includes(record.model)) throw new Error('unknown-model');
  if (!catalog.profiles.includes(record.profile)) throw new Error('unknown-profile');
  if (!allowed(catalog.tools, record.tools)) throw new Error('unknown-tool');
  if (!allowed(catalog.skills, record.skills)) throw new Error('unknown-capability');
  if (!allowedConnectorGrants(catalog.connectors, record.connectors)) throw new Error('unknown-connector');
  if (record.filesystemRoots.some((rootId) => !Object.hasOwn(catalog.filesystemRoots, rootId))) throw new Error('unknown-root');
  if (freshAdvertisements !== undefined) {
    assertCapabilitiesAdvertised({ connectors: record.connectors, filesystemRoots: record.filesystemRoots }, freshAdvertisements);
  }
  let project: string | undefined;
  if (create) {
    if (create.selector.type === 'workflow' && !nonEmptyString(create.project)) throw new Error('project-required');
    if (create.project !== undefined) {
      if (!nonEmptyString(create.project) || !catalog.projects.includes(create.project)) throw new Error('unknown-project');
      project = create.project;
    }
  }
  return {
    humanName: record.humanName,
    purpose: record.purpose,
    model: record.model,
    profile: record.profile,
    tools: [...record.tools],
    skills: [...record.skills],
    connectors: record.connectors.map((grant) => ({ server: grant.server, tools: [...grant.tools] })),
    filesystemRoots: [...record.filesystemRoots],
    ...(project === undefined ? {} : { project }),
  };
}

export async function submitEntityBuilder(
  input: Pick<CreateEntityRequest, 'selector' | 'project' | 'idempotencyKey'> & { expectedSourceRevision: string; request: unknown; sessionToken?: string },
  services: { resolve(selector: RunnableSelector): RunnableRef; catalog: EntityBuilderCatalog; port: EntityBuilderPort },
): Promise<{ status: 'pending' | 'applied'; operationId: string; replayed: boolean }> {
  if (!nonEmptyString(input.expectedSourceRevision) || !nonEmptyString(input.idempotencyKey)) throw new Error('missing-source-cas');
  const selector = trustedSelector(input.selector);
  const request = materializeEntityBuilderRequest(input.request, services.catalog, { selector, project: input.project });
  const ref = services.resolve(selector);
  if (ref.type !== selector.type || ref.id !== selector.id || (ref.type === 'workflow' && ref.project !== request.project)) throw new Error('runnable-selector-mismatch');
  return services.port.save({ ref, sourcePath: ref.sourcePath, expectedSourceRevision: input.expectedSourceRevision, idempotencyKey: input.idempotencyKey, sessionToken: input.sessionToken, request });
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(values: readonly string[]): string {
  return `[${values.map(yamlString).join(', ')}]`;
}

function yamlConnectorList(values: readonly ConnectorGrant[]): string {
  return `[${values.map((grant) => `{server: ${yamlString(grant.server)}, tools: ${yamlList(grant.tools)}}`).join(', ')}]`;
}

function profileRuntime(profile: string): string {
  const parts = profile.split(':');
  return parts.length >= 3 ? parts[1] ?? '' : 'claude';
}

/** Server-owned declaration materialization. Selectors choose identity; no caller chooses a path. */
export function renderAgentBuilderSource(id: string, request: EntityBuilderMaterialization): string {
  const projects = request.project ? [request.project] : [];
  return [
    '---',
    `id: ${yamlString(id)}`,
    'version: 1',
    'role: work',
    `runtime: ${yamlString(profileRuntime(request.profile))}`,
    `model: ${yamlString(request.model)}`,
    `default-profile: ${yamlString(request.profile)}`,
    `allowed-profiles: ${yamlList([request.profile])}`,
    `projects: ${yamlList(projects)}`,
    'runner-bound: false',
    `description: ${yamlString(request.purpose)}`,
    `tools: ${yamlList(request.tools)}`,
    'knowledge-source: []',
    'autonomy-tier: queues-for-me',
    `skills: ${yamlList(request.skills)}`,
    `connectors: ${yamlConnectorList(request.connectors)}`,
    `filesystem-roots: ${yamlList(request.filesystemRoots)}`,
    'what-it-replaces: null',
    'builds-on: []',
    '---',
    '',
    `# ${request.humanName}`,
    '',
    request.purpose,
    '',
  ].join('\n');
}

/** New workflows receive one bounded, server-chosen draft stage; browser input cannot inject action or path. */
export function renderWorkflowBuilderSource(id: string, request: EntityBuilderMaterialization): string {
  if (!request.project) throw new Error('project-required');
  return [
    '---',
    `id: ${yamlString(id)}`,
    `project: ${yamlString(request.project)}`,
    `title: ${yamlString(request.humanName)}`,
    `purpose: ${yamlString(request.purpose)}`,
    `model: ${yamlString(request.model)}`,
    `profile: ${yamlString(request.profile)}`,
    `tools: ${yamlList(request.tools)}`,
    `skills: ${yamlList(request.skills)}`,
    `connectors: ${yamlConnectorList(request.connectors)}`,
    `filesystemRoots: ${yamlList(request.filesystemRoots)}`,
    'stages:',
    '  - id: draft',
    `    title: ${yamlString(request.humanName)}`,
    '    action: draft:builder',
    `    target: orgs/${request.project}/output`,
    '    riskTier: T2',
    '---',
    '',
    `# ${request.humanName}`,
    '',
    request.purpose,
    '',
  ].join('\n');
}

function replaceFrontmatterField(source: string, key: string, serialized: string): string | null {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return null;
  const frontmatter = match[1];
  const field = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm');
  const next = field.test(frontmatter)
    ? frontmatter.replace(field, `${key}: ${serialized}`)
    : `${frontmatter}\n${key}: ${serialized}`;
  return source.slice(0, match.index) + source.slice(match.index, match.index + match[0].length).replace(frontmatter, next) + source.slice(match.index + match[0].length);
}

function replaceMarkdownTitle(source: string, title: string): string | null {
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source);
  if (!frontmatter) return null;
  const bodyStart = frontmatter[0].length;
  const body = source.slice(bodyStart);
  if (/^#\s+.*$/m.test(body)) return source.slice(0, bodyStart) + body.replace(/^#\s+.*$/m, `# ${title}`);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return `${source.slice(0, bodyStart)}# ${title}${newline}${newline}${body}`;
}

/** Patch only form-owned display/policy keys; stages, assignments, governance, and instructions survive. */
export function patchEntityBuilderSource(kind: 'agent' | 'workflow', source: string, request: EntityBuilderMaterialization): string | null {
  const fields: Array<[string, string]> = kind === 'agent'
    ? [
        ['description', yamlString(request.purpose)], ['model', yamlString(request.model)],
        ['default-profile', yamlString(request.profile)], ['allowed-profiles', yamlList([request.profile])],
        ['runtime', yamlString(profileRuntime(request.profile))], ['tools', yamlList(request.tools)],
        ['skills', yamlList(request.skills)], ['connectors', yamlConnectorList(request.connectors)],
        ['filesystem-roots', yamlList(request.filesystemRoots)],
      ]
    : [
        ['title', yamlString(request.humanName)], ['purpose', yamlString(request.purpose)],
        ['model', yamlString(request.model)], ['profile', yamlString(request.profile)],
        ['tools', yamlList(request.tools)], ['skills', yamlList(request.skills)],
        ['connectors', yamlConnectorList(request.connectors)], ['filesystemRoots', yamlList(request.filesystemRoots)],
      ];
  let next: string | null = source;
  for (const [key, value] of fields) {
    if (next === null) return null;
    next = replaceFrontmatterField(next, key, value);
  }
  if (kind === 'agent' && next !== null) next = replaceMarkdownTitle(next, request.humanName);
  return next;
}
