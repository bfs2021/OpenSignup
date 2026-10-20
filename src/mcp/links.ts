import { previewPageUrl, publicSignupUrl, signupPageUrl } from '@/lib/links';

/**
 * Where a person can open the signup. `edit` is the signup's own page, which
 * opens a draft with slots on its review page, where the organizer can check
 * it and publish, and anything else in the builder (not /edit, which
 * redirects to settings). `preview` shows the organizer what
 * participants will see even while it is a draft, and `public` is the page to
 * share once it is published.
 */
export function signupLinks(row: { id: string; slug: string }): {
  edit: string;
  preview: string;
  public: string;
} {
  return {
    edit: signupPageUrl(row.id),
    preview: previewPageUrl(row.id),
    public: publicSignupUrl(row.slug),
  };
}
