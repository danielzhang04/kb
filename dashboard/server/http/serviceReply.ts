import type { FastifyReply } from 'fastify';
import type { ServiceReply } from '../services/scheduleService.ts';

/**
 * Render a `ServiceReply` onto a Fastify reply: mirror the service ETag as the transport header when
 * present, then send an empty 304 or the status+body. Shared by the browser agent/workflow/schedule
 * routes, which each carried a byte-identical copy (the schedule site used the equivalent statement
 * form and discarded the return). Returning the reply object is the sanctioned Fastify "already sent"
 * signal, so callers may use it in expression or statement position interchangeably.
 */
export function sendServiceReply(reply: FastifyReply, result: ServiceReply): FastifyReply {
  if (result.etag) reply.header('etag', result.etag);
  return result.status === 304 ? reply.code(304).send() : reply.code(result.status).send(result.body);
}
