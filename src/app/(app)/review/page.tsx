import { getCurrentUser } from "@/lib/services/user";
import { getReviewQueue } from "@/lib/services/review";
import { ReviewView } from "@/components/review/review-view";

export const metadata = { title: "Review" };

export default async function ReviewPage() {
  const user = await getCurrentUser();
  const { groups, categories } = await getReviewQueue(user.id);
  return <ReviewView groups={groups} categories={categories} currency={user.baseCurrency} />;
}
