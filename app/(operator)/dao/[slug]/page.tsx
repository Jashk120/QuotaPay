import { redirect } from "next/navigation";

/**
 * A DAO has one screen: the operator chat. The overview route exists only so
 * `/dao/<slug>` keeps working; it sends you straight to the chat.
 */
export default async function DaoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/dao/${encodeURIComponent(slug)}/chat`);
}
