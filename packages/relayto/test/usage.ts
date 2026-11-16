// Compiled (not run) by `npm run typecheck`: checks that the published types work
// for a TypeScript user who imports the package by name.
import { RelaytoSite, NotFoundError, NotPublicError, RateLimitError, type Content, type Hub, type Item, type ExportJob } from 'relayto';

async function example(): Promise<void> {
  const site = new RelaytoSite('benefits.relayto.com', { timeoutMs: 10_000 });
  const results = await site.search('wellness', { kind: 'content', limit: 5 });
  const first: Item | undefined = results.data[0];
  const next: string | null = results.pagination.nextCursor;
  for await (const hub of site.allHubs()) {
    const h: Hub = await site.getHub(hub.slug);
    void h.itemCount;
  }
  try {
    const doc: Content = await site.getContent(first?.slug ?? 'x');
    if (doc.access === 'open') void doc.markdown.length;
  } catch (error) {
    if (error instanceof NotFoundError) void error.code;
    else if (error instanceof NotPublicError) void error.url;
    else if (error instanceof RateLimitError) void error.retryAfter;
  }
  const resolved = await site.resolve('https://benefits.relayto.com/e/some-slug');
  if (resolved.kind === 'hub') void resolved.hub.itemsUrl;
  else void resolved.content.markdown;
  const job: ExportJob = await site.export({ contents: ['a', 'b'] });
  void job.items?.map((i) => i.status);
  // @ts-expect-error a request has contents or hub, not both
  await site.export({ contents: ['a'], hub: 'h' });
  void next;
  void site.rateLimit?.remaining;
}
void example;
