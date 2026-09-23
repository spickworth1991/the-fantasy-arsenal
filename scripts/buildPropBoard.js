import { buildPropBoard } from "./propLabModel.js";

const season = Number(process.argv.find((arg) => arg.startsWith("--season="))?.split("=")[1]) || new Date().getUTCFullYear();
const board = buildPropBoard({ season, archive: !process.argv.includes("--no-archive") });
console.log(`Built Prop Lab board with ${board.predictionCount} scored offers (${board.rejectedCount} rejected).`);

