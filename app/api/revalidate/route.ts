import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const bodySchema = z.object({ paths: z.array(z.string().max(300)).max(100).default([]) });

function authorised(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

  if (!secret || supplied.length !== secret.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

/**
 * Called by the Laravel API after CMS changes (see App\Jobs\RevalidateFrontend).
 * An empty `paths` list refreshes everything; otherwise the listed pages plus shared data (menus, settings).
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 422 });
  }

  const { paths } = parsed.data;

  if (paths.length === 0) {
    revalidateTag("cms", "max");
  } else {
    revalidateTag("cms-shared", "max");

    for (const path of paths) {
      const slug = path.replace(/^\/+|\/+$/g, "") || "home";
      revalidateTag(`page:${slug}`, "max");
    }
  }

  return Response.json({ revalidated: paths.length === 0 ? "all" : paths });
}
