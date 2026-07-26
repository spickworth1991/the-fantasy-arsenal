"use client";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import DecisionInbox from "../../components/DecisionInbox";
import { useSleeper } from "../../context/SleeperContext";

export default function IntelligenceClient() {
  const { username } = useSleeper();
  return <main className="min-h-screen text-white"><BackgroundParticles /><Navbar pageTitle="Arsenal Intelligence" /><div className="mx-auto max-w-7xl px-4 pb-20 pt-20">
    {!username ? <div className="rounded-[30px] border border-white/10 bg-slate-950/80 p-10 text-center text-white/50">Log in with a Sleeper username from the homepage. An Arsenal account remains optional.</div> : <DecisionInbox full />}
  </div></main>;
}
