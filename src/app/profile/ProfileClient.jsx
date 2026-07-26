"use client";

import { useEffect, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import { STOCK_AVATARS, accountAvatar, useArsenalAccount } from "../../context/ArsenalAccountContext";
import { useSleeper } from "../../context/SleeperContext";

const n = (value) => Number(value || 0);
function Panel({ children, className="" }) {
  return <section className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</section>;
}
function Field({ label, ...props }) {
  return <label><span className="mb-1.5 block text-xs text-white/42">{label}</span><input {...props} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-300/35" /></label>;
}

export default function ProfileClient() {
  const { username } = useSleeper();
  const accountState = useArsenalAccount();
  const { account, isConnected, createAccount, loginAccount, updateProfile, uploadAvatar, disconnect, syncNow, syncing, syncState } = accountState;
  const [displayName,setDisplayName]=useState("");
  const [bio,setBio]=useState("");
  const [loginName,setLoginName]=useState("");
  const [password,setPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [preferences,setPreferences]=useState({ criticalAlerts:true,kickoffAlerts:true,injuryAlerts:true,draftAlerts:true,weeklyDigest:false,riskStyle:"balanced",valueWeight:50,projectionWeight:50 });
  const fileRef=useRef(null);

  useEffect(()=>{setDisplayName(account?.displayName||"");setBio(account?.bio||"");setLoginName(account?.loginName||username||"");},[account,username]);
  useEffect(()=>{try{setPreferences((current)=>({...current,...JSON.parse(localStorage.getItem("tfa:account-preferences")||"{}")}));}catch{}},[]);
  useEffect(()=>{const restore=()=>{try{setPreferences((current)=>({...current,...JSON.parse(localStorage.getItem("tfa:account-preferences")||"{}")}));}catch{}};window.addEventListener("tfa:cloud-sync-applied",restore);return()=>window.removeEventListener("tfa:cloud-sync-applied",restore);},[]);
  const run=async(action)=>{setBusy(true);setMessage("");try{await action();}catch(error){setMessage(error?.message||"That action could not be completed.");}finally{setBusy(false);}};
  const create=()=>run(async()=>{await createAccount(username,loginName,password);setPassword("");setMessage("Account created. Your Arsenal workspace will now follow you across devices.");});
  const login=()=>run(async()=>{await loginAccount(loginName,password);setPassword("");setMessage("Signed in. Your saved workspace is being restored.");});
  const saveProfile=()=>run(async()=>{await updateProfile({displayName,bio});await syncNow();setMessage("Profile saved and workspace synced.");});
  const saveCredentials=()=>run(async()=>{await updateProfile({loginName,...(newPassword?{newPassword}:{})});setNewPassword("");setMessage("Account sign-in updated.");});
  const chooseAvatar=(avatarValue)=>run(async()=>{await updateProfile({avatarType:"stock",avatarValue});setMessage("Avatar updated.");});
  const upload=(file)=>run(async()=>{if(!file)return;await uploadAvatar(file);setMessage("Custom avatar uploaded.");});
  const savePreferences=()=>run(async()=>{
    localStorage.setItem("tfa:account-preferences",JSON.stringify(preferences));
    if(preferences.criticalAlerts&&typeof Notification!=="undefined"&&Notification.permission==="default")await Notification.requestPermission();
    await syncNow();setMessage("Intelligence preferences saved and synced.");
  });

  return <main className="min-h-screen text-white"><BackgroundParticles/><Navbar pageTitle="Arsenal Profile"/><div className="mx-auto max-w-6xl px-4 pb-20 pt-20">
    <header className="overflow-hidden rounded-[34px] border border-violet-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(139,92,246,.22),transparent_38%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8">
      <div className="text-[10px] font-semibold uppercase tracking-[.28em] text-violet-200/60">Optional identity and continuity</div>
      <h1 className="mt-2 text-3xl font-black sm:text-5xl">Your Arsenal profile</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-white/48">Every tool remains available in guest mode. Sign in anywhere to restore your profile, source choices, intelligence preferences, saved decisions, trade workspaces, watchlists, draft queues, lineup saves, playoff scenarios, and commissioner notes.</p>
    </header>

    {!isConnected?<div className="mt-6 grid gap-5 lg:grid-cols-2">
      <Panel className="p-5 sm:p-6"><div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200/55">Start fresh</div><h2 className="mt-1 text-2xl font-black">Create an optional account</h2><p className="mt-2 text-sm leading-6 text-white/42">Choose an Arsenal account name and password. It is associated with your current Sleeper identity, <b className="text-white/75">{username||"not signed in"}</b>.</p><div className="mt-4 space-y-3"><Field label="Account name" value={loginName} onChange={(event)=>setLoginName(event.target.value)} autoComplete="username"/><Field label="Password · at least 10 characters" value={password} onChange={(event)=>setPassword(event.target.value)} type="password" autoComplete="new-password"/></div><button type="button" disabled={!username||!loginName.trim()||password.length<10||busy} onClick={create} className="mt-4 min-h-12 w-full rounded-2xl bg-cyan-300/10 px-5 font-black text-cyan-100 disabled:opacity-40">{username?"Create Arsenal account":"Log in with Sleeper first"}</button></Panel>
      <Panel className="p-5 sm:p-6"><div className="text-[10px] font-semibold uppercase tracking-wider text-violet-200/55">Welcome back</div><h2 className="mt-1 text-2xl font-black">Sign in to your Arsenal</h2><p className="mt-2 text-sm leading-6 text-white/42">The same credentials work on mobile, desktop, and the embedded Ballsville experience. Each device receives its own secure session.</p><div className="mt-4 space-y-3"><Field label="Account name" value={loginName} onChange={(event)=>setLoginName(event.target.value)} autoComplete="username"/><Field label="Password" value={password} onChange={(event)=>setPassword(event.target.value)} type="password" autoComplete="current-password"/></div><button type="button" disabled={!loginName.trim()||!password||busy} onClick={login} className="mt-4 min-h-12 w-full rounded-2xl bg-violet-300/10 px-5 font-black text-violet-100 disabled:opacity-40">Sign in</button></Panel>
    </div>:<div className="mt-6 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel className="h-fit overflow-hidden xl:sticky xl:top-20"><div className="bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.16),transparent_50%)] p-6 text-center"><div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-[32px] border border-white/15 bg-slate-950/80 shadow-2xl"><img src={accountAvatar(account)} alt="" className="h-20 w-20 object-contain"/></div><h2 className="mt-4 text-2xl font-black">{account.displayName}</h2><p className="mt-1 text-xs text-white/38">@{account.sleeperUsername}</p><span className="mt-3 inline-flex rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1 text-[10px] font-bold text-emerald-100">Cross-device sync enabled</span></div><div className="border-t border-white/10 p-5"><div className="text-xs text-white/42">{syncState.message}{syncState.at?` · ${syncState.at.toLocaleTimeString()}`:""}</div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={()=>run(async()=>{await syncNow();setMessage("Workspace synced.");})} disabled={syncing} className="rounded-xl bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{syncing?"Syncing…":"Sync now"}</button><button type="button" onClick={disconnect} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs font-bold text-white/55">Sign out</button></div></div></Panel>
      <div className="space-y-5">
        <Panel className="p-5 sm:p-6"><h2 className="text-xl font-black">Profile identity</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Display name" value={displayName} onChange={(event)=>setDisplayName(event.target.value)} maxLength={48}/><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-white/42">Profile bio</span><textarea value={bio} onChange={(event)=>setBio(event.target.value)} maxLength={280} rows={3} className="w-full rounded-2xl border border-white/10 bg-slate-950 p-4"/></label></div><button type="button" onClick={saveProfile} disabled={busy} className="mt-4 rounded-2xl bg-violet-300/10 px-5 py-3 text-sm font-black text-violet-100">Save profile</button></Panel>
        <Panel className="p-5 sm:p-6"><div className="flex items-end justify-between gap-4"><div><h2 className="text-xl font-black">Choose your avatar</h2><p className="mt-1 text-xs text-white/38">Use an Arsenal identity or upload your own image.</p></div><button type="button" onClick={()=>fileRef.current?.click()} className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs font-bold text-white/65">Upload image</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event)=>upload(event.target.files?.[0])}/></div><div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">{STOCK_AVATARS.map((avatar)=><button type="button" key={avatar.key} onClick={()=>chooseAvatar(avatar.key)} className={`rounded-2xl border p-2 ${account.avatarType==="stock"&&account.avatarValue===avatar.key?"border-cyan-300/35 bg-cyan-300/[0.08]":"border-white/10 bg-black/15"}`}><div className={`grid aspect-square place-items-center rounded-xl bg-gradient-to-br ${avatar.gradient}`}><img src={avatar.src} alt="" className="h-11 w-11 object-contain"/></div><span className="mt-2 block truncate text-[9px] text-white/45">{avatar.label}</span></button>)}</div><p className="mt-3 text-[10px] text-white/28">Uploads support JPEG, PNG, WEBP, or GIF up to 1.5 MB and use the Cloudflare PROFILE_MEDIA R2 bucket.</p></Panel>
        <Panel className="p-5 sm:p-6"><h2 className="text-xl font-black">Intelligence preferences</h2><p className="mt-1 text-xs text-white/38">These choices follow your account and control how recommendations balance urgency, risk, points, and value.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{[["criticalAlerts","Critical decision alerts"],["kickoffAlerts","Upcoming kickoff locks"],["injuryAlerts","Injury and inactive changes"],["draftAlerts","Live draft events"],["weeklyDigest","Weekly portfolio digest"]].map(([key,label])=><label key={key} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/15 p-3 text-xs"><span>{label}</span><input type="checkbox" checked={!!preferences[key]} onChange={(event)=>setPreferences((current)=>({...current,[key]:event.target.checked}))} className="h-4 w-4 accent-cyan-300"/></label>)}</div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label><span className="mb-1 block text-xs text-white/38">Decision style</span><select value={preferences.riskStyle} onChange={(event)=>setPreferences((current)=>({...current,riskStyle:event.target.value}))} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2"><option value="safe">Risk controlled</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive upside</option></select></label><label><span className="mb-1 block text-xs text-white/38">Projection emphasis · {preferences.projectionWeight}%</span><input type="range" min="0" max="100" value={preferences.projectionWeight} onChange={(event)=>setPreferences((current)=>({...current,projectionWeight:n(event.target.value),valueWeight:100-n(event.target.value)}))} className="w-full accent-violet-300"/></label></div><button type="button" onClick={savePreferences} className="mt-4 rounded-xl bg-cyan-300/10 px-4 py-3 text-xs font-black text-cyan-100">Save intelligence preferences</button></Panel>
        <Panel className="p-5 sm:p-6"><h2 className="text-xl font-black">Account sign-in</h2><p className="mt-2 text-xs leading-5 text-white/40">{account.hasPassword?"Use these credentials on any device. Changing your password does not interrupt other active devices.":"Upgrade this original key-based account by choosing an account name and password. Existing synchronized data stays attached."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Account name" value={loginName} onChange={(event)=>setLoginName(event.target.value)} autoComplete="username"/><Field label={account.hasPassword?"New password · optional":"Create password · required"} value={newPassword} onChange={(event)=>setNewPassword(event.target.value)} type="password" autoComplete="new-password"/></div><button type="button" disabled={busy||!loginName.trim()||(!account.hasPassword&&newPassword.length<10)||(!!newPassword&&newPassword.length<10)} onClick={saveCredentials} className="mt-3 rounded-xl bg-violet-300/10 px-4 py-3 text-xs font-black text-violet-100">Update sign-in</button></Panel>
      </div>
    </div>}
    {message?<div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4 text-sm text-cyan-100">{message}</div>:null}
  </div></main>;
}
