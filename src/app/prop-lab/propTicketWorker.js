/* eslint-disable no-restricted-globals */

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const hashSeed = (value) => {
  let seed = 2166136261;
  for (const character of String(value)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
};
const randomFactory = (seedValue) => {
  let state = hashSeed(seedValue) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};
const inverseNormal = (p) => {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 0.97575 ? Math.sqrt(-2 * Math.log(1 - p)) : p - 0.5;
  if (p < 0.02425) return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p > 0.97575) return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

function dependency(left, right, model) {
  if (left.gameKey !== right.gameKey) return { correlation: 0, sample: 0 };
  const relation = left.team === right.team ? "same_team" : "opponents";
  const signatures = [`${left.position}:${left.statKey}`, `${right.position}:${right.statKey}`].sort();
  const row = model?.pairs?.[`${relation}|${signatures.join("|")}`];
  if (!row) return null;
  const directionSign = left.direction === right.direction ? 1 : -1;
  return { correlation: clamp(Number(row.correlation) * directionSign, -0.35, 0.35), sample: Number(row.sample || 0) };
}

function quickScore(legs, model) {
  let logProbability = legs.reduce((sum, leg) => sum + Math.log(clamp(Number(leg.probability), 0.001, 0.999)), 0);
  let unsupported = false;
  for (let i = 0; i < legs.length; i += 1) for (let j = i + 1; j < legs.length; j += 1) {
    if (legs[i].gameKey !== legs[j].gameKey) continue;
    const row = dependency(legs[i], legs[j], model);
    if (!row) unsupported = true;
    else logProbability += row.correlation * 0.06;
  }
  return { score: logProbability - (unsupported ? 0.2 : 0), unsupported };
}

function cholesky(matrix) {
  const size = matrix.length;
  const result = Array.from({ length: size }, () => Array(size).fill(0));
  for (let i = 0; i < size; i += 1) for (let j = 0; j <= i; j += 1) {
    let sum = matrix[i][j];
    for (let k = 0; k < j; k += 1) sum -= result[i][k] * result[j][k];
    if (i === j) {
      if (sum <= 1e-8) return null;
      result[i][j] = Math.sqrt(sum);
    } else result[i][j] = sum / result[j][j];
  }
  return result;
}

function simulateTicket(legs, model, seed) {
  const gameGroups = new Map();
  legs.forEach((leg) => {
    if (!gameGroups.has(leg.gameKey)) gameGroups.set(leg.gameKey, []);
    gameGroups.get(leg.gameKey).push(leg);
  });
  let ticketProbability = 1;
  let supported = true;
  let dependencySample = Infinity;
  for (const group of gameGroups.values()) {
    if (group.length === 1) { ticketProbability *= Number(group[0].probability); continue; }
    let shrink = 1;
    let factor = null;
    let matrix;
    while (!factor && shrink >= 0.0625) {
      matrix = Array.from({ length: group.length }, (_, i) => Array.from({ length: group.length }, (_, j) => {
        if (i === j) return 1;
        const row = dependency(group[i], group[j], model);
        if (!row) { supported = false; return 0; }
        dependencySample = Math.min(dependencySample, row.sample);
        return row.correlation * shrink;
      }));
      factor = cholesky(matrix);
      shrink /= 2;
    }
    if (!factor || !supported) return { probability: null, supported: false, dependencySample: Number.isFinite(dependencySample) ? dependencySample : 0 };
    const random = randomFactory(`${seed}:${group.map((leg) => leg.id).join("|")}`);
    const thresholds = group.map((leg) => inverseNormal(clamp(Number(leg.probability), 0.001, 0.999)));
    let wins = 0;
    const simulations = 12000;
    for (let iteration = 0; iteration < simulations; iteration += 1) {
      const independent = [];
      while (independent.length < group.length) {
        const u1 = Math.max(1e-12, random());
        const u2 = random();
        independent.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
        if (independent.length < group.length) independent.push(Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2));
      }
      let allHit = true;
      for (let i = 0; i < group.length && allHit; i += 1) {
        let correlated = 0;
        for (let j = 0; j <= i; j += 1) correlated += factor[i][j] * independent[j];
        if (correlated > thresholds[i]) allHit = false;
      }
      if (allHit) wins += 1;
    }
    ticketProbability *= wins / simulations;
  }
  return { probability: ticketProbability, supported, dependencySample: Number.isFinite(dependencySample) ? dependencySample : 0 };
}

