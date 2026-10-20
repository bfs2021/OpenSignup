import { redirect } from 'next/navigation';
import { requireOrganizerSession } from '@/auth/session';

type PageParams = { params: Promise<{ id: string }> };

export default async function SignupDetailPage({ params }: PageParams) {
  const { id } = await params;
  // Outside the tabs' layout, so it checks the session itself.
  await requireOrganizerSession();
  redirect(`/app/signups/${id}/build`);
}
