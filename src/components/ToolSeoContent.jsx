import Link from "next/link";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thefantasyarsenal.com";

export default function ToolSeoContent({ name, path, summary, features = [], faqs = [], related = [], primaryHeading = false }) {
  const url = `${SITE_URL}${path}`;
  const Heading = primaryHeading ? "h1" : "h2";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name,
        url,
        description: summary,
        applicationCategory: "SportsApplication",
        operatingSystem: "Any device with a web browser",
        featureList: features,
        isPartOf: { "@type": "WebSite", name: "The Fantasy Arsenal", url: SITE_URL },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "The Fantasy Arsenal", item: SITE_URL },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
      ...(faqs.length ? [{
        "@type": "FAQPage",
        mainEntity: faqs.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      }] : []),
    ],
  };

  return (
    <section className="relative z-10 mx-auto max-w-6xl px-4 pb-20" aria-labelledby={`about-${path.replace(/\W+/g, "-")}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/20 backdrop-blur-xl">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300/80">Fantasy football tool</p>
            <Heading id={`about-${path.replace(/\W+/g, "-")}`} className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">What {name} does</Heading>
            <p className="mt-4 max-w-3xl leading-7 text-slate-300">{summary}</p>
          </div>
          <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] p-5">
            <h3 className="font-bold text-white">What you can do</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
              {features.map((feature) => <li key={feature}>• {feature}</li>)}
            </ul>
          </div>
        </div>
        {faqs.length ? <div className="border-t border-white/10 px-6 py-5 sm:px-8">
          <h3 className="text-lg font-bold text-white">Common questions</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {faqs.map(({ question, answer }) => <details key={question} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 open:bg-white/[0.06]">
              <summary className="cursor-pointer font-semibold text-white">{question}</summary>
              <p className="mt-3 text-sm leading-6 text-slate-300">{answer}</p>
            </details>)}
          </div>
        </div> : null}
        {related.length ? <nav className="flex flex-wrap items-center gap-2 border-t border-white/10 px-6 py-4 text-sm sm:px-8" aria-label="Related fantasy football tools">
          <span className="mr-1 text-slate-500">Related:</span>
          {related.map(({ href, label }) => <Link key={href} href={href} className="rounded-full border border-white/10 px-3 py-1.5 font-semibold text-cyan-200 hover:border-cyan-300/30 hover:bg-cyan-300/10">{label}</Link>)}
        </nav> : null}
      </div>
    </section>
  );
}
