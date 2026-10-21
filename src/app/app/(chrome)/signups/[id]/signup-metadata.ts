import { getOrganizerSession, toActor } from '@/auth/session';
import { loadSignupForOrganizer } from '@/services/signups.cached';

/**
 * The browser tab's title on a signup's pages: the signup's own title, or
 * the site's name when the visitor can't see it. Shared by the review page
 * and the tabs' layout, both at the signup's address.
 */
export async function signupMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOrganizerSession();
  if (!session) return { title: 'OpenSignup' };
  const result = await loadSignupForOrganizer(toActor(session), id);
  if (!result.ok) return { title: 'OpenSignup' };
  return { title: result.value.title };
}
