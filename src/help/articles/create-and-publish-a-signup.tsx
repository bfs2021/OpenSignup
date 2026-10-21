import { DRAFT_NUDGE_DELAY_HOURS } from '@/lib/draft-nudge';
import { REMINDER_SETTLE_HOURS } from '@/lib/reminder-eligibility';
import { INSTANCE_NAME } from '@/lib/site-config';
import { REMINDER_BEFORE } from '@/schemas/signups';
import { Note, Screenshot, Step, Steps, Ui } from '../components';
import { UI } from './create-and-publish-a-signup.ui';

export { UI };

// A sign-up newer than this isn't picked up yet (src/jobs/reminders.ts).
const SETTLE = REMINDER_SETTLE_HOURS === 1 ? 'an hour' : `${REMINDER_SETTLE_HOURS} hours`;
// When the email about an unpublished draft goes out (src/jobs/draft-nudges.ts).
const NUDGE = DRAFT_NUDGE_DELAY_HOURS === 1 ? 'an hour' : `${DRAFT_NUDGE_DELAY_HOURS} hours`;

export function CreateAndPublishASignup() {
  return (
    <>
      <p>
        A signup is a page where people choose something to do or bring. Each thing they can choose
        is a slot. By the end, you&apos;ll have a published signup and a link to send to people.
      </p>
      <p>People who sign up don&apos;t need an account. All they need is the link.</p>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Create the signup</h2>
        <Steps>
          <Step>
            <p>
              Sign in to {INSTANCE_NAME}. The first time you sign in, this creates your account.
            </p>
          </Step>
          <Step>
            <p>
              On the <Ui>{UI.yourSignups}</Ui> page, choose <Ui>{UI.newSignup}</Ui> at the top.
            </p>
            <Note>
              <p>
                Some sites can fill in a signup for you. If you see <Ui>{UI.composeHeading}</Ui>,
                describe your signup in a few sentences. Then choose <Ui>{UI.draftCompose}</Ui>. Your
                draft opens on <Ui>{UI.reviewHeading}</Ui>, where you check every slot before you
                publish, as shown below.
              </p>
              <p>
                To follow the steps here instead, choose <Ui>{UI.skipCompose}</Ui>.
              </p>
            </Note>
          </Step>
          <Step>
            <p>
              Type a name in <Ui>{UI.title}</Ui>, like &ldquo;Snack duty &mdash; Spring
              season&rdquo;. You can add a few lines about it in <Ui>{UI.description}</Ui>.
            </p>
            <Screenshot
              src="/help/create-and-publish-a-signup/new-signup.png"
              alt="The New signup page, with Snack duty — Spring season typed in as the title."
              width={576}
              height={356}
            />
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.createSignup}</Ui>. Your signup is saved as a draft. Nobody else can
              see a draft until you publish it.
            </p>
          </Step>
        </Steps>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Add slots</h2>
        <p>
          A slot is one thing people can sign up for, like snacks for one game. Each slot has one or
          more spots. A person can take one spot or several. A new signup starts with one empty
          slot.
        </p>
        <Steps>
          <Step>
            <p>
              Choose the slot marked <Ui>{UI.emptySlot}</Ui> to open it.
            </p>
          </Step>
          <Step>
            <p>
              In <Ui>{UI.what}</Ui>, type what the slot is for, like &ldquo;Fruit and water&rdquo;.
            </p>
          </Step>
          <Step>
            <p>
              Set the <Ui>{UI.date}</Ui>.
            </p>
          </Step>
          <Step>
            <p>
              In <Ui>{UI.capacity}</Ui>, type how many spots this slot has. If two families bring
              snacks to each game, type 2.
            </p>
            <Screenshot
              src="/help/create-and-publish-a-signup/slot.png"
              alt="A slot being edited, with What set to Fruit and water, a date set, and Capacity set to 2."
              width={520}
              height={182}
            />
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.done}</Ui> to close the slot. Your changes save as you go.
            </p>
          </Step>
          <Step>
            <p>
              For the next slot, choose <Ui>{UI.addSlot}</Ui> and fill it in the same way.
            </p>
          </Step>
          <Step>
            <p>
              To copy a slot, open it and choose <Ui>{UI.duplicate}</Ui>. Then open the copy and
              change its date.
            </p>
          </Step>
        </Steps>
        <p>
          You can&apos;t undo deleting a slot. To remove one you don&apos;t need, open it and choose{' '}
          <Ui>{UI.delete}</Ui>. Don&apos;t leave a slot empty: people see it as{' '}
          <Ui>{UI.untitledSlot}</Ui>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Come back to a draft</h2>
        <p>
          You don&apos;t have to publish straight away. Your draft keeps everything you added.
        </p>
        <Steps>
          <Step>
            <p>
              On the <Ui>{UI.yourSignups}</Ui> page, choose your draft. Once a slot has something
              in it, the draft opens on <Ui>{UI.reviewHeading}</Ui>. It shows your slots the way
              people will see them.
            </p>
            <p>
              If something needs fixing first, the page says so above your slots. A slot that still
              says TBD is one example.
            </p>
            <p>
              Some problems have a button that fixes them right there. For a slot with nothing in
              it, choose <Ui>{UI.removeBlankSlot}</Ui>. For slots that are copies of each other,
              choose <Ui>{UI.mergeCopies}</Ui>: one slot takes all their spots. Right after a fix,
              you can choose{' '}
              <Ui>{UI.undo}</Ui> to put it back. For other problems, choose{' '}
              <Ui>{UI.fixInBuilder}</Ui>.
            </p>
            <Screenshot
              src="/help/create-and-publish-a-signup/check-your-signup.png"
              alt="Check your signup, then share it, with the signup's name, its two slots with People for each slot beside them, nothing to fix, and what happens when someone signs up."
              width={760}
              height={569}
            />
          </Step>
          <Step>
            <p>
              To change the name and description, or whether people need to give an email address,
              choose <Ui>{UI.change}</Ui> next to it. Then choose <Ui>{UI.save}</Ui>.
            </p>
          </Step>
          <Step>
            <p>
              To change a slot, choose it. Change what you need, like its date or its{' '}
              <Ui>{UI.capacity}</Ui>, then choose <Ui>{UI.done}</Ui> to save it. To close it without
              saving, choose <Ui>{UI.cancel}</Ui>.
            </p>
            <p>
              To give every slot the same number of spots, type the number in{' '}
              <Ui>{UI.peopleEach}</Ui>, above your slots. Then choose <Ui>{UI.setPeopleEach}</Ui>.
              Right after, <Ui>{UI.undo}</Ui> puts back what each slot had.
            </p>
            <p>
              If your slots are grouped by date, choose <Ui>{UI.removeDay}</Ui> under a date to
              remove it and all its slots. Right after, <Ui>{UI.undo}</Ui> puts them back.
            </p>
          </Step>
          <Step>
            <p>
              To add or remove slots, choose <Ui>{UI.editInBuilder}</Ui>. When everything looks
              right, choose <Ui>{UI.publishFromReview}</Ui> to publish it. Then send the link, as
              shown below.
            </p>
          </Step>
        </Steps>
        <p>
          If you don&apos;t publish a draft, we email you a link back to it {NUDGE} after you
          started it. We send it once, and not for a draft an AI assistant made for you. To get the
          link now, choose <Ui>{UI.emailMeLater}</Ui>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Publish and share the link</h2>
        <Steps>
          <Step>
            <p>
              On a computer, you can check your signup first. Choose <Ui>{UI.preview}</Ui> at the
              top of the page. It opens in a new tab and shows what people will see. Small screens,
              like most phones, don&apos;t show this button.
            </p>
          </Step>
          <Step>
            <p>
              When you publish, anyone with the link can sign up. Choose <Ui>{UI.publish}</Ui> at
              the top of the page. On a phone, choose the three dots at the top, then{' '}
              <Ui>{UI.publishOnPhone}</Ui>.
            </p>
            <p>
              You&apos;ll see <Ui>{UI.shareHeading}</Ui>
            </p>
            <Screenshot
              src="/help/create-and-publish-a-signup/share-step.png"
              alt="It's live. Now send the link: the signup's name, its link, and a Copy link button."
              width={592}
              height={294}
            />
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.copyLink}</Ui>. Send the link to people by email or in a group chat. On
              a phone, you can choose <Ui>{UI.share}</Ui> instead, to send it from another app.
            </p>
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.doneSharing}</Ui> to go back to your signup.
            </p>
          </Step>
        </Steps>
        <p>
          The box under <Ui>{UI.messageBox}</Ui> holds your signup&apos;s name and the link. Change
          the words if you like. Then choose <Ui>{UI.copyMessage}</Ui>, and paste it where you want
          to send it.
        </p>
        <p>
          For a flyer or a newsletter, choose <Ui>{UI.downloadQr}</Ui>. It saves a picture of a
          code. Pointing a phone&apos;s camera at it opens your signup.
        </p>
        <p>
          You can copy the link again at any time. At the top of your signup, next to{' '}
          <Ui>{UI.publicLink}</Ui>, choose the copy button. The link is there before you publish
          too. Until you publish, it only says the signup isn&apos;t ready.
        </p>
        <Screenshot
          src="/help/create-and-publish-a-signup/published.png"
          alt="The top of a published signup, marked open, with the public link and its copy button."
          width={480}
          height={110}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">What happens next</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            People open the link and choose <Ui>{UI.signUp}</Ui> on a slot. They type their name
            and email address, and can add a note. You can make the email address optional, as
            shown below.
          </li>
          <li>
            A slot with more than one spot shows how many are left, like 1 left. People can take
            more than one spot at a time. When a slot is full, nobody else can choose it.
          </li>
          <li>
            Each person who gives an email address gets an email saying they&apos;re signed up. It
            has a link they can use to change or cancel. Everyone sees the link on screen after
            signing up, and people who gave no email address need to save it.
          </li>
          <li>
            Search engines are asked not to list signup pages. Anyone with the link can open yours,
            so share it only with the people you want.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Reminders</h2>
        <p>
          If a slot has a date, people who take it and gave an email address get a reminder
          email{' '}
          {REMINDER_BEFORE}. Someone who signs up later than that gets one about {SETTLE} after
          signing up, unless the slot is less than {SETTLE} away. Each reminder has a link to stop
          them.
        </p>
        <p>Reminders are on for every new signup. To turn them off:</p>
        <Steps>
          <Step>
            <p>
              Choose <Ui>{UI.fields}</Ui> at the top of your signup.
            </p>
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.date}</Ui>.
            </p>
          </Step>
          <Step>
            <p>
              Clear <Ui>{UI.reminderToggle}</Ui>, then choose <Ui>{UI.save}</Ui>.
            </p>
          </Step>
        </Steps>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Let people sign up without an email
        </h2>
        <p>
          A signup asks people for their email address unless you make it optional. Someone who
          leaves it blank gets no emails at all, not even reminders. They need to save the link they see after
          signing up. Only the browser they used remembers it.
        </p>
        <p>To make the email address optional:</p>
        <Steps>
          <Step>
            <p>
              On a phone, the <Ui>{UI.settings}</Ui> link at the very top of the page is for your
              account, so skip it. Under your signup&apos;s title, choose the{' '}
              <Ui>{UI.settings}</Ui> tab.
            </p>
          </Step>
          <Step>
            <p>
              In <Ui>{UI.signupForm}</Ui>, under <Ui>{UI.askForEmail}</Ui>, choose{' '}
              <Ui>{UI.emailOptional}</Ui>. Once you save, the email box on your signup says{' '}
              <Ui>{UI.emailBoxOptional}</Ui>.
            </p>
          </Step>
          <Step>
            <p>
              Choose <Ui>{UI.save}</Ui>. You&apos;ll see <Ui>{UI.saved}</Ui>.
            </p>
            <Screenshot
              src="/help/create-and-publish-a-signup/email-setting.png"
              alt="The Sign-up form settings, with Optional chosen for Ask for an email address, and Saved next to the Save button."
              width={672}
              height={250}
            />
          </Step>
        </Steps>
        <p>
          If someone who left it blank loses their link, ask them to sign up again. If their slot is
          full, remove them on the <Ui>{UI.responses}</Ui> tab first, so there&apos;s room.
          Otherwise they show up there twice, and the old one is higher up the list. Remove that
          one.
        </p>
        <p>
          You can switch back to <Ui>{UI.emailRequired}</Ui> later. Only people who sign up after
          that are asked for an email address. Anyone who signed up without one keeps their spot.
        </p>
      </section>
    </>
  );
}
