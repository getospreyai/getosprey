import Link from "next/link";

// Structured to satisfy NRS 603A.340(1)(a)-(e) — Nevada's operator notice
// statute, which binds Osprey regardless of size (the small-local-business
// carve-out needs revenue primarily from a NON-internet source). Section
// numbers below map to the statutory elements:
//   (a) categories collected + categories of third parties -> §2, §6
//   (b) process to review/request changes                  -> §9
//   (c) how material changes are communicated              -> §14
//   (d) third-party cross-site tracking (we run none)      -> §7
//   (e) effective date                                     -> constant below
// NRS 603A.345 (opt-out-of-sale request address + 60-day response) -> §8.
// The AI/LLM training disclosure in §4 is an FTC Act §5 obligation: a
// permissive data practice needs clear, up-front notice — never a quiet edit.

/** Fixed, hand-edited on material change. Must NOT auto-render "today": a
 *  notice whose effective date silently tracks the clock is misleading and
 *  defeats the statutory element it exists to satisfy. */
const EFFECTIVE_DATE = "July 21, 2026";

export const metadata = {
  title: "Privacy Policy — Osprey",
};

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 bg-black px-6 py-20 text-white">
      <Link href="/" className="text-sm text-white/50 underline hover:text-white/80">
        &larr; Back to Osprey
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-white/40">Effective date: {EFFECTIVE_DATE}</p>

      <div className="mt-10 space-y-8 leading-7 text-white/80">
        <section>
          <h2 className="text-lg font-semibold text-white">1. Who we are and what this covers</h2>
          <p className="mt-2">
            Osprey LLC (&quot;Osprey,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates
            the website at getosprey.ai and the Osprey real-estate analysis service, including our
            Telegram bot. This policy describes what information we collect, how we use it, who we
            share it with, and the choices you have. It applies to visitors to our website, people
            who join our waitlist, and account holders who use the service.
          </p>
          <p className="mt-2">
            Osprey LLC is a Nevada limited liability company, and the service is intended for users in
            the United States. We do not
            knowingly collect information from children under 13, and the service is not directed to
            them.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">2. Information we collect</h2>
          <p className="mt-2">We collect the following categories of information:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <span className="text-white">Waitlist information</span> — the name, email address, and
              (optionally) phone number you submit to join our waitlist.
            </li>
            <li>
              <span className="text-white">Account information</span> — your name, email address, and
              password. Passwords are stored only as a salted cryptographic hash; we never store or
              have access to your plain-text password.
            </li>
            <li>
              <span className="text-white">Investor profile</span> — the criteria you configure,
              including target markets and property types, price range, financing terms (such as
              interest rate and down payment percentage), your minimum cash-flow threshold, and any
              preferences or notes you or the service records about the kinds of deals you like and
              dislike.
            </li>
            <li>
              <span className="text-white">Messaging information</span> — if you connect Telegram, we
              store your Telegram chat identifier so we can deliver messages to you, and we process
              the content of the messages you send to the bot in order to respond to them.
            </li>
            <li>
              <span className="text-white">Property and analysis data</span> — listings matched to
              your criteria, the underwriting figures we calculate, and any analyses, scenarios,
              reports, or share links generated in your account.
            </li>
            <li>
              <span className="text-white">Technical information</span> — standard server and
              security log data such as IP address, browser and device type, and pages requested,
              generated automatically when you use the site.
            </li>
          </ul>
          <p className="mt-3">
            We do not collect Social Security numbers, government identifiers, financial account or
            payment card numbers, precise geolocation, or biometric data. Please do not send
            sensitive information of that kind to our bot or support address.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">3. How we use your information</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>To provide the service: match listings to your criteria, underwrite them, and deliver
              verdicts, analyses, and reports to you</li>
            <li>To create and secure your account and authenticate your sessions</li>
            <li>To respond to your messages, questions, and support requests</li>
            <li>To operate, maintain, debug, and improve the website and service</li>
            <li>To send you product updates and, where you have consented, marketing communications</li>
            <li>To comply with legal obligations and enforce our terms</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">4. How we use AI — please read</h2>
          <p className="mt-2">
            Osprey uses artificial intelligence in two places: to interpret the plain-English
            messages you send our Telegram bot, and to answer your questions about a specific deal.
            The underwriting math itself is deterministic software, not AI.
          </p>
          <p className="mt-2">
            <span className="text-white">AI output can be wrong.</span> Responses generated by AI may
            be inaccurate, incomplete, or out of date. They are informational only and are not
            investment, legal, tax, financial, or real-estate brokerage advice. Always verify figures
            independently before acting on them.
          </p>
          <p className="mt-2">
            <span className="text-white">Who processes this content.</span> To process the requests
            described above, we send the relevant content — which can include the text of the
            messages you send the bot, your buy-box criteria, property addresses, and the underwriting
            figures for deals in your feed — to our AI provider, OpenRouter, and the upstream model
            providers it routes to.
          </p>
          <p className="mt-2">
            <span className="text-white">We do not permit this content to be used to train AI models.</span>{" "}
            We have opted out of the training/logging option OpenRouter otherwise offers on free model
            endpoints, so your content is used to generate your response and is not retained by
            OpenRouter or its upstream providers to improve their models. If that ever changes — for
            example, if we move to a different provider or plan — we will update this section and
            give you prominent notice before the change takes effect, not after.
          </p>
          <p className="mt-2">
            You can also avoid sending anything to our AI provider at all by using only the keyword
            commands in Telegram (handled entirely by our own software) or the dashboard instead of
            plain-English messages. Questions about this: {" "}
            <a href="mailto:privacy@getosprey.ai" className="underline hover:text-white">
              privacy@getosprey.ai
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">5. Cookies and tracking</h2>
          <p className="mt-2">
            Osprey uses <span className="text-white">first-party, strictly necessary cookies only</span>
            . These are limited to your authenticated session and cross-site request forgery
            protection — the cookies that keep you logged in and keep your account secure. They are
            not used for advertising or profiling.
          </p>
          <p className="mt-2">
            We do not use analytics tools, advertising networks, pixels, session recording, or any
            other third-party tracking technology on our website. Because we set no non-essential
            cookies, we do not display a cookie consent banner. You can block or delete cookies in
            your browser settings, but the service will not be able to keep you signed in if you
            block essential cookies.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">6. Who we share information with</h2>
          <p className="mt-2">
            We share information with the following categories of third parties, only as needed to
            run the service:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <span className="text-white">Hosting and infrastructure</span> (Vercel) — serves the
              website and processes request and security logs.
            </li>
            <li>
              <span className="text-white">Database</span> (Neon) — stores your account, investor
              profile, and analysis data.
            </li>
            <li>
              <span className="text-white">Messaging</span> (Telegram) — delivers messages to you and
              relays the messages you send us. Your use of Telegram is also governed by Telegram&apos;s
              own privacy policy.
            </li>
            <li>
              <span className="text-white">AI processing</span> (OpenRouter and the upstream model
              providers it routes to) — interprets your messages and generates answers, subject to
              the important limitation described in Section 4.
            </li>
            <li>
              <span className="text-white">Property data</span> (RentCast) — supplies listing and rent
              data to us. We send property queries, not your personal information, to this provider.
            </li>
            <li>
              <span className="text-white">Legal and corporate</span> — we may disclose information if
              required by law, subpoena, or legal process, to protect our rights or the safety of
              others, or in connection with a merger, acquisition, financing, or sale of assets.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">7. No third-party tracking across websites</h2>
          <p className="mt-2">
            Nevada law requires us to tell you whether a third party may collect information about
            your activities over time and across different websites when you use our service.{" "}
            <span className="text-white">
              No third party collects information about your online activities across other websites
              through Osprey.
            </span>{" "}
            We run no advertising networks, analytics trackers, or cross-site pixels.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">8. We do not sell your information</h2>
          <p className="mt-2">
            <span className="text-white">Osprey does not sell your covered information</span>, and we
            have never done so. Under Nevada law (NRS 603A), a &quot;sale&quot; means exchanging
            covered information for money so that the recipient can license or resell it to others.
            Our disclosures to the service providers listed in Section 6 are made so they can perform
            services for us and are not sales.
          </p>
          <p className="mt-2">
            If you are a Nevada consumer and wish to submit a verified request directing us not to
            sell your covered information, you may do so at our designated request address:{" "}
            <a href="mailto:privacy@getosprey.ai" className="underline hover:text-white">
              privacy@getosprey.ai
            </a>
            . We will respond within 60 days of receiving a verified request. If we need more time,
            we may extend that period by up to 30 additional days and will notify you of the
            extension.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            9. Reviewing, correcting, and deleting your information
          </h2>
          <p className="mt-2">
            You can review and change most of your information at any time by signing in and editing
            your profile and settings, which is where your buy box, financing terms, cash-flow
            threshold, learned preferences, and Telegram connection all live.
          </p>
          <p className="mt-2">
            For anything you cannot change yourself — including requests to access, correct, or
            delete your account and the information associated with it, or to be removed from our
            waitlist — email{" "}
            <a href="mailto:privacy@getosprey.ai" className="underline hover:text-white">
              privacy@getosprey.ai
            </a>
            . We will verify your request and respond within 60 days. Deleting your account removes
            your profile, verdicts, analyses, and share links; we may retain limited records where we
            are required or permitted by law to do so.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">10. Share links you create</h2>
          <p className="mt-2">
            Osprey lets you create a share link to a read-only page for a property analysis. Anyone
            who has the link can view that page without signing in, and the page displays your name
            as the person who prepared it. Share links are unlisted and we ask search engines not to
            index them, but you should treat them as public. Only share a link with people you intend
            to see it, and revoke it from the property page when you are done.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">11. Marketing communications</h2>
          <p className="mt-2">
            If you provide your phone number and consent, you may receive recurring marketing text
            messages and calls from Osprey or service providers acting on our behalf, including
            messages sent using automated technology. Consent is not a condition of any purchase.
            Message and data rates may apply, and message frequency varies.
          </p>
          <p className="mt-2">
            You can opt out of marketing texts at any time by replying{" "}
            <span className="text-white">STOP</span> to any message, and reply{" "}
            <span className="text-white">HELP</span> for help. You can unsubscribe from marketing
            emails using the link in any such email, and we honor opt-out requests promptly. Messages
            you receive through the Telegram bot are service messages you requested by connecting your
            account; you can disconnect at any time or block the bot in Telegram.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">12. Security</h2>
          <p className="mt-2">
            We maintain reasonable administrative and technical safeguards designed to protect your
            information, including encryption in transit (HTTPS/TLS), salted password hashing,
            access-controlled infrastructure, and collecting only the data the service needs. No
            system is perfectly secure, and we cannot guarantee absolute security. If a breach of
            unencrypted personal information affecting Nevada residents occurs, we will provide notice
            as required by NRS 603A.220.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">13. Data retention</h2>
          <p className="mt-2">
            We keep your account and profile information for as long as your account is active, and
            waitlist information until you ask to be removed or we no longer need it. Property and
            analysis data is retained so your history remains available to you. Server and security
            logs are kept for a limited period. When information is no longer needed, we delete it or
            retain it only as required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">14. Changes to this policy</h2>
          <p className="mt-2">
            We may update this policy from time to time. When we do, we will post the revised policy
            on this page and update the effective date above. If we make a material change —
            particularly one that expands how we use or share your information — we will provide
            prominent notice before it takes effect, by email to the address associated with your
            account, a notice in the product, or both. We will not apply a materially different
            practice to information we already collected without giving you notice and, where
            appropriate, a choice.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">15. Contact us</h2>
          <p className="mt-2">
            Questions, requests, or concerns about this policy or your information:{" "}
            <a href="mailto:privacy@getosprey.ai" className="underline hover:text-white">
              privacy@getosprey.ai
            </a>
            . For anything else, reach us at{" "}
            <a href="mailto:hello@getosprey.ai" className="underline hover:text-white">
              hello@getosprey.ai
            </a>
            .
          </p>
          <p className="mt-2">
            See also our{" "}
            <Link href="/terms" className="underline hover:text-white">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
