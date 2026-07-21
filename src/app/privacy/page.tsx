import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Osprey",
};

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 bg-black px-6 py-20 text-white">
      <Link href="/" className="text-sm text-white/50 underline hover:text-white/80">
        &larr; Back to Osprey
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-white/40">
        Last updated: {new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>

      <div className="mt-10 space-y-8 text-white/80 leading-7">
        <section>
          <h2 className="text-lg font-semibold text-white">1. Overview</h2>
          <p className="mt-2">
            This Privacy Policy describes how Osprey (&quot;Osprey,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects,
            uses, and shares information when you join our waitlist or
            otherwise interact with our website. By submitting your
            information, you agree to the practices described in this
            policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            2. Information We Collect
          </h2>
          <p className="mt-2">
            When you join the Osprey waitlist, we collect the information
            you voluntarily provide, which may include:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Phone number</li>
            <li>Email address</li>
            <li>
              Technical information such as IP address, browser type, device
              information, and usage data collected automatically through
              cookies and similar technologies
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            3. How We Use Your Information
          </h2>
          <p className="mt-2">
            We collect and use your phone number and email address for
            marketing and promotional purposes, including to:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              Send you updates, announcements, and marketing communications
              about Osprey via messaging apps (such as Telegram), text
              message (SMS/MMS), phone call, and/or email
            </li>
            <li>Notify you about our product launch and new features</li>
            <li>
              Personalize and improve our marketing and communications
            </li>
            <li>Operate, maintain, and improve our waitlist and website</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p className="mt-2">
            Osprey is designed as a messaging-first product, delivered
            primarily through messaging apps such as Telegram. If you
            provide a phone number, you may also receive recurring
            marketing text messages and/or calls from us or our service
            providers acting on our behalf.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            4. Consent to Marketing Communications
          </h2>
          <p className="mt-2">
            By submitting your phone number or email address, you expressly
            consent to receive marketing communications from Osprey by text
            message, phone call, and email, including messages sent using
            an automatic telephone dialing system or prerecorded/artificial
            voice where applicable. Consent to receive marketing messages is
            not a condition of any purchase. Message and data rates may
            apply. Message frequency varies.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            5. How to Opt Out
          </h2>
          <p className="mt-2">
            You may opt out of marketing text messages at any time by
            replying &quot;STOP&quot; to any message we send, and you may
            unsubscribe from marketing emails using the unsubscribe link
            included in each email. You may also contact us directly to
            request removal from our waitlist and marketing lists.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            6. Sharing of Information
          </h2>
          <p className="mt-2">
            We do not sell your personal information. We may share your
            information with third-party service providers who perform
            services on our behalf, such as messaging platforms (including
            Telegram), SMS/text messaging providers, email delivery
            providers, and analytics providers, solely for
            the purposes described in this policy. We may also disclose
            information if required to do so by law or in connection with a
            merger, acquisition, or sale of assets.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            7. Data Retention
          </h2>
          <p className="mt-2">
            We retain the information you provide for as long as necessary
            to fulfill the purposes described in this policy, unless a
            longer retention period is required or permitted by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            8. Your Rights
          </h2>
          <p className="mt-2">
            Depending on where you live, you may have rights regarding your
            personal information, including the right to access, correct,
            or delete the information we hold about you. To exercise these
            rights, contact us using the information below.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            9. Changes to This Policy
          </h2>
          <p className="mt-2">
            We may update this Privacy Policy from time to time. Any
            changes will be posted on this page with an updated
            &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            10. Contact Us
          </h2>
          <p className="mt-2">
            If you have questions about this Privacy Policy or would like to
            exercise your rights, contact us at{" "}
            <a
              href="mailto:hello@getosprey.ai"
              className="underline hover:text-white"
            >
              hello@getosprey.ai
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
