"use client";

import { useEffect, useState } from "react";
import { useArsenalAccount } from "../context/ArsenalAccountContext";

const n = (value) => Number(value || 0);

export default function CommissionerDigestPreference() {
  const { accountRequest, syncNow } = useArsenalAccount();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem("tfa:account-preferences") || "{}");
      setEnabled(!!preferences.newsCommissionerUrgent);
    } catch {}
  }, []);

  const save = async (nextEnabled) => {
    setEnabled(nextEnabled);
    setMessage("");
    try {
      const preferences = JSON.parse(localStorage.getItem("tfa:account-preferences") || "{}");
      const next = { ...preferences, newsCommissionerUrgent:nextEnabled };
      localStorage.setItem("tfa:account-preferences", JSON.stringify(next));
      await syncNow({ quiet:true });
      const newsDays = Array.isArray(next.newsDeliveryDays) ? next.newsDeliveryDays : [n(next.newsDeliveryDay ?? 4)];
      await accountRequest("/api/arsenal/digest", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          email:next.digestEmail || "",
          enabled:!!next.weeklyDigest,
          deliveryDay:n(next.digestDeliveryDay ?? 2),
          includeNews:next.digestIncludeNews !== false,
          newsEnabled:!!next.newsBrief,
          newsDeliveryDay:n(newsDays[0] ?? 4),
          newsDeliveryDays:newsDays,
          commissionerUrgent:nextEnabled,
        }),
      });
      setMessage(nextEnabled ? "Urgent commissioner briefings will be included in your Daily Intelligence Wire." : "Commissioner items removed from the Daily Intelligence Wire.");
    } catch (error) {
      setMessage(error?.message || "Commissioner email preference could not be saved.");
    }
  };

  return <section className="mt-5 rounded-[26px] border border-rose-300/15 bg-gradient-to-br from-rose-300/[0.055] to-slate-950/90 p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[.2em] text-rose-200/55">Commissioner delivery</div>
        <h2 className="mt-1 text-xl font-black">Urgent items in the Daily Intelligence Wire</h2>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-white/40">For leagues you own, include manager-specific empty lineups and unresolved trade-review items in the daily news email. Signals provide evidence and never declare misconduct.</p>
      </div>
      <input type="checkbox" checked={enabled} onChange={(event) => save(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-rose-300" aria-label="Include urgent commissioner items in daily email" />
    </div>
    <div className="mt-3 rounded-xl bg-black/15 p-3 text-[10px] leading-4 text-white/32">Daily Intelligence Wire delivery must also be enabled from Command Home. This preference controls content, not the delivery schedule.</div>
    {message ? <div className="mt-3 text-xs text-cyan-100">{message}</div> : null}
  </section>;
}
