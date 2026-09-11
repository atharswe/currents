import { buildOpml } from "@/lib/opml";
import { listFeeds } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const xml = buildOpml(
    listFeeds().map((feed) => ({
      title: feed.title,
      feedUrl: feed.feedUrl,
      siteUrl: feed.siteUrl,
      folder: feed.folder,
    })),
  );

  return new Response(xml, {
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "content-disposition": 'attachment; filename="currents.opml"',
      "cache-control": "no-store",
    },
  });
}