function buildForSize(pool, size, lockedIds, excludedIds, model, seed, alternatives) {
  const locked = pool.filter((row) => lockedIds.includes(row.id));
  if (locked.length > size || new Set(locked.map((row) => row.playerId)).size !== locked.length) return [];
  const candidates = pool.filter((row) => !excludedIds.includes(row.id) && !lockedIds.includes(row.id));
  let beam = [{ legs: locked, players: new Set(locked.map((row) => row.playerId)), ...quickScore(locked, model) }];
  while (beam[0]?.legs.length < size) {
    const next = [];
    for (const state of beam) for (const candidate of candidates) {
      if (state.players.has(candidate.playerId) || state.legs.some((leg) => leg.id === candidate.id)) continue;
      const legs = [...state.legs, candidate];
      let score = state.score + Math.log(clamp(Number(candidate.probability), 0.001, 0.999));
      let unsupported = state.unsupported;
      for (const leg of state.legs) {
        if (leg.gameKey !== candidate.gameKey) continue;
        const row = dependency(leg, candidate, model);
        if (!row) unsupported = true;
        else score += row.correlation * 0.06;
      }
      next.push({ legs, players: new Set([...state.players, candidate.playerId]), score: score - (!state.unsupported && unsupported ? 0.2 : 0), unsupported });
    }
    const unique = new Map();
    next.sort((a, b) => b.score - a.score).forEach((state) => {
      const key = state.legs.map((leg) => leg.id).sort().join("|");
      if (!unique.has(key)) unique.set(key, state);
    });
    beam = [...unique.values()].slice(0, 36);
    if (!beam.length) break;
  }
  return beam.slice(0, Math.max(12, alternatives * 5)).map((state) => {
    const simulation = simulateTicket(state.legs, model, seed);
    const evidenceScore = state.legs.reduce((sum, leg) => sum + Number(leg.evidenceScore || 0), 0) / state.legs.length;
    const gameCounts = state.legs.reduce((counts, leg) => ({ ...counts, [leg.gameKey]: (counts[leg.gameKey] || 0) + 1 }), {});
    return {
      id: `${size}:${state.legs.map((leg) => leg.id).sort().join("-")}`,
      recommendationId: `prop-${hashSeed(`${seed}:${size}:${state.legs.map((leg) => leg.id).sort().join("-")}`).toString(16)}`,
      legs: state.legs, legCount: size, probability: simulation.probability,
      supported: simulation.supported, dependencySample: simulation.dependencySample,
      evidenceScore, gameCounts, maxLegsInGame: Math.max(...Object.values(gameCounts)),
    };
  }).filter((ticket) => ticket.supported && Number.isFinite(ticket.probability))
    .sort((a, b) => b.probability - a.probability || b.evidenceScore - a.evidenceScore)
    .slice(0, alternatives);
}

function rescoreTicket(ticket, replacement, replacedLegId, model, seed) {
  const legs = ticket.legs.map((leg) => leg.id === replacedLegId ? replacement : leg);
  if (new Set(legs.map((leg) => leg.playerId)).size !== legs.length) return null;
  const simulation = simulateTicket(legs, model, seed);
  if (!simulation.supported || !Number.isFinite(simulation.probability)) return null;
  const signature = legs.map((leg) => leg.id).sort().join("-");
  const gameCounts = legs.reduce((counts, leg) => ({ ...counts, [leg.gameKey]: (counts[leg.gameKey] || 0) + 1 }), {});
  return {
    ...ticket,
    id: `${legs.length}:${signature}`,
    recommendationId: `prop-${hashSeed(`${seed}:${legs.length}:${signature}`).toString(16)}`,
    legs,
    probability: simulation.probability,
    supported: simulation.supported,
    dependencySample: simulation.dependencySample,
    evidenceScore: legs.reduce((sum, leg) => sum + Number(leg.evidenceScore || 0), 0) / legs.length,
    gameCounts,
    maxLegsInGame: Math.max(...Object.values(gameCounts)),
  };
}

self.onmessage = (event) => {
  if (event.data?.type === "rescore") {
    const { ticket, replacement, replacedLegId, dependencyModel, seed, requestId } = event.data;
    self.postMessage({ type: "rescored", requestId, ticket: rescoreTicket(ticket, replacement, replacedLegId, dependencyModel, seed) });
    return;
  }
  const { predictions, selectedGames, enabledMarkets, minimumProbability, minimumEvidence, minLegs, maxLegs, lockedIds, excludedIds, dependencyModel, seed } = event.data;
  const eligible = predictions.filter((row) => selectedGames.includes(row.gameKey) && enabledMarkets.includes(row.market) && Number(row.probability) >= minimumProbability && Number(row.evidenceScore) >= minimumEvidence && Date.parse(row.kickoff) > Date.now())
    .sort((left, right) => Number(right.probability) - Number(left.probability) || Number(right.evidenceScore) - Number(left.evidenceScore));
  const perPlayer = new Map();
  const pool = eligible.filter((row) => {
    const count = perPlayer.get(row.playerId) || 0;
    if (count >= 3) return false;
    perPlayer.set(row.playerId, count + 1);
    return true;
  }).slice(0, 120);
  const sizes = minLegs === maxLegs ? [minLegs] : [...new Set([minLegs, Math.round((minLegs + maxLegs) / 2), maxLegs])];
  const alternatives = minLegs === maxLegs ? 3 : 1;
  const tickets = sizes.flatMap((size) => buildForSize(pool, size, lockedIds, excludedIds, dependencyModel, seed, alternatives));
  self.postMessage({ tickets, eligibleCount: eligible.length, searchPoolCount: pool.length, sizes, shortfalls: sizes.filter((size) => new Set(pool.map((row) => row.playerId)).size < size || lockedIds.length > size) });
};
